/**
 * Formal BFS state-space model: Order change_token D1 Batch Race & Coupon Return Atomicity
 * (Cavara bugs: migration 0007 stale-version batch double-apply, migration 0013 coupon cancel/reopen).
 *
 * Historical bug (progress-tracker.md:726-727):
 *   Two concurrent writers W1 and W2 read order (version=1, status='new').
 *   W1 runs batch: [UPDATE orders SET version=2 WHERE version=1, UPDATE stock/coupon WHERE version=2].
 *   W2's claim UPDATE changes 0 rows (version is already 2), BUT D1 does not roll back subsequent
 *   statements in the batch, so W2's dependent statement `WHERE version = 2` STILL MATCHES and
 *   double-applies stock return and coupon decrement!
 *
 * Safety invariants:
 *   1. couponUsedCount stays within [0, couponLimit] and equals (couponReturned ? 0 : 1).
 *   2. stock stays within [0, initialStock] and never double-returns.
 */
export const name = "order-change-token-and-coupon-return";

export function check({ buggy = false } = {}) {
  const initial = {
    version: 1,
    changeToken: "init",
    status: "new", // "new" | "cancelled"
    stock: 4, // started at 5, order took 1
    couponUsed: 1, // coupon limit = 1, order took 1
    couponReturned: false,
    // Two concurrent writers who both read version=1, status="new" and want to cancel
    w1: "read", // "read" | "claimed" | "done"
    w2: "read",
    w1Claimed: false,
    w2Claimed: false,
  };

  const keyOf = (s) =>
    `${s.version}|${s.changeToken}|${s.status}|${s.stock}|${s.couponUsed}|${s.couponReturned ? 1 : 0}|${s.w1}|${s.w2}|${s.w1Claimed ? 1 : 0}|${s.w2Claimed ? 1 : 0}`;

  const queue = [{ state: initial, trace: [] }];
  const visited = new Set([keyOf(initial)]);
  let explored = 0;

  while (queue.length > 0) {
    const { state, trace } = queue.shift();
    explored++;

    if (state.stock > 5 || state.stock < 4) {
      return {
        ok: false,
        explored,
        violation: `Double stock return detected: stock=${state.stock} (expected 4 or 5)`,
        trace,
      };
    }
    if (state.couponUsed < 0 || state.couponUsed > 1) {
      return {
        ok: false,
        explored,
        violation: `Coupon used_count out of bounds: couponUsed=${state.couponUsed} (expected 0 or 1)`,
        trace,
      };
    }

    const nexts = [];

    for (const w of ["w1", "w2"]) {
      const token = w === "w1" ? "tok-1" : "tok-2";
      const claimedField = w === "w1" ? "w1Claimed" : "w2Claimed";

      // Step A: Execute claim statement (UPDATE orders SET status='cancelled', version=2, change_token=token WHERE version=1)
      if (state[w] === "read") {
        const matched = state.version === 1;
        nexts.push({
          action: `${w.toUpperCase()}.ClaimUpdate(where version=1) -> ${matched ? "1 row" : "0 rows"}`,
          state: {
            ...state,
            version: matched ? 2 : state.version,
            changeToken: matched ? token : state.changeToken,
            status: matched ? "cancelled" : state.status,
            [w]: "claimed",
            [claimedField]: matched,
          },
        });
      }

      // Step B: Execute dependent statement in same D1 batch
      if (state[w] === "claimed") {
        // Buggy pre-0007 guard: checks `version = 2` (matches even when this writer's claim changed 0 rows!)
        // Fixed 0007+0013 guard: checks `change_token = token` AND `coupon_returned = 0`
        const depMatches = buggy ? state.version === 2 : state.changeToken === token && !state.couponReturned;
        nexts.push({
          action: `${w.toUpperCase()}.DependentStockAndCouponReturn(${buggy ? "where version=2" : `where change_token=${token}`}) -> ${depMatches ? "APPLIED" : "skipped"}`,
          state: {
            ...state,
            stock: depMatches ? state.stock + 1 : state.stock,
            couponUsed: depMatches ? state.couponUsed - 1 : state.couponUsed,
            couponReturned: depMatches ? true : state.couponReturned,
            [w]: "done",
          },
        });
      }
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
