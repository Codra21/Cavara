// In-memory stand-in for D1 built on bun:sqlite, with the repo's real migrations applied.
// It implements only the D1 surface Cavara uses (src/server/db/d1.ts). Never point tests at a remote D1.
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { D1Database, D1PreparedStatement, D1Result } from "@/server/db/d1";

const MIGRATIONS_DIR = join(import.meta.dir, "../../../migrations");

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Called after every statement with its SQL and the rows it returned (or changed). For read-budget tests. */
export type StatementObserver = (sql: string, rows: number) => void;

class Statement implements D1PreparedStatement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly values: SQLQueryBindings[] = [],
    private readonly observe?: StatementObserver,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    if (values.length > 100) {
      throw new Error(
        `D1 allows at most 100 bound parameters per statement (got ${values.length}). Pass a JSON array via json_each(?) instead.`,
      );
    }
    return new Statement(this.db, this.sql, values as SQLQueryBindings[], this.observe);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
    this.observe?.(this.sql, row ? 1 : 0);
    return row;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  /** Synchronous so batch() can run inside one bun:sqlite transaction. */
  execute<T>(): D1Result<T> {
    const statement = this.db.query(this.sql);
    const isRead = /^\s*(select|with)\b/i.test(this.sql) || /\breturning\b/i.test(this.sql);
    if (isRead) {
      const results = statement.all(...this.values) as T[];
      this.observe?.(this.sql, results.length);
      return { success: true, results, meta: meta(0, 0) };
    }
    const changes = statement.run(...this.values);
    this.observe?.(this.sql, changes.changes);
    return { success: true, results: [], meta: meta(changes.changes, Number(changes.lastInsertRowid)) };
  }
}

function meta(changes: number, lastRowId: number) {
  return { duration: 0, rows_read: 0, rows_written: changes, last_row_id: lastRowId, changed_db: changes > 0, changes };
}

export interface TestD1 extends D1Database {
  sqlite: Database;
}

/** A fresh database with every migration applied, in file order (like `wrangler d1 migrations apply`). */
export function createTestD1(options: { migrations?: string[]; observe?: StatementObserver } = {}): TestD1 {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  for (const file of options.migrations ?? migrationFiles())
    sqlite.run(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));

  return {
    sqlite,
    prepare: (sql: string) => new Statement(sqlite, sql, [], options.observe),
    // D1 runs a batch as one transaction and rolls it all back if a statement fails.
    batch: async <T = unknown>(statements: D1PreparedStatement[]) =>
      sqlite.transaction(() => statements.map((statement) => (statement as Statement).execute<T>()))(),
  };
}

const SMALL_TABLE_ALLOWLIST = new Set(["categories", "delivery_zones", "sqlite_master"]);

export function assertIndexedQueryPlan(db: TestD1, sql: string, params: SQLQueryBindings[] = []): string[] {
  const rows = db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
  const details = rows.map((row) => row.detail);
  for (const detail of details) {
    if (/USE TEMP B-TREE/i.test(detail)) {
      throw new Error(`Query builds a temp B-tree (${detail}). Add a matching index or sort in JS.\nSQL: ${sql}`);
    }
    const table = /\bSCAN\s+(?:TABLE\s+)?(\w+)/i.exec(detail)?.[1];
    if (table && !SMALL_TABLE_ALLOWLIST.has(table)) {
      throw new Error(
        `Query performs a full table SCAN on ${table} (${detail}). Add an index or rewrite as an indexed lookup.\nSQL: ${sql}`,
      );
    }
  }
  return details;
}
