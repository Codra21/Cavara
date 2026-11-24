/**
 * Formal BFS state-space model: Order Notification Outbox Lease vs Batch Timeout
 * (Cavara bug 2026-11-20, architecture.md:380-384, progress-tracker.md:120-121).
 *
 * Historical bug:
 *   Outbox cron claimed BATCH_SIZE=20 rows with LEASE_S=60 and PER_SEND_TIMEOUT_S=8.
 *   Worst-case batch duration = 20 * 8s = 160s > 60s lease. A second cron run at t=60s
 *   reclaimed the still-in-flight row and double-sent the Telegram alert.
 *   Fixed by cutting BATCH_SIZE to 6 (6 * 8s = 48s < 60s lease).
 *
 * Safety invariant:
 *   A row's sendCount must never exceed 1.
 */
export const name = "outbox-lease-safety";

export function check({ buggy = false } = {}) {
  const BATCH_SIZE = buggy ? 20 : 6;
  const PER_SEND_TIMEOUT_S = 8;
  const LEASE_S = 60;
  const MAX_BATCH_TIME = BATCH_SIZE * PER_SEND_TIMEOUT_S; // 160s buggy vs 48s fixed

  // Model the last row in a claimed batch under worst-case earlier-row stalls.
  // Worker C1 claims at t=0 (lease expires at t=60). C1 finishes processing the last row at t in {8, MAX_BATCH_TIME}.
  // Worker C2 wakes up on cron at t=60 and reclaims any row whose lease expired and status !== "sent".
  const initial = {
    t: 0,
    rowStatus: "pending", // "pending" | "claimed" | "sent"
    leaseUntil: 0,
    c1: "idle", // "idle" | "working" | "done"
    c2: "idle",
    c1FinishAt: 0,
    sendCount: 0,
  };

  const keyOf = (s) => `${s.t}|${s.rowStatus}|${s.leaseUntil}|${s.c1}|${s.c2}|${s.c1FinishAt}|${s.sendCount}`;
  const queue = [{ state: initial, trace: [] }];
  const visited = new Set([keyOf(initial)]);
  let explored = 0;

  while (queue.length > 0) {
    const { state, trace } = queue.shift();
    explored++;

    if (state.sendCount > 1) {
      return {
        ok: false,
        explored,
        violation: `Double Telegram alert sent (sendCount=${state.sendCount}) with BATCH_SIZE=${BATCH_SIZE} (maxBatchTime=${MAX_BATCH_TIME}s > lease=${LEASE_S}s)`,
        trace,
      };
    }

    const nexts = [];

    // C1 claims batch at t=0
    if (state.c1 === "idle" && state.rowStatus === "pending") {
      for (const dur of [PER_SEND_TIMEOUT_S, MAX_BATCH_TIME]) {
        nexts.push({
          action: `C1.ClaimBatch(t=0, leaseUntil=${LEASE_S}, worstCaseFinish=${dur}s)`,
          state: {
            ...state,
            rowStatus: "claimed",
            leaseUntil: LEASE_S,
            c1: "working",
            c1FinishAt: dur,
          },
        });
      }
    }

    // Advance clock to next interesting event (either lease expiry t=60 or C1 finish)
    if (state.c1 === "working") {
      if (state.t < LEASE_S && state.c1FinishAt > LEASE_S) {
        nexts.push({
          action: `ClockAdvance(t=${LEASE_S}s, lease expired while C1 still in-flight until ${state.c1FinishAt}s)`,
          state: { ...state, t: LEASE_S },
        });
      }
      if (state.t <= state.c1FinishAt) {
        nexts.push({
          action: `C1.SendAndMarkSent(t=${state.c1FinishAt}s)`,
          state: {
            ...state,
            t: Math.max(state.t, state.c1FinishAt),
            rowStatus: "sent",
            c1: "done",
            sendCount: state.sendCount + 1,
          },
        });
      }
    }

    // C2 cron wakes at t >= LEASE_S and reclaims if not sent and lease expired
    if (state.c2 === "idle" && state.t >= LEASE_S && state.rowStatus !== "sent" && state.t >= state.leaseUntil) {
      nexts.push({
        action: `C2.ReclaimExpiredAndSend(t=${state.t}s)`,
        state: {
          ...state,
          rowStatus: "sent",
          leaseUntil: state.t + LEASE_S,
          c2: "done",
          sendCount: state.sendCount + 1,
        },
      });
    }

    for (const item of nexts) {
      const k = keyOf(item.state);
      if (!visited.has(k)) {
        visited.add(k);
        queue.push({ state: item.state, trace: [...trace, item.action] });
      }
    }
  }

  return { ok: true, explored };
}
