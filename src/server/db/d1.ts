// The subset of the Workers D1 API that Cavara uses, copied from the signatures `wrangler types` generates
// (wrangler 4.158.0, worker-configuration.d.ts). The full generated runtime types are not included in the build
// because they redefine DOM globals (Element, append…) and break browser code. Re-check after upgrading wrangler.

export interface D1Meta {
  duration: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
  [key: string]: unknown;
}

export interface D1Result<T = unknown> {
  success: true;
  meta: D1Meta;
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  /** Runs the statements in order as one SQL transaction; any failure rolls back the whole batch. */
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** Bindings declared in wrangler.jsonc. */
export interface CloudflareEnv {
  DB: D1Database;
  /** Owner sign-in name (Worker var). Defaults to "owner". */
  ADMIN_USERNAME?: string;
  /** Owner password (Worker secret; .dev.vars locally). Blank disables the admin. */
  ADMIN_SECRET?: string;
}
