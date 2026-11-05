-- Owner sign-in: sessions, persistent login limits and the admin audit log.
-- Staff accounts are not part of this migration (they need the Workers Paid plan for password hashing).

-- One row per signed-in browser. Only the SHA-256 of the cookie token is stored.
-- secret_fp ties the session to the ADMIN_SECRET in use when it was created, so rotating the secret signs everyone out.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  secret_fp TEXT NOT NULL,
  expires_at INTEGER NOT NULL, -- epoch milliseconds
  created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_sessions_expiry ON admin_sessions (expires_at);

-- Sign-in attempt counters shared across Worker isolates. Keys are HMACs, so no IP address or username is stored.
CREATE TABLE admin_login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL -- epoch milliseconds
);

CREATE INDEX idx_admin_login_limits_expiry ON admin_login_limits (expires_at);

-- Who did what in the admin. details is a JSON object and never holds passwords, tokens or customer contact data.
CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_username TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('owner', 'staff')),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_admin_audit_created ON admin_audit (created_at DESC, id DESC);
