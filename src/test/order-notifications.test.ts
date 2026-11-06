import { describe, expect, test } from "bun:test";
import { submitOrder } from "@/server/services/orders.service";
import {
  alertSettings,
  alertText,
  backoffMs,
  BATCH_SIZE,
  deliverOrderAlerts,
  LEASE_MS,
  MAX_ATTEMPTS,
} from "@/server/services/order-notifications.service";
import { createTestD1, type TestD1 } from "./helpers/d1";

const settings = { botToken: "123:test-token", chatId: "-100200", adminBase: "https://cavarabd.com/" };
const T0 = Date.parse("2026-11-07T04:00:00.000Z");

async function placeOrder(db: TestD1, at = T0, phone = "01712345678") {
  const [product] = db.sqlite
    .query(
      `SELECT p.id, p.price, v.position FROM products p JOIN product_variants v ON v.product_id = p.id
       WHERE p.status = 'published' ORDER BY p.id, v.position LIMIT 1`,
    )
    .all() as { id: number; price: number; position: number }[];
  const result = await submitOrder(
    db,
    {
      idempotencyKey: crypto.randomUUID(),
      name: "Private Person",
      phone,
      zoneId: "inside-dhaka",
      address: "Secret Street 1, Dhaka 1205",
      note: "",
      deliveryCharge: 80,
      items: [{ productId: product!.id, variant: product!.position, qty: 3, unitPrice: product!.price }],
      website: "",
    },
    { client: crypto.randomUUID(), limitSecret: "x".repeat(40), now: new Date(at) },
  );
  if (!result.ok) throw new Error(result.message);
  return result;
}

