/**
 * Formal BFS state-space model: Stock Counting Epochs (Cavara bug 2026-11-15, migration 0013).
 *
 * Historical bug (REVIEW-2026-11-15-new-features.md:58-68):
 *   stopCounting set stock = NULL but kept old stock_movements. Restarting counting at shelf
 *   recount R (say 10) and cancelling an old order of qty Q (say 5) returned Q into the new
 *   count (15), inventing phantom stock above the physical shelf count.
 *
 * Safety invariant:
 *   When counting is active at epoch E > 0, no cancel of an order placed in epoch < E may
 *   change the current stock count (stock must stay <= shelfRecount for epoch E).
 */
export const name = "stock-epoch-isolation";

export function check({ buggy = false } = {}) {
  const initial = {
    counting: true,
    epoch: 1,
    stock: 10,
    recountCap: 10,
    // Each order: { epoch, qty, status: "active" | "cancelled" }
    orders: [],
    steps: 0,
  };

  const MAX_ORDERS = 2;
  const MAX_EPOCH = 2;
  const keyOf = (s) =>
    `${s.counting ? 1 : 0}|${s.epoch}|${s.stock}|${s.recountCap}|${s.orders.map((o) => `${o.epoch}:${o.qty}:${o.status}`).join(",")}`;

  const queue = [{ state: initial, trace: [] }];
  const visited = new Set([keyOf(initial)]);
  let explored = 0;

  while (queue.length > 0) {
    const { state, trace } = queue.shift();
    explored++;

    // Safety invariant: stock must never exceed the current epoch's physical shelf cap, and never go negative.
    if (state.counting && (state.stock > state.recountCap || state.stock < 0)) {
      return {
        ok: false,
        explored,
        violation: `Phantom stock detected: stock=${state.stock} exceeds epoch ${state.epoch} shelf cap ${state.recountCap}`,
        trace,
      };
    }

    const nexts = [];

    // Action 1: Place order of qty 5
    if (state.orders.length < MAX_ORDERS) {
      if (!state.counting || state.stock >= 5) {
        nexts.push({
          action: `PlaceOrder(qty=5, epoch=${state.counting ? state.epoch : 0})`,
          state: {
            ...state,
            stock: state.counting ? state.stock - 5 : null,
            orders: [...state.orders, { epoch: state.counting ? state.epoch : 0, qty: 5, status: "active" }],
            steps: state.steps + 1,
          },
        });
      }
    }

    // Action 2: Stop counting
    if (state.counting) {
      nexts.push({
        action: "StopCounting()",
        state: { ...state, counting: false, stock: null, steps: state.steps + 1 },
      });
    }

    // Action 3: Start counting with physical shelf recount = 10 (bumps epoch)
    if (!state.counting && state.epoch < MAX_EPOCH) {
      const nextEpoch = state.epoch + 1;
      nexts.push({
        action: `StartCounting(recount=10, epoch=${nextEpoch})`,
        state: { ...state, counting: true, epoch: nextEpoch, stock: 10, recountCap: 10, steps: state.steps + 1 },
      });
    }

    // Action 4: Cancel any active order
    for (let i = 0; i < state.orders.length; i++) {
      const ord = state.orders[i];
      if (ord.status !== "active") continue;
      // Buggy pre-0013 behavior: returns stock whenever counting is active, ignoring ord.epoch
      // Fixed 0013 behavior: returns stock only when ord.epoch === state.epoch
      const returnsStock = state.counting && (buggy ? ord.epoch > 0 : ord.epoch === state.epoch);
      const nextOrders = state.orders.map((o, idx) => (idx === i ? { ...o, status: "cancelled" } : o));
      nexts.push({
        action: `CancelOrder(#${i + 1}, orderEpoch=${ord.epoch}, qty=${ord.qty})`,
        state: {
          ...state,
          stock: returnsStock ? state.stock + ord.qty : state.stock,
          orders: nextOrders,
          steps: state.steps + 1,
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
