/**
 * Worker-spawn contract test for the discovery V8 heap budget (Issue #3024,
 * TDD item 2 of #3022).
 *
 * Pins down that when a discovery heap budget is configured, worker creation
 * consumes it and surfaces a heap-limit decision — without spawning a real
 * worker. The budget resolution and the spawn-time verification are pure,
 * injectable functions on `WorkerHandlerBase`, so this exercises the production
 * read path through the same `DISCOVERY_HEAP_SIZE_MB` input contract the
 * external discovery runner sets.
 *
 * Deno mechanism (verified, see WorkerHandlerBase.ts:135): spawned Web Worker
 * isolates inherit the parent's process-level `--v8-flags`/`DENO_V8_FLAGS`;
 * there is no per-worker heap option and runtime `Deno.env.set` is ineffective.
 * The library therefore consumes the configured budget and verifies/logs the
 * effective worker heap limit, warning when the process was not launched with
 * the matching flag.
 */
import { assert, assertEquals } from "@std/assert";
import type { Logger } from "@utils/Logger.ts";
import {
  DISCOVERY_HEAP_SIZE_ENV,
  parseMaxOldSpaceMb,
  requiredWorkerV8Flag,
  resolveWorkerHeapBudgetMb,
  verifyWorkerHeapBudget,
} from "@workers/WorkerHandlerBase.ts";

function makeRecordingLogger() {
  const lines: { level: string; message: string }[] = [];
  const logger: Logger = {
    debug: (...a) => lines.push({ level: "debug", message: a.join(" ") }),
    info: (...a) => lines.push({ level: "info", message: a.join(" ") }),
    warn: (...a) => lines.push({ level: "warn", message: a.join(" ") }),
    error: (...a) => lines.push({ level: "error", message: a.join(" ") }),
  };
  return { logger, lines };
}

/** Build an env getter from a plain record for hermetic tests. */
function envFrom(
  map: Record<string, string>,
): (k: string) => string | undefined {
  return (k) => (k in map ? map[k] : undefined);
}

Deno.test("resolveWorkerHeapBudgetMb: consumes the DISCOVERY_HEAP_SIZE_MB input contract", () => {
  const budget = resolveWorkerHeapBudgetMb(
    envFrom({ [DISCOVERY_HEAP_SIZE_ENV]: "4096" }),
  );
  assertEquals(budget, 4096);
});

Deno.test("resolveWorkerHeapBudgetMb: falls back to parent --max-old-space-size from DENO_V8_FLAGS", () => {
  const budget = resolveWorkerHeapBudgetMb(
    envFrom({ DENO_V8_FLAGS: "--max-old-space-size=2048 --expose-gc" }),
  );
  assertEquals(budget, 2048);
});

Deno.test("resolveWorkerHeapBudgetMb: DISCOVERY_HEAP_SIZE_MB takes precedence over DENO_V8_FLAGS", () => {
  const budget = resolveWorkerHeapBudgetMb(
    envFrom({
      [DISCOVERY_HEAP_SIZE_ENV]: "4096",
      DENO_V8_FLAGS: "--max-old-space-size=2048",
    }),
  );
  assertEquals(budget, 4096);
});

Deno.test("resolveWorkerHeapBudgetMb: undefined when no source configured", () => {
  assertEquals(resolveWorkerHeapBudgetMb(envFrom({})), undefined);
});

Deno.test("resolveWorkerHeapBudgetMb: rejects non-positive / non-numeric values", () => {
  assertEquals(
    resolveWorkerHeapBudgetMb(envFrom({ [DISCOVERY_HEAP_SIZE_ENV]: "0" })),
    undefined,
  );
  assertEquals(
    resolveWorkerHeapBudgetMb(envFrom({ [DISCOVERY_HEAP_SIZE_ENV]: "-512" })),
    undefined,
  );
  assertEquals(
    resolveWorkerHeapBudgetMb(envFrom({ [DISCOVERY_HEAP_SIZE_ENV]: "abc" })),
    undefined,
  );
});

Deno.test("parseMaxOldSpaceMb: extracts the MB value from a flags string", () => {
  assertEquals(parseMaxOldSpaceMb("--max-old-space-size=8192"), 8192);
  assertEquals(parseMaxOldSpaceMb("--max-old-space-size 8192"), 8192);
  assertEquals(parseMaxOldSpaceMb("--expose-gc"), undefined);
  assertEquals(parseMaxOldSpaceMb(undefined), undefined);
});

Deno.test("requiredWorkerV8Flag: produces the process-launch flag workers inherit", () => {
  assertEquals(requiredWorkerV8Flag(4096), "--max-old-space-size=4096");
});

Deno.test("verifyWorkerHeapBudget: returns the configured budget and logs at info when the heap limit matches", () => {
  const { logger, lines } = makeRecordingLogger();
  const budget = verifyWorkerHeapBudget(
    "disc-worker-1",
    envFrom({ [DISCOVERY_HEAP_SIZE_ENV]: "4096" }),
    () => 4192, // worker inherits a parent-proportional heap (4096 + overhead)
    logger,
  );
  assertEquals(budget, 4096);
  const info = lines.find((l) => l.level === "info");
  assert(info, "expected an info heap-limit log line");
  assert(
    info!.message.includes("4096"),
    `expected log to mention budget, got: ${info!.message}`,
  );
});

Deno.test("verifyWorkerHeapBudget: warns when the worker heap limit is materially below the configured budget (GRQ-23 regression)", () => {
  const { logger, lines } = makeRecordingLogger();
  // The GRQ-23 shape: budget 4096 MB configured, but the isolate is on the
  // ~269 MB Deno default because the process was not launched with the flag.
  const budget = verifyWorkerHeapBudget(
    "disc-worker-2",
    envFrom({ [DISCOVERY_HEAP_SIZE_ENV]: "4096" }),
    () => 269,
    logger,
  );
  assertEquals(budget, 4096);
  const warn = lines.find((l) => l.level === "warn");
  assert(warn, "expected a warning when worker heap is below the budget");
  assert(
    warn!.message.includes(requiredWorkerV8Flag(4096)),
    `expected warning to tell the operator the required flag, got: ${
      warn!.message
    }`,
  );
});

Deno.test("verifyWorkerHeapBudget: uses the module-private readV8HeapLimitMb default when no heap reader is supplied (Issue #3316)", () => {
  // No `heapLimitMb` argument, so the call falls through to the module-private
  // `readV8HeapLimitMb` default. It must still resolve the configured budget and
  // emit a heap-limit log line — this guards the internal default now that the
  // symbol is no longer exported.
  const { logger, lines } = makeRecordingLogger();
  const budget = verifyWorkerHeapBudget(
    "disc-worker-default",
    envFrom({ [DISCOVERY_HEAP_SIZE_ENV]: "4096" }),
    undefined,
    logger,
  );
  assertEquals(budget, 4096);
  assert(
    lines.some((l) => l.message.includes("4096")),
    "expected a heap-limit log line mentioning the budget via the default reader",
  );
});

Deno.test("verifyWorkerHeapBudget: no budget configured returns undefined and does not warn", () => {
  const { logger, lines } = makeRecordingLogger();
  const budget = verifyWorkerHeapBudget(
    "disc-worker-3",
    envFrom({}),
    () => 269,
    logger,
  );
  assertEquals(budget, undefined);
  assertEquals(lines.some((l) => l.level === "warn"), false);
});
