import { describe, expect, test } from "bun:test";
import { ADMIN_SESSION_SECONDS, LOGIN_LIMITS, LOGIN_WINDOW_MS } from "@/domain/admin";
import { getIdentity, listAudit, ownerCredentials, secretMatches, signIn, signOut, tokenHash } from "@/server/admin/auth.server";
import { createTestD1 } from "./helpers/d1";

const owner = { username: "owner", secret: "a-long-test-secret-value-1234567890" };
const good = { username: "owner", password: owner.secret, client: "203.0.113.7" };
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

describe("ownerCredentials", () => {
  test("blank secret means admin is not configured", () => {
    expect(ownerCredentials({})).toBeNull();
    expect(ownerCredentials({ ADMIN_SECRET: "   " })).toBeNull();
  });
  test("username defaults to owner and is case-insensitive", () => {
    expect(ownerCredentials({ ADMIN_SECRET: "s" })).toEqual({ username: "owner", secret: "s" });
    expect(ownerCredentials({ ADMIN_SECRET: "s", ADMIN_USERNAME: " Forhad " })).toEqual({ username: "forhad", secret: "s" });
  });
});

describe("secretMatches", () => {
  test("exact match only", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
    expect(secretMatches("", "abc")).toBe(false);
    expect(secretMatches("x".repeat(5000), "x".repeat(5000))).toBe(false);
  });
});

describe("signIn", () => {
  test("correct credentials create a session, store only the token hash and audit it", async () => {
    const db = createTestD1();
    const result = await signIn(db, owner, { ...good, username: " OWNER " }, T0);
    if (!result.ok) throw new Error(result.error);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    const rows = db.sqlite.query("SELECT token_hash, expires_at FROM admin_sessions").all() as { token_hash: string; expires_at: number }[];
    expect(rows).toEqual([{ token_hash: tokenHash(result.token), expires_at: T0 + ADMIN_SESSION_SECONDS * 1000 }]);
    expect(JSON.stringify(db.sqlite.query("SELECT * FROM admin_sessions").all())).not.toContain(result.token);
    const audit = await listAudit(db);
    expect(audit.map((entry) => entry.action)).toEqual(["session.signed_in"]);
  });

  test("wrong password or username fails with one generic message", async () => {
    const db = createTestD1();
    const wrongPassword = await signIn(db, owner, { ...good, password: "nope" }, T0);
    const wrongUser = await signIn(db, owner, { ...good, username: "admin" }, T0);
    expect(wrongPassword).toEqual({ ok: false, error: "Incorrect username or password." });
    expect(wrongUser).toEqual(wrongPassword);
    expect(db.sqlite.query("SELECT count(*) AS n FROM admin_sessions").get()).toEqual({ n: 0 });
  });

  test("blocks a client after the IP limit, even with the right password", async () => {
    const db = createTestD1();
    for (let i = 0; i < LOGIN_LIMITS.ip; i++) await signIn(db, owner, { ...good, password: "wrong" }, T0);
    const blocked = await signIn(db, owner, good, T0);
    expect(blocked).toEqual({ ok: false, error: "Too many sign-in attempts. Try again in 15 minutes." });
    // Another client can still sign in until the username limit is reached.
    expect((await signIn(db, owner, { ...good, client: "198.51.100.2" }, T0)).ok).toBe(true);
  });

  test("blocks a username across clients after the username limit", async () => {
    const db = createTestD1();
    for (let i = 0; i < LOGIN_LIMITS.username; i++) await signIn(db, owner, { ...good, password: "wrong", client: `10.0.0.${i}` }, T0);
    expect((await signIn(db, owner, { ...good, client: "10.0.1.1" }, T0)).ok).toBe(false);
  });

  test("limits reset after the window and store no raw IP or username", async () => {
    const db = createTestD1();
    for (let i = 0; i < LOGIN_LIMITS.ip; i++) await signIn(db, owner, { ...good, password: "wrong" }, T0);
    const keys = JSON.stringify(db.sqlite.query("SELECT key FROM admin_login_limits").all());
    expect(keys).not.toContain(good.client);
    expect(keys).not.toContain("owner");
    expect((await signIn(db, owner, good, T0 + LOGIN_WINDOW_MS + 1)).ok).toBe(true);
  });
});

describe("sessions", () => {
  test("a valid token returns the owner; garbage, expiry and secret rotation do not", async () => {
    const db = createTestD1();
    const result = await signIn(db, owner, good, T0);
    if (!result.ok) throw new Error(result.error);
    expect(await getIdentity(db, owner, result.token, T0 + 1000)).toEqual({ id: "owner", username: "owner", role: "owner" });
    expect(await getIdentity(db, owner, undefined, T0)).toBeNull();
    expect(await getIdentity(db, owner, "not-a-token", T0)).toBeNull();
    expect(await getIdentity(db, owner, result.token, T0 + ADMIN_SESSION_SECONDS * 1000)).toBeNull();
    expect(await getIdentity(db, { ...owner, secret: "rotated-secret-value-0987654321" }, result.token, T0 + 1000)).toBeNull();
  });

  test("sign-out deletes the session and records it", async () => {
    const db = createTestD1();
    const result = await signIn(db, owner, good, T0);
    if (!result.ok) throw new Error(result.error);
    await signOut(db, owner, result.token, T0 + 5000);
    expect(await getIdentity(db, owner, result.token, T0 + 6000)).toBeNull();
    expect((await listAudit(db)).map((entry) => entry.action)).toEqual(["session.signed_out", "session.signed_in"]);
  });

  test("a new sign-in clears expired sessions", async () => {
    const db = createTestD1();
    await signIn(db, owner, good, T0);
    await signIn(db, owner, good, T0 + ADMIN_SESSION_SECONDS * 1000 + 1);
    expect(db.sqlite.query("SELECT count(*) AS n FROM admin_sessions").get()).toEqual({ n: 1 });
  });
});

describe("session cookie", () => {
  test("HttpOnly, SameSite=Strict, eight hours; Secure except on local http", async () => {
    const { sessionCookieOptions, isLocalHttpUrl } = await import("@/server/admin/cookie");
    expect(sessionCookieOptions(new URL("https://cavarabd.com/admin"))).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: ADMIN_SESSION_SECONDS,
    });
    expect(sessionCookieOptions(new URL("http://localhost:3000/admin")).secure).toBe(false);
    expect(isLocalHttpUrl(new URL("http://cavarabd.com/admin"))).toBe(false);
    expect(isLocalHttpUrl(new URL("http://127.0.0.1:3000/"))).toBe(true);
  });
});
