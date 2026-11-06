// Pure cookie rules for the admin session (no request or env access, so tests can import it).
import { ADMIN_SESSION_SECONDS } from "@/domain/admin";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Plain http is allowed only for local development. */
export function isLocalHttpUrl(url: URL): boolean {
  return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
}

/** Session cookie: unreadable by page scripts, never sent cross-site, Secure everywhere except local http. */
export function sessionCookieOptions(url: URL) {
  return {
    httpOnly: true,
    secure: !isLocalHttpUrl(url),
    sameSite: "strict" as const,
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  };
}
