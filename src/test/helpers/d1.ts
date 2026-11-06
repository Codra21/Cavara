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

class Statement implements D1PreparedStatement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly values: SQLQueryBindings[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new Statement(this.db, this.sql, values as SQLQueryBindings[]);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.query(this.sql).get(...this.values) as T | null) ?? null;
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
      return { success: true, results, meta: meta(0, 0) };
    }
    const changes = statement.run(...this.values);
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
export function createTestD1(options: { migrations?: string[] } = {}): TestD1 {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  for (const file of options.migrations ?? migrationFiles())
    sqlite.run(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));

  return {
    sqlite,
    prepare: (sql: string) => new Statement(sqlite, sql),
    // D1 runs a batch as one transaction and rolls it all back if a statement fails.
    batch: async <T = unknown>(statements: D1PreparedStatement[]) =>
      sqlite.transaction(() => statements.map((statement) => (statement as Statement).execute<T>()))(),
  };
}
