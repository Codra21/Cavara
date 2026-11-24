#!/usr/bin/env node
/**
 * Runs all Cavara formal state-space models.
 *   node formal/run-models.mjs          -> CI mode: verifies every fixed model has 0 invariant violations.
 *   node formal/run-models.mjs --prove  -> Proof mode: first runs each model in --buggy mode to prove it
 *                                          replays the real past bug and FAILS, then verifies the fixed model PASSES.
 */
import * as stockEpoch from "./models/stock-epoch.model.mjs";
import * as orderChangeToken from "./models/order-change-token.model.mjs";
import * as outboxLease from "./models/outbox-lease.model.mjs";
import * as r2CasTurnstile from "./models/r2-cas-and-turnstile.model.mjs";

const MODELS = [stockEpoch, orderChangeToken, outboxLease, r2CasTurnstile];
const prove = process.argv.includes("--prove");

let failed = false;

for (const model of MODELS) {
  if (prove) {
    const buggyRes = model.check({ buggy: true });
    if (buggyRes.ok) {
      console.error(`PROOF FAILED [${model.name}]: buggy mode did NOT fail as expected!`);
      failed = true;
      continue;
    }
    console.log(`PROVED [${model.name}] buggy replay FAILED as expected (${buggyRes.explored} states):`);
    console.log(`  Violation: ${buggyRes.violation}`);
    console.log(`  Trace:     ${buggyRes.trace.join(" -> ")}`);
  }

  const fixedRes = model.check({ buggy: false });
  if (!fixedRes.ok) {
    console.error(`FAIL [${model.name}] fixed model violated invariant: ${fixedRes.violation}`);
    console.error(`  Trace: ${fixedRes.trace.join(" -> ")}`);
    failed = true;
  } else {
    console.log(`PASS [${model.name}] fixed model verified (${fixedRes.explored} reachable states, 0 violations)`);
  }
}

if (failed) process.exit(1);
console.log(`\nALL ${MODELS.length} FORMAL MODELS VERIFIED${prove ? " (WITH BUG-REPLAY PROOFS)" : ""}.`);
