// Admin identity and access rules shared by server code and the admin UI. No secrets here.

export type AdminRole = "owner" | "staff";

export interface AdminIdentity {
  id: string;
  username: string;
  role: AdminRole;
}

/** Audit details hold only simple values (names, ids, prices, flags), never secrets or customer contact data. */
export type AuditValue = string | number | boolean | null;

export interface AdminAuditEntry {
  id: string;
  actorUsername: string;
  actorRole: AdminRole;
  action: string;
  targetId: string;
  details: Record<string, AuditValue>;
  createdAt: string;
}

/** What the admin page needs to decide between "not configured", the sign-in form and the workspace. */
export interface AdminSessionState {
  configured: boolean;
  admin: AdminIdentity | null;
}

export const ADMIN_SESSION_COOKIE = "cavara-admin";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
export const DEFAULT_OWNER_USERNAME = "owner";

/** Sign-in attempts allowed per 15-minute window, counted in D1 so every Worker isolate shares them. */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LIMITS = { ip: 10, username: 20 } as const;

export const AUDIT_PAGE_SIZE = 100;
