// Request-bound admin session handling: the cookie, private cache headers and access checks. Server-only.
// Cross-site calls to server functions are already rejected by Start's default CSRF middleware
// (installed automatically because the app has no src/start.ts).
import { deleteCookie, getCookie, getRequest, getRequestHeader, setCookie, setResponseHeader } from "@tanstack/react-start/server";
import { ADMIN_SESSION_COOKIE, type AdminIdentity, type AdminSessionState } from "@/domain/admin";
import { isLocalHttpUrl, sessionCookieOptions } from "./cookie";
import { getDb, getOwnerCredentials } from "@/server/env";
import { getIdentity, signIn, signOut } from "./auth.server";

export class AdminAccessError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const isLocalHttp = () => isLocalHttpUrl(new URL(getRequest().url));

/** Admin responses carry a signed-in identity; they must never be cached or shared. */
export function setPrivateNoStore() {
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("Vary", "Cookie");
}

function clientId(): string {
  return getRequestHeader("cf-connecting-ip") || "local";
}

export async function currentSession(): Promise<AdminSessionState> {
  setPrivateNoStore();
  const owner = getOwnerCredentials();
  if (!owner) return { configured: false, admin: null };
  return { configured: true, admin: await getIdentity(getDb(), owner, getCookie(ADMIN_SESSION_COOKIE)) };
}

export async function signInWithCookie(username: string, password: string) {
  setPrivateNoStore();
  const owner = getOwnerCredentials();
  if (!owner) return { ok: false as const, error: "Admin sign-in is not configured." };
  const url = new URL(getRequest().url);
  if (url.protocol !== "https:" && !isLocalHttp()) return { ok: false as const, error: "Admin sign-in requires HTTPS." };
  const result = await signIn(getDb(), owner, { username, password, client: clientId() });
  if (!result.ok) return result;
  setCookie(ADMIN_SESSION_COOKIE, result.token, sessionCookieOptions(url));
  return { ok: true as const, admin: result.identity };
}

export async function signOutWithCookie() {
  setPrivateNoStore();
  const owner = getOwnerCredentials();
  if (owner) await signOut(getDb(), owner, getCookie(ADMIN_SESSION_COOKIE));
  deleteCookie(ADMIN_SESSION_COOKIE, { path: "/" });
  return { ok: true as const };
}

/** Throws AdminAccessError unless an admin (optionally the Owner) is signed in. */
export async function requireAdmin(ownerOnly: boolean): Promise<AdminIdentity> {
  const { configured, admin } = await currentSession();
  if (!configured) throw new AdminAccessError(503, "Admin access is not configured.");
  if (!admin) throw new AdminAccessError(401, "Your admin session has expired. Sign in again.");
  if (ownerOnly && admin.role !== "owner") throw new AdminAccessError(403, "Owner access required.");
  return admin;
}
