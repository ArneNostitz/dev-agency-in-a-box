// Guarantees web/actions.js (the frontend port) stays 1:1 with src/actions.ts (the tested
// source of truth). If they ever diverge, this fails — so the duplication is safe.
import test from "node:test";
import assert from "node:assert/strict";
import { availableActions as tsActions } from "../dist/actions.js";
import { availableActions as jsActions } from "../web/actions.js";

const STATES = ["notPlanned", "planned", "working", "review", "done"];
const BLOCKED = [null, "awaitingApproval", "awaitingAnswer", "needsAttention", "conflict", "rateLimited", "budgetExceeded"];
const REVIEW = [undefined, "approved", "changes"];
const BOOL = [false, true];

test("web/actions.js matches src/actions.ts across the full status x facts matrix", () => {
  let n = 0;
  for (const state of STATES)
    for (const blocked of BLOCKED)
      for (const running of BOOL)
        for (const hasPr of BOOL)
          for (const review of REVIEW)
            for (const conflict of BOOL)
              for (const isEpic of BOOL)
                for (const approvedNoPr of BOOL)
                  for (const needsFix of BOOL) {
                    const status = { state, blocked };
                    const facts = { running, hasPr, review, conflict, isEpic, approvedNoPr, needsFix };
                    assert.deepEqual(
                      jsActions(status, facts),
                      tsActions(status, facts),
                      `mismatch for ${JSON.stringify({ status, facts })}`,
                    );
                    n++;
                  }
  assert.ok(n > 5000, `matrix should be large, was ${n}`);
});
