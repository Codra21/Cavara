// Per-request Server-Timing: D1 round trips, R2 reads and wall time, so a page that falls through the snapshot cache to
// D1 shows in the browser's network panel (Timing tab) and in `curl -sI`. Pure module, no Cloudflare imports, so
// bun:test can run it. The request scope is AsyncLocalStorage, which TanStack Start already uses on this Worker
// (nodejs_compat, see @tanstack/start-storage-context).
import { AsyncLocalStorage } from "node:async_hooks";
import type { D1Database, D1PreparedStatement, R2Bucket } from "./db/d1";

interface Meter {
  count: number;
  /** Wall time with overlapping calls merged, so three parallel reads count once. */
  ms: number;
  inFlight: number;
  openedAt: number;
}

export interface RequestTiming {
  start: number;
  cold: boolean;
  d1: Meter;
  r2: Meter;
}

const storage = new AsyncLocalStorage<RequestTiming>();
let firstRequest = true;

const meter = (): Meter => ({ count: 0, ms: 0, inFlight: 0, openedAt: 0 });

export function runWithRequestTiming<T>(fn: () => Promise<T>): Promise<T> {
  const cold = firstRequest;
  firstRequest = false;
  return storage.run({ start: performance.now(), cold, d1: meter(), r2: meter() }, fn);
}

export function currentTiming(): RequestTiming | undefined {
  return storage.getStore();
}

async function measure<T>(which: "d1" | "r2", call: () => Promise<T>): Promise<T> {
  const state = storage.getStore();
  if (!state) return call();
  const m = state[which];
  m.count += 1;
  if (m.inFlight++ === 0) m.openedAt = performance.now();
  try {
    return await call();
  } finally {
    if (--m.inFlight === 0) m.ms += performance.now() - m.openedAt;
  }
}

// D1's batch() takes the binding's own statement objects, so a wrapped statement must be unwrapped before it.
const unwrapped = new WeakMap<object, D1PreparedStatement>();

function timedStatement(statement: D1PreparedStatement): D1PreparedStatement {
  const wrapped: D1PreparedStatement = {
    bind: (...values) => timedStatement(statement.bind(...values)),
    first: () => measure("d1", () => statement.first()),
    run: () => measure("d1", () => statement.run()),
    all: () => measure("d1", () => statement.all()),
  } as D1PreparedStatement;
  unwrapped.set(wrapped, statement);
  return wrapped;
}

/** The D1 binding, counting each query and each batch as one round trip. */
export function timedD1(db: D1Database): D1Database {
  return {
    prepare: (query) => timedStatement(db.prepare(query)),
    batch: (statements) => measure("d1", () => db.batch(statements.map((s) => unwrapped.get(s) ?? s))),
  };
}

/** The R2 binding, counting reads. Writes happen on admin saves, where Server-Timing isn't added. */
export function timedR2(bucket: R2Bucket): R2Bucket {
  return {
    get: (key) => measure("r2", () => bucket.get(key)),
    ...(bucket.head ? { head: (key: string) => bucket.head!(key) } : {}),
    put: (key, value, options) => bucket.put(key, value, options),
    delete: (keys) => bucket.delete(keys),
  };
}

/** `d1;dur=12.3;desc="3 trips", r2;dur=4.0;desc="1 read", total;dur=30.1, cold;desc=1` */
export function formatServerTiming(state: RequestTiming, now = performance.now()): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    `d1;dur=${state.d1.ms.toFixed(1)};desc="${plural(state.d1.count, "trip")}"`,
    `r2;dur=${state.r2.ms.toFixed(1)};desc="${plural(state.r2.count, "read")}"`,
    // Workers clocks only move across I/O, so this is time spent waiting, not render CPU (that is in Observability).
    `total;dur=${(now - state.start).toFixed(1)}`,
    `cold;desc=${state.cold ? 1 : 0}`,
  ].join(", ");
}

/**
 * Runs one request with timing and adds the Server-Timing header to GET and HEAD responses. Other methods (orders,
 * sign-in, admin saves) get none, so no write path exposes its timings. Counts cover the work done before the
 * response starts; anything a streamed body awaits later is not included.
 */
export async function withServerTiming(
  request: Request,
  handle: () => Response | Promise<Response>,
): Promise<Response> {
  return runWithRequestTiming(async () => {
    const response = await handle();
    const state = storage.getStore();
    if (!state || (request.method !== "GET" && request.method !== "HEAD")) return response;
    const headers = new Headers(response.headers);
    headers.append("Server-Timing", formatServerTiming(state));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}

/** Test hook: the next request counts as the isolate's first. */
export function resetColdStartForTest() {
  firstRequest = true;
}
