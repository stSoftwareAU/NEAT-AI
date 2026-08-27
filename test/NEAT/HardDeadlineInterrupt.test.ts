import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  failLoudIfInterruptIgnored,
  HARD_DEADLINE_INTERRUPT_GRACE_MS,
  HardDeadlineExceededError,
} from "@neat/HardDeadlineInterrupt.ts";

/**
 * GRQ #4418: the hard-deadline watchdog already detects a stalled phase and
 * aborts its signal, but an abort the awaited work never observes leaves the
 * unit running — GRQ-26 logged "interrupting" for 2h 42m past a 10-minute
 * timeout. The interrupt must therefore be *enforced*: work that ignores the
 * abort fails loud once the grace elapses.
 *
 * Grace is injected, so no test waits on the production 30s value (#2888).
 */

Deno.test("interrupt enforcement: work that ignores the abort fails loud after the grace", async () => {
  const controller = new AbortController();
  // Never settles — the wedge signature: fitness awaiting a scorer call that
  // will not return.
  const wedged = new Promise<void>(() => {});

  const guarded = failLoudIfInterruptIgnored(
    wedged,
    controller.signal,
    "fitness",
    5,
  );
  controller.abort();

  const error = await assertRejects(
    () => guarded,
    HardDeadlineExceededError,
  );
  assertEquals(error.phase, "fitness");
  assert(
    error.message.includes("fitness"),
    `message must name the stalled phase, got: ${error.message}`,
  );
});

Deno.test("interrupt enforcement: work that returns before the grace keeps its result", async () => {
  const controller = new AbortController();
  const cooperative = new Promise<string>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve("salvaged"));
  });

  const guarded = failLoudIfInterruptIgnored(
    cooperative,
    controller.signal,
    "fitness",
    10_000,
  );
  controller.abort();

  assertEquals(await guarded, "salvaged");
});

Deno.test("interrupt enforcement: an un-aborted run is untouched", async () => {
  const controller = new AbortController();
  const result = await failLoudIfInterruptIgnored(
    Promise.resolve(42),
    controller.signal,
    "fitness",
    1,
  );
  assertEquals(result, 42);
});

Deno.test("interrupt enforcement: the work's own failure wins over the deadline", async () => {
  const controller = new AbortController();
  const boom = new Error("Rust scorer batch call failed (exit 158)");

  const guarded = failLoudIfInterruptIgnored(
    Promise.reject(boom),
    controller.signal,
    "fitness",
    10_000,
  );

  const error = await assertRejects(() => guarded, Error);
  assertEquals(error, boom);
});

Deno.test("interrupt enforcement: an already-aborted signal still bounds the work", async () => {
  const controller = new AbortController();
  controller.abort();

  await assertRejects(
    () =>
      failLoudIfInterruptIgnored(
        new Promise(() => {}),
        controller.signal,
        "fitness",
        5,
      ),
    HardDeadlineExceededError,
  );
});

Deno.test("interrupt enforcement: the production grace is bounded and non-zero", () => {
  assert(
    HARD_DEADLINE_INTERRUPT_GRACE_MS > 0 &&
      HARD_DEADLINE_INTERRUPT_GRACE_MS <= 60_000,
    "a cooperative shutdown gets a grace, but never a further minute",
  );
});