/** A fake Telegram that records requests and answers with the given responses in turn (default: ok). */
function telegram(...responses: { status: number; body: object }[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const next = responses.shift() ?? { status: 200, body: { ok: true, result: {} } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const outbox = (db: TestD1) =>
  db.sqlite.query("SELECT status, attempts, next_attempt_at, last_error FROM order_notification_outbox").all() as {
    status: string;
    attempts: number;
    next_attempt_at: number;
    last_error: string | null;
  }[];

describe("order alerts", () => {
  test("each order is queued in the same batch that saves it", async () => {
    const db = createTestD1();
    await placeOrder(db);
    expect(outbox(db)).toEqual([{ status: "pending", attempts: 0, next_attempt_at: T0, last_error: null }]);
  });

  test("the message holds the reference, item count and admin link, and no customer details", async () => {
    const db = createTestD1();
    const order = await placeOrder(db);
    const { fetcher, calls } = telegram();
    const report = await deliverOrderAlerts(db, settings, { orderId: order.orderId, now: T0, fetcher });
    expect(report).toEqual({ sent: [order.reference], retrying: [], failed: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.telegram.org/bot123:test-token/sendMessage");
    expect(calls[0]!.body).toEqual({
      chat_id: "-100200",
      text: `New order ${order.reference} · 3 items\nhttps://cavarabd.com/admin/orders/${order.orderId}`,
      link_preview_options: { is_disabled: true },
    });
    const text = JSON.stringify(calls[0]!.body);
    for (const secret of ["Private Person", "01712345678", "Secret Street"]) expect(text).not.toContain(secret);
    expect(outbox(db)[0]!.status).toBe("sent");
    // A second run finds nothing to send.
    expect((await deliverOrderAlerts(db, settings, { now: T0 + 1, fetcher })).sent).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test("a failure backs off and the cron retries once it is due", async () => {
    const db = createTestD1();
    const order = await placeOrder(db);
    const down = telegram({ status: 502, body: { ok: false, description: "Bad Gateway" } });
    const first = await deliverOrderAlerts(db, settings, { orderId: order.orderId, now: T0, fetcher: down.fetcher });
    expect(first.retrying).toEqual([order.reference]);
    expect(outbox(db)[0]).toMatchObject({ status: "pending", attempts: 1, next_attempt_at: T0 + 60_000 });
    expect(outbox(db)[0]!.last_error).toContain("Bad Gateway");

    const up = telegram();
    expect((await deliverOrderAlerts(db, settings, { now: T0 + 59_999, fetcher: up.fetcher })).sent).toEqual([]);
    expect((await deliverOrderAlerts(db, settings, { now: T0 + 60_000, fetcher: up.fetcher })).sent).toEqual([
      order.reference,
    ]);
    expect(outbox(db)[0]).toMatchObject({ status: "sent", attempts: 2, last_error: null });
  });

  test("Telegram's flood-limit wait is respected", async () => {
    const db = createTestD1();
    const order = await placeOrder(db);
    const flood = telegram({
      status: 429,
      body: { ok: false, description: "Too Many Requests", parameters: { retry_after: 30 } },
    });
    await deliverOrderAlerts(db, settings, { orderId: order.orderId, now: T0, fetcher: flood.fetcher });
    expect(outbox(db)[0]!.next_attempt_at).toBe(T0 + 30_000);
  });

  test("backoff doubles from a minute up to six hours, then the alert is marked failed", async () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(backoffMs(30)).toBe(6 * 60 * 60 * 1000);
    const db = createTestD1();
    const order = await placeOrder(db);
    db.sqlite.run("UPDATE order_notification_outbox SET attempts = ?", [MAX_ATTEMPTS - 1]);
    const down = telegram({ status: 500, body: { ok: false } });
    const report = await deliverOrderAlerts(db, settings, { orderId: order.orderId, now: T0, fetcher: down.fetcher });
    expect(report.failed).toEqual([order.reference]);
    expect(outbox(db)[0]!.status).toBe("failed");
  });

  test("a sender that died mid-send is retried after its lease, and a live lease is left alone", async () => {
    const db = createTestD1();
    await placeOrder(db);
    db.sqlite.run("UPDATE order_notification_outbox SET status = 'sending', attempts = 1, lease_until = ?", [
      T0 + LEASE_MS,
    ]);
    const { fetcher, calls } = telegram();
    expect((await deliverOrderAlerts(db, settings, { now: T0 + 1000, fetcher })).sent).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await deliverOrderAlerts(db, settings, { now: T0 + LEASE_MS, fetcher })).sent).toHaveLength(1);
  });

  test("the cron sends every due alert, at most a batch per run", async () => {
    const db = createTestD1();
    for (let i = 0; i < BATCH_SIZE + 2; i++) await placeOrder(db, T0 + i, `0171${String(i).padStart(7, "0")}`);
    const { fetcher } = telegram();
    expect((await deliverOrderAlerts(db, settings, { now: T0 + 1000, fetcher })).sent).toHaveLength(BATCH_SIZE);
    expect((await deliverOrderAlerts(db, settings, { now: T0 + 2000, fetcher })).sent).toHaveLength(2);
  });

  test("without the bot token or chat id nothing is claimed; alerts wait until they are set", async () => {
    const db = createTestD1();
    await placeOrder(db);
    expect(alertSettings({ TELEGRAM_BOT_TOKEN: "x" })).toBeNull();
    expect(await deliverOrderAlerts(db, null, { now: T0 })).toEqual({ sent: [], retrying: [], failed: [] });
    expect(outbox(db)[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(alertSettings({ TELEGRAM_BOT_TOKEN: " t ", TELEGRAM_CHAT_ID: "c" })).toEqual({
      botToken: "t",
      chatId: "c",
      adminBase: "https://cavarabd.com",
    });
  });

  test("alertText pluralises and trims the base", () => {
    expect(alertText({ order_id: "id", reference: "CV-AAAAAA", item_count: 1 }, "https://x.test///")).toBe(
      "New order CV-AAAAAA · 1 item\nhttps://x.test/admin/orders/id",
    );
  });

  test("the cron's lookups use the partial indexes", () => {
    const db = createTestD1();
    const plan = (sql: string) =>
      (db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((row) => row.detail).join(" | ");
    expect(
      plan("SELECT order_id FROM order_notification_outbox WHERE status = 'pending' AND next_attempt_at <= 0"),
    ).toContain("idx_outbox_pending");
    expect(
      plan("SELECT order_id FROM order_notification_outbox WHERE status = 'sending' AND lease_until <= 0"),
    ).toContain("idx_outbox_sending");
  });
});
