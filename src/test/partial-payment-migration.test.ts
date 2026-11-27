// Migration 0017 rebuilds orders on a database that already holds orders. D1 enforces foreign keys and runs each
// migration file in one transaction, so the test does the same: the rebuild must commit with child rows present.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestD1, migrationFiles } from "@/test/helpers/d1";

const MIGRATION = "0017_partial_payment.sql";
const before = migrationFiles().filter((file) => file < MIGRATION);
const rebuild = readFileSync(join(import.meta.dir, "../../migrations", MIGRATION), "utf8");

function seededDb() {
  const db = createTestD1({ migrations: before });
  const insertOrder = db.sqlite.query(
    `INSERT INTO orders (id, reference, idempotency_key, payload_hash, customer_name, phone, address, zone_id, zone_name,
       delivery_charge, subtotal, total, item_count, payment_status, shop_day, created_at, updated_at)
     VALUES (?, ?, ?, 'h', 'QA Test', '01700000000', 'Test road, Dhaka', 'inside-dhaka', 'Inside Dhaka', 80, 1000, 1080, 1,
       ?, '2026-11-28', '2026-11-28T00:00:00.000Z', '2026-11-28T00:00:00.000Z')`,
  );
  ["unpaid", "paid", "refunded"].forEach((status, index) =>
    insertOrder.run(`o${index}`, `CV-00000${index}`, `k${index}`, status),
  );
  for (const id of ["o0", "o1", "o2"]) {
    db.sqlite
      .query(
        `INSERT INTO order_items (order_id, line, product_id, variant_position, product_name, variant_name, availability,
           unit_price, qty, line_total) VALUES (?, 0, 1, 0, 'Jar', 'White', 'in_stock', 1000, 1, 1000)`,
      )
      .run(id);
    db.sqlite
      .query(
        `INSERT INTO order_status_history (order_id, to_status, to_payment_status, created_at)
         VALUES (?, 'new', 'unpaid', '2026-11-28T00:00:00.000Z')`,
      )
      .run(id);
    db.sqlite
      .query(
        `INSERT INTO order_notification_outbox (order_id, next_attempt_at, created_at, updated_at)
         VALUES (?, 0, '2026-11-28T00:00:00.000Z', '2026-11-28T00:00:00.000Z')`,
      )
      .run(id);
  }
  return db;
}

const count = (db: ReturnType<typeof seededDb>, table: string) =>
  (db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("migration 0017 on a database with orders", () => {
  test("commits with lines, history and outbox rows present, and keeps every row", () => {
    const db = seededDb();
    const lineIds = db.sqlite.query("SELECT id FROM order_items ORDER BY id").all();
    db.sqlite.transaction(() => db.sqlite.run(rebuild))();

    for (const table of ["orders", "order_items", "order_status_history", "order_notification_outbox"])
      expect(count(db, table)).toBe(3);
    expect(db.sqlite.query("SELECT id FROM order_items ORDER BY id").all()).toEqual(lineIds);
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const tables = db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_next'").all();
    expect(tables).toEqual([]);
    for (const child of ["order_items", "order_status_history", "order_notification_outbox"]) {
      const sql = (db.sqlite.query("SELECT sql FROM sqlite_master WHERE name = ?").get(child) as { sql: string }).sql;
      expect(sql).toContain('REFERENCES "orders" (id) ON DELETE RESTRICT');
    }
  });

  test("backfills what was received: paid and refunded orders the total, unpaid 0", () => {
    const db = seededDb();
    db.sqlite.transaction(() => db.sqlite.run(rebuild))();
    expect(db.sqlite.query("SELECT payment_status, amount_paid FROM orders ORDER BY id").all()).toEqual([
      { payment_status: "unpaid", amount_paid: 0 },
      { payment_status: "paid", amount_paid: 1080 },
      { payment_status: "refunded", amount_paid: 1080 },
    ]);
  });

  test("still enforces the foreign keys and ties amount_paid to the payment status", () => {
    const db = seededDb();
    db.sqlite.transaction(() => db.sqlite.run(rebuild))();
    expect(() =>
      db.sqlite
        .query(
          `INSERT INTO order_items (order_id, line, product_id, variant_position, product_name, variant_name,
             availability, unit_price, qty, line_total) VALUES ('missing', 0, 1, 0, 'Jar', 'White', 'in_stock', 1, 1, 1)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    expect(() => db.sqlite.run("DELETE FROM orders WHERE id = 'o0'")).toThrow(/FOREIGN KEY/);
    const set = (status: string, amount: number) =>
      db.sqlite.query("UPDATE orders SET payment_status = ?, amount_paid = ? WHERE id = 'o0'").run(status, amount);
    expect(() => set("partially_paid", 0)).toThrow(/CHECK/);
    expect(() => set("partially_paid", 1080)).toThrow(/CHECK/);
    expect(() => set("paid", 500)).toThrow(/CHECK/);
    expect(() => set("unpaid", 10)).toThrow(/CHECK/);
    expect(() => set("refunded", 5000)).toThrow(/CHECK/);
    set("partially_paid", 540);
    expect(db.sqlite.query("SELECT amount_paid FROM orders WHERE id = 'o0'").get()).toEqual({ amount_paid: 540 });
  });
});
