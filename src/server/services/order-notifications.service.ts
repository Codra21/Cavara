// Telegram alerts for new orders, from the order_notification_outbox. Server-only; takes the database, settings and
// fetch as arguments so tests run on bun:sqlite with a fake Telegram.
//
// The message holds only the reference, the item count and the admin link: no name, phone or address leaves the
// shop. Each send claims its row with a short lease, so the post-order send and the 5-minute cron never send the
// same alert twice, and a sender that dies mid-send is retried once the lease runs out. Failures back off
// (1, 2, 4 … minutes, at most 6 hours) and give up after MAX_ATTEMPTS, leaving the row as "failed" for the dashboard.
// Telegram: https://core.telegram.org/bots/api#sendmessage (chat_id, text, link_preview_options; 429 retry_after).
import type { D1Database } from "@/server/db/d1";

export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 12;
export const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
/** Alerts sent per run; the cron runs every 5 minutes, so a backlog clears quickly without a long invocation. */
export const BATCH_SIZE = 20;

export interface AlertSettings {
  botToken: string;
  chatId: string;
  /** Origin for admin links, e.g. https://cavarabd.com. */
  adminBase: string;
}

interface ClaimedRow {
  order_id: string;
  attempts: number;
  reference: string;
  item_count: number;
}

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.max(0, attempts - 1));
}

export function alertText(row: Pick<ClaimedRow, "order_id" | "reference" | "item_count">, adminBase: string): string {
  const items = `${row.item_count} ${row.item_count === 1 ? "item" : "items"}`;
  return `New order ${row.reference} · ${items}\n${adminBase.replace(/\/+$/, "")}/admin/orders/${row.order_id}`;
}

class TelegramError extends Error {
  constructor(
    message: string,
    /** Telegram's flood-limit wait, in seconds, when it gave one. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

async function sendTelegram(settings: AlertSettings, text: string, fetcher: typeof fetch): Promise<void> {
  const response = await fetcher(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: settings.chatId, text, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    parameters?: { retry_after?: number };
  };
  if (!body.ok) {
    throw new TelegramError(
      `Telegram ${response.status}: ${body.description ?? "no description"}`,
      body.parameters?.retry_after,
    );
  }
}

/** Claims due rows (or one order's row) for this sender. Expired leases count as due. */
async function claim(db: D1Database, now: number, orderId: string | undefined): Promise<ClaimedRow[]> {
  const lease = now + LEASE_MS;
  const at = new Date(now).toISOString();
  const due = orderId
    ? `SELECT order_id FROM order_notification_outbox WHERE order_id = ? AND status = 'pending'`
    : `SELECT order_id FROM order_notification_outbox WHERE status = 'pending' AND next_attempt_at <= ?
       UNION ALL
       SELECT order_id FROM order_notification_outbox WHERE status = 'sending' AND lease_until <= ?
       LIMIT ${BATCH_SIZE}`;
  const dueParams = orderId ? [orderId] : [now, now];
  const [claimed] = await db.batch<{ order_id: string; attempts: number }>([
    db
      .prepare(
        `UPDATE order_notification_outbox
         SET status = 'sending', lease_until = ?, attempts = attempts + 1, updated_at = ?
         WHERE order_id IN (${due})
         RETURNING order_id, attempts`,
      )
      .bind(lease, at, ...dueParams),
  ]);
  const rows = claimed?.results ?? [];
  if (!rows.length) return [];
  const { results } = await db
    .prepare(
      `SELECT o.id AS order_id, o.reference, o.item_count
       FROM json_each(?) j JOIN orders o ON o.id = j.value`,
    )
    .bind(JSON.stringify(rows.map((row) => row.order_id)))
    .all<{ order_id: string; reference: string; item_count: number }>();
  const attempts = new Map(rows.map((row) => [row.order_id, row.attempts]));
  return results.map((row) => ({ ...row, attempts: attempts.get(row.order_id) ?? 1 }));
}

export interface DeliveryReport {
  sent: string[];
  retrying: string[];
  failed: string[];
}

/**
 * Sends due alerts. With `orderId`, only that order's alert (used right after it is saved). Settings missing:
 * nothing is claimed, so alerts wait in the outbox until the secrets are set.
 */
export async function deliverOrderAlerts(
  db: D1Database,
  settings: AlertSettings | null,
  options: { orderId?: string; now?: number; fetcher?: typeof fetch } = {},
): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: [], retrying: [], failed: [] };
  if (!settings) return report;
  const now = options.now ?? Date.now();
  const fetcher = options.fetcher ?? fetch;

  for (const row of await claim(db, now, options.orderId)) {
    const at = new Date(now).toISOString();
    try {
      await sendTelegram(settings, alertText(row, settings.adminBase), fetcher);
      await db
        .prepare(
          `UPDATE order_notification_outbox SET status = 'sent', sent_at = ?, lease_until = NULL, last_error = NULL,
             updated_at = ? WHERE order_id = ?`,
        )
        .bind(at, at, row.order_id)
        .run();
      report.sent.push(row.reference);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const giveUp = row.attempts >= MAX_ATTEMPTS;
      const wait =
        error instanceof TelegramError && error.retryAfter ? error.retryAfter * 1000 : backoffMs(row.attempts);
      await db
        .prepare(
          `UPDATE order_notification_outbox SET status = ?, next_attempt_at = ?, lease_until = NULL, last_error = ?,
             updated_at = ? WHERE order_id = ?`,
        )
        .bind(giveUp ? "failed" : "pending", now + wait, message, at, row.order_id)
        .run();
      (giveUp ? report.failed : report.retrying).push(row.reference);
      console.warn(`order alert ${row.reference} attempt ${row.attempts} failed: ${message}`);
    }
  }
  return report;
}

/** Alert settings from Worker env, or null when the bot token or orders chat is not set. */
export function alertSettings(env: {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ORDER_ADMIN_BASE_URL?: string;
}): AlertSettings | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId, adminBase: env.ORDER_ADMIN_BASE_URL?.trim() || "https://cavarabd.com" };
}
