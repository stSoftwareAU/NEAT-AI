/**
 * WHAT-tests for the pure heap-budget functions in
 * `src/workers/WorkerHeapBudget.ts` (Issue #3247).
 *
 * The sibling file `test/workers/WorkerHeapBudget.ts` actually covers a
 * *different* module (`WorkerHandlerBase.ts`), leaving the four exported
 * functions here with no safety net. These tests assert the observable outputs
 * of those pure functions so any reimplementation that preserves the same
 * decisions keeps passing:
 *
 * - `resolveDiscoveryHeapBudgetMb` — env parsing / validation and the
 *   `MIN_BUDGET_MB` floor that stops a malformed value shrinking a worker.
 * - `describeBudgetPropagation` — the parent-side spawn log line.
 * - `planWorkerHeapBudget` — the shortfall decision, log level, and the
 *   operator remediation message (a GRQ-23 heap-inheritance regression guard).
 * - `currentHeapLimitMb` — reports a plausible positive isolate limit.
 */
import { assert, assertEquals } from "@std/assert";
import {
  currentHeapLimitMb,
  describeBudgetPropagation,
  DISCOVERY_HEAP_SIZE_ENV,
  type EnvReader,
  planWorkerHeapBudget,
  resolveDiscoveryHeapBudgetMb,
} from "@workers/WorkerHeapBudget.ts";

/** Build an {@link EnvReader} whose only key is `DISCOVERY_HEAP_SIZE_MB`. */
function envWith(value: string | undefined): EnvReader {
  return {
    get: (key) => key === DISCOVERY_HEAP_SIZE_ENV ? value : undefined,
  };
}

Deno.test("resolveDiscoveryHeapBudgetMb: returns the integer for a valid value", () => {
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("4096")), 4096);
});

Deno.test("resolveDiscoveryHeapBudgetMb: trims surrounding whitespace", () => {
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("  2048  ")), 2048);
});

Deno.test("resolveDiscoveryHeapBudgetMb: undefined when unset or empty", () => {
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith(undefined)), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("   ")), undefined);
});

Deno.test("resolveDiscoveryHeapBudgetMb: undefined for non-numeric or non-integer values", () => {
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("abc")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("2048.5")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("NaN")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("Infinity")), undefined);
});

Deno.test("resolveDiscoveryHeapBudgetMb: undefined below the MIN_BUDGET_MB floor", () => {
  // 64 MB is the floor; 10 and 63 are rejected so a bad value cannot shrink a
  // worker below the default, while the floor itself is accepted.
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("10")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("63")), undefined);
  assertEquals(resolveDiscoveryHeapBudgetMb(envWith("64")), 64);
});

Deno.test("resolveDiscoveryHeapBudgetMb: treats a throwing reader as unconfigured", () => {
  const throwing: EnvReader = {
    get: () => {
      throw new Deno.errors.PermissionDenied("no --allow-env");
    },
  };
  assertEquals(resolveDiscoveryHeapBudgetMb(throwing), undefined);
});

Deno.test("currentHeapLimitMb: reports a plausible positive isolate limit", () => {
  const limit = currentHeapLimitMb();
  assert(Number.isInteger(limit), `expected an integer, got ${limit}`);
  assert(limit > 0, `expected a positive heap limit, got ${limit}`);
});

Deno.test("describeBudgetPropagation: builds the spawn log line for a configured budget", () => {
  const line = describeBudgetPropagation("disc-worker", 4096);
  assert(line, "expected a log line for a configured budget");
  assert(line!.includes("disc-worker"), `missing worker name: ${line}`);
  assert(line!.includes("4096"), `missing budget: ${line}`);
  assert(
    line!.includes("--max-old-space-size=4096"),
    `missing flag: ${line}`,
  );
});

Deno.test("describeBudgetPropagation: undefined when no budget is configured", () => {
  assertEquals(describeBudgetPropagation("disc-worker", undefined), undefined);
});

Deno.test("planWorkerHeapBudget: within budget → no shortfall, info level", () => {
  const plan = planWorkerHeapBudget("disc-worker", 4096, 4192);
  assert(plan, "expected a plan for a configured budget");
  assertEquals(plan!.shortfall, false);
  assertEquals(plan!.level, "info");
  assertEquals(plan!.budgetMb, 4096);
  assertEquals(plan!.actualLimitMb, 4192);
  assertEquals(plan!.flags, ["--max-old-space-size=4096"]);
  assert(
    plan!.message.includes("within budget"),
    `expected within-budget message, got: ${plan!.message}`,
  );
});

Deno.test("planWorkerHeapBudget: an isolate at exactly the 90% threshold is within budget", () => {
  // floor(4096 * 0.9) = 3686; a limit >= that is not a shortfall.
  const plan = planWorkerHeapBudget("disc-worker", 4096, 3686);
  assert(plan);
  assertEquals(plan!.shortfall, false);
  assertEquals(plan!.level, "info");
});

Deno.test("planWorkerHeapBudget: materially smaller isolate → shortfall, warn, remediation message (GRQ-23)", () => {
  // GRQ-23 shape: 4096 MB configured but the isolate sits on the ~269 MB default.
  const plan = planWorkerHeapBudget("disc-worker", 4096, 269);
  assert(plan, "expected a plan for a configured budget");
  assertEquals(plan!.shortfall, true);
  assertEquals(plan!.level, "warn");
  assert(
    plan!.message.includes("SHORTFALL"),
    `expected shortfall message, got: ${plan!.message}`,
  );
  assert(
    plan!.message.includes("--max-old-space-size=4096"),
    `expected remediation flag, got: ${plan!.message}`,
  );
});

Deno.test("planWorkerHeapBudget: undefined when no budget is configured", () => {
  assertEquals(planWorkerHeapBudget("disc-worker", undefined, 269), undefined);
});
