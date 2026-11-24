import type { D1Database, D1PreparedStatement, D1Result } from "./d1";

export interface GuardedBatchResult {
  applied: boolean;
  results: D1Result[];
}

export async function runGuardedBatch(
  db: D1Database,
  claim: D1PreparedStatement,
  dependents: D1PreparedStatement[],
): Promise<GuardedBatchResult> {
  const results = await db.batch([claim, ...dependents]);
  return {
    applied: (results[0]?.meta.changes ?? 0) > 0,
    results,
  };
}
