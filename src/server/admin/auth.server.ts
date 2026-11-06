// Owner sign-in, sessions, login limits and the audit log. Server-only.
// Every function takes the database and the configured credentials, so tests can run it on bun:sqlite.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ADMIN_SESSION_SECONDS,
  AUDIT_PAGE_SIZE,
  DEFAULT_OWNER_USERNAME,
  LOGIN_LIMITS,
  LOGIN_WINDOW_MS,
  type AdminAuditEntry,
  type AdminIdentity,
  type AuditValue,
} from "@/domain/admin";
import type { D1Database, D1PreparedStatement } from "@/server/db/d1";

export interface OwnerCredentials {
  username: string;
  secret: string;
}

/** Owner credentials from Worker vars/secrets, or null when admin access is not configured. */
export function ownerCredentials(env: { ADMIN_USERNAME?: string; ADMIN_SECRET?: string }): OwnerCredentials | null {
  const secret = env.ADMIN_SECRET?.trim();
  if (!secret) return null;
  return { username: (env.ADMIN_USERNAME?.trim() || DEFAULT_OWNER_USERNAME).toLowerCase(), secret };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();
export const tokenHash = (token: string) => sha256(token).toString("hex");

/** Constant-time comparison of fixed-length digests, so timing does not reveal where two strings differ. */
export function secretMatches(supplied: string, configured: string): boolean {
  if (!supplied || !configured || supplied.length > 4096) return false;
  return timingSafeEqual(sha256(supplied), sha256(configured));
}

/** Changes whenever ADMIN_SECRET changes; sessions created under an older secret stop working. */
const secretFingerprint = (secret: string) =>
  createHmac("sha256", secret).update("cavara-admin-session-v1").digest("hex");

const limitKey = (secret: string, kind: string, value: string) =>
  createHmac("sha256", secret).update(`cavara-admin-login:${kind}:${value}`).digest("hex");

export function auditStatement(
  db: D1Database,
  actor: AdminIdentity,
  action: string,
  targetId: string,
  details: Record<string, AuditValue> = {},
  now = new Date(),
  /** Optional SQL condition (with its parameters); the row is written only when it holds, e.g. a revision check. */
  guard?: { sql: string; params: unknown[] },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO admin_audit (id, actor_id, actor_username, actor_role, action, target_id, details, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard?.sql ?? "1"}`,
    )
    .bind(
      crypto.randomUUID(),
      actor.id,
      actor.username,
      actor.role,
      action,
      targetId,
      JSON.stringify(details),
      now.toISOString(),
      ...(guard?.params ?? []),
    );
}

/**
 * Counts this attempt against the client and the username, then reports whether both are still under their limit.
 * Runs before the password check, so wrong and right guesses count alike.
 */
async function recordLoginAttempt(db: D1Database, secret: string, client: string, username: string, now: number) {
  const expires = now + LOGIN_WINDOW_MS;
  const bump = (key: string) =>
    db
      .prepare(
        `INSERT INTO admin_login_limits (key, attempts, expires_at) VALUES (?, 1, ?)
         ON CONFLICT (key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`,
      )
      .bind(key, expires);
  const [, ip, user] = await db.batch<{ attempts: number }>([
    db.prepare("DELETE FROM admin_login_limits WHERE expires_at <= ?").bind(now),
    bump(limitKey(secret, "ip", client)),
    bump(limitKey(secret, "user", username)),
  ]);
  const ipAttempts = ip?.results[0]?.attempts ?? Infinity;
  const userAttempts = user?.results[0]?.attempts ?? Infinity;
  return ipAttempts <= LOGIN_LIMITS.ip && userAttempts <= LOGIN_LIMITS.username;
}

export type SignInResult = { ok: true; token: string; identity: AdminIdentity } | { ok: false; error: string };

export async function signIn(
  db: D1Database,
  owner: OwnerCredentials,
  input: { username: string; password: string; client: string },
  now = Date.now(),
): Promise<SignInResult> {
  const username = input.username.trim().toLowerCase();
  if (!(await recordLoginAttempt(db, owner.secret, input.client, username, now))) {
    return { ok: false, error: "Too many sign-in attempts. Try again in 15 minutes." };
  }
  // Compare both fields before deciding, so a wrong username takes as long as a wrong password.
  const userOk = secretMatches(username, owner.username);
  const passwordOk = secretMatches(input.password, owner.secret);
  if (!userOk || !passwordOk) return { ok: false, error: "Incorrect username or password." };

  const identity: AdminIdentity = { id: "owner", username: owner.username, role: "owner" };
  const token = randomBytes(32).toString("hex");
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    db
      .prepare(
        "INSERT INTO admin_sessions (token_hash, account_id, role, secret_fp, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        tokenHash(token),
        identity.id,
        identity.role,
        secretFingerprint(owner.secret),
        now + ADMIN_SESSION_SECONDS * 1000,
        new Date(now).toISOString(),
      ),
    auditStatement(db, identity, "session.signed_in", identity.id, {}, new Date(now)),
  ]);
  return { ok: true, token, identity };
}

/** The signed-in admin for a cookie token, or null if the session is missing, expired or from an older secret. */
export async function getIdentity(
  db: D1Database,
  owner: OwnerCredentials,
  token: string | undefined,
  now = Date.now(),
): Promise<AdminIdentity | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db
    .prepare("SELECT account_id, role FROM admin_sessions WHERE token_hash = ? AND secret_fp = ? AND expires_at > ?")
    .bind(tokenHash(token), secretFingerprint(owner.secret), now)
    .first<{ account_id: string; role: string }>();
  if (!row) return null;
  // Only the Owner can hold a session until Staff accounts exist.
  if (row.account_id !== "owner" || row.role !== "owner") return null;
  return { id: "owner", username: owner.username, role: "owner" };
}

export async function signOut(db: D1Database, owner: OwnerCredentials, token: string | undefined, now = Date.now()) {
  const identity = await getIdentity(db, owner, token, now);
  if (!token) return;
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash(token)),
    ...(identity ? [auditStatement(db, identity, "session.signed_out", identity.id, {}, new Date(now))] : []),
  ]);
}

interface AuditRow {
  id: string;
  actor_username: string;
  actor_role: AdminAuditEntry["actorRole"];
  action: string;
  target_id: string;
  details: string;
  created_at: string;
}

export async function listAudit(db: D1Database): Promise<AdminAuditEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT id, actor_username, actor_role, action, target_id, details, created_at FROM admin_audit
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(AUDIT_PAGE_SIZE)
    .all<AuditRow>();
  return results.map((row) => {
    const details: Record<string, AuditValue> = {};
    try {
      const parsed: unknown = JSON.parse(row.details);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (value === null || ["string", "number", "boolean"].includes(typeof value))
            details[key] = value as AuditValue;
        }
      }
    } catch {
      // Keep the entry visible even if its details are malformed.
    }
    return {
      id: row.id,
      actorUsername: row.actor_username,
      actorRole: row.actor_role,
      action: row.action,
      targetId: row.target_id,
      details,
      createdAt: row.created_at,
    };
  });
}
