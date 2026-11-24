/**
 * Formal BFS state-space model: R2 ETag CAS Patching & Turnstile Clearance Liveness.
 *
 * Replays two real bugs:
 *   1. R2 snapshot patch without etagMatches CAS: concurrent writes to product A and product B
 *      lose product A's update (architecture.md:144-147).
 *   2. Turnstile startClearance (src/lib/turnstile.ts:180): when api.render() returns undefined,
 *      state.settle() was never called, deadlocking callers until the 45s timeout.
 */
export const name = "r2-cas-and-turnstile-liveness";

export function check({ buggy = false } = {}) {
  // Part A: R2 CAS model for two concurrent product writers (A and B)
  const initR2 = {
    r2A: 0,
    r2B: 0,
    etag: 1,
    wa: "init", // "init" | "read" | "done"
    wb: "init",
    waRead: null,
    wbRead: null,
  };

  const r2Key = (s) =>
    `${s.r2A}|${s.r2B}|${s.etag}|${s.wa}|${s.wb}|${JSON.stringify(s.waRead)}|${JSON.stringify(s.wbRead)}`;
  const q = [{ state: initR2, trace: [] }];
  const seen = new Set([r2Key(initR2)]);
  let explored = 0;

  while (q.length > 0) {
    const { state, trace } = q.shift();
    explored++;

    // Safety invariant: once both writers finish, BOTH updates (r2A=1 and r2B=1) must be present.
    if (state.wa === "done" && state.wb === "done" && (state.r2A !== 1 || state.r2B !== 1)) {
      return {
        ok: false,
        explored,
        violation: `R2 lost update: both writers finished but R2 has (A=${state.r2A}, B=${state.r2B})`,
        trace,
      };
    }

    const nexts = [];
    if (state.wa === "init") {
      nexts.push({
        action: `WriterA.Read(etag=${state.etag}, A=${state.r2A}, B=${state.r2B})`,
        state: { ...state, wa: "read", waRead: { a: state.r2A, b: state.r2B, etag: state.etag } },
      });
    }
    if (state.wb === "init") {
      nexts.push({
        action: `WriterB.Read(etag=${state.etag}, A=${state.r2A}, B=${state.r2B})`,
        state: { ...state, wb: "read", wbRead: { a: state.r2A, b: state.r2B, etag: state.etag } },
      });
    }
    if (state.wa === "read") {
      if (buggy || state.waRead.etag === state.etag) {
        nexts.push({
          action: `WriterA.Put(${buggy ? "unguarded" : `etagMatches=${state.waRead.etag}`})`,
          state: { ...state, r2A: 1, r2B: state.waRead.b, etag: state.etag + 1, wa: "done" },
        });
      } else {
        // CAS mismatch -> retry from fresh read
        nexts.push({
          action: `WriterA.Put(etagMatches=${state.waRead.etag}) -> 412 Retry`,
          state: { ...state, wa: "init", waRead: null },
        });
      }
    }
    if (state.wb === "read") {
      if (buggy || state.wbRead.etag === state.etag) {
        nexts.push({
          action: `WriterB.Put(${buggy ? "unguarded" : `etagMatches=${state.wbRead.etag}`})`,
          state: { ...state, r2A: state.wbRead.a, r2B: 1, etag: state.etag + 1, wb: "done" },
        });
      } else {
        nexts.push({
          action: `WriterB.Put(etagMatches=${state.wbRead.etag}) -> 412 Retry`,
          state: { ...state, wb: "init", wbRead: null },
        });
      }
    }

    for (const item of nexts) {
      const k = r2Key(item.state);
      if (!seen.has(k)) {
        seen.add(k);
        q.push({ state: item.state, trace: [...trace, item.action] });
      }
    }
  }

  // Part B: Turnstile startClearance liveness (render returning undefined must settle)
  const renderOutcomes = ["widget-id", undefined];
  for (const renderResult of renderOutcomes) {
    explored++;
    let settled = false;
    const widgetId = renderResult ?? null;
    if (widgetId) {
      settled = true; // callback eventually settles
    } else if (!buggy) {
      settled = true; // fixed: if (!state.widgetId) state.settle();
    }
    if (!settled) {
      return {
        ok: false,
        explored,
        violation: "Turnstile startClearance deadlock: api.render() returned undefined and never settled",
        trace: ["startClearance()", "loadApi() -> ok", "api.render() -> undefined", "settled remains false (45s hang)"],
      };
    }
  }

  return { ok: true, explored };
}
