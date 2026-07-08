/**
 * WHAT-test for the discovery V8 heap-budget core (Issue #3247).
 *
 * The colliding file `test/workers/WorkerHeapBudget.ts` actually imports and
 * exercises the parallel implementation in `WorkerHandlerBase.ts`; the exported
 * functions in `src/workers/WorkerHeapBudget.ts` had no test asserting their
 * observable behaviour. This file closes that gap.
 *
 * These are WHAT-tests: they assert the observable outputs of the pure
 * functions (no mocking of internals), so they keep passing across any
 * reimplementation that preserves the same shortfall/floor/message decisions —
 * they protect behaviour, not the current code. The behaviour they guard:
 *   - the `MIN_BUDGET_MB` floor and malformed-value rejection that "can never
 *     shrink a worker below the default",
 *   - the `SHORTFALL_FRACTION` shortfall comparison and warn-versus-info level,
 *   - the operator-facing `--max-old-space-size` remediation message
 *     (a GRQ-23 heap-inheritance regression guard).
 */
import { assert, assertEquals } from "@std/assert";
import {
  currentHeapLimitMb,
  describeBudgetPropagation,
  type EnvReader,
  planWorkerHeapBudget,
  resolveDiscoveryHeapBudgetMb,
} from "@workers/WorkerHeapBudget.ts";

/** Build an {@link EnvReader} that always returns the given value. */
function envReturning(value: string | undefined): EnvReader {
  return { get: () => value };
}

Deno.test("resolveDiscoveryHeapBudgetMb: returns the integer for a valid value", () => {
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("4096")), 4096);
});

Deno.test("resolveDiscoveryHeapBudgetMb: trims surrounding whitespace", () => {
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("  2048  ")), 2048);
});

Deno.test("resolveDiscoveryHeapBudgetMb: undefined for unset / empty values", () => {
  assertEquals(
    resolveDiscoveryHeapBudgetMb(envReturning(undefined)),
    undefined,
  );
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("   ")), undefined);
});

Deno.test("resolveDiscoveryHeapBudgetMb: undefined for non-numeric / non-integer values", () => {
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("abc")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("4096.5")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("NaN")), undefined);
});

Deno.test("resolveDiscoveryHeapBudgetMb: undefined below the MIN_BUDGET_MB floor", () => {
  // A malformed / too-small value must never shrink a worker below the default.
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("10")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("63")), undefined);
  // 64 is the floor and is accepted.
  assertEquals(resolveDiscoveryHeapBudgetMb(envReturning("64")), 64);
});

Deno.test("resolveDiscoveryHeapBudgetMb: treats an env reader that throws as unconfigured", () => {
  const throwing: EnvReader = {
    get: () => {
      throw new Error("no --allow-env");
    },
  };
  assertEquals(resolveDiscoveryHeapBudgetMb(throwing), undefined);
});

Deno.test("currentHeapLimitMb: reports a positive integer heap limit", () => {
  const mb = currentHeapLimitMb();
  assert(Number.isInteger(mb), `expected an integer, got ${mb}`);
  assert(mb > 0, `expected a positive heap limit, got ${mb}`);
});

Deno.test("describeBudgetPropagation: describes a configured budget", () => {
  const line = describeBudgetPropagation("disc-worker-1", 4096);
  assert(line, "expected a log line for a configured budget");
  assert(line!.includes("disc-worker-1"), `missing worker name: ${line}`);
  assert(
    line!.includes("--max-old-space-size=4096"),
    `missing budget flag: ${line}`,
  );
});

Deno.test("describeBudgetPropagation: undefined when no budget is configured", () => {
  assertEquals(
    describeBudgetPropagation("disc-worker-1", undefined),
    undefined,
  );
});

Deno.test("planWorkerHeapBudget: within-budget limit is info with no shortfall", () => {
  const plan = planWorkerHeapBudget("disc-worker-1", 4096, 4192);
  assert(plan, "expected a plan for a configured budget");
  assertEquals(plan!.shortfall, false);
  assertEquals(plan!.level, "info");
  assertEquals(plan!.budgetMb, 4096);
  assertEquals(plan!.actualLimitMb, 4192);
  assertEquals(plan!.flags[0], "--max-old-space-size=4096");
  assert(
    plan!.message.includes("within budget"),
    `expected within-budget message, got: ${plan!.message}`,
  );
});

Deno.test("planWorkerHeapBudget: at the 90% shortfall boundary stays within budget", () => {
  // shortfall === actual < floor(budget * 0.9); floor(4096 * 0.9) = 3686.
  assertEquals(planWorkerHeapBudget("w", 4096, 3686)!.shortfall, false);
  assertEquals(planWorkerHeapBudget("w", 4096, 3685)!.shortfall, true);
});

Deno.test("planWorkerHeapBudget: materially smaller limit warns with remediation (GRQ-23)", () => {
  // The GRQ-23 shape: 4096 MB configured, isolate stuck on the ~269 MB default.
  const plan = planWorkerHeapBudget("disc-worker-2", 4096, 269);
  assert(plan, "expected a plan for a configured budget");
  assertEquals(plan!.shortfall, true);
  assertEquals(plan!.level, "warn");
  assert(
    plan!.message.includes("SHORTFALL"),
    `expected shortfall message, got: ${plan!.message}`,
  );
  assert(
    plan!.message.includes("--max-old-space-size=4096"),
    `expected the --max-old-space-size remediation, got: ${plan!.message}`,
  );
});

Deno.test("planWorkerHeapBudget: undefined when no budget is configured", () => {
  assertEquals(
    planWorkerHeapBudget("disc-worker-3", undefined, 269),
    undefined,
  );
});
