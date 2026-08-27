import { assert, assertRejects } from "@std/assert";
import {
  __getBatchRunner,
  __resetInternal,
} from "../../src/score/RustScorerBridgeInternal.ts";

/**
 * GRQ #4418: the default runner used to race `cmd.output()` against a bare
 * timer — the timer rejected but the scorer child kept running, and an
 * unbounded (`timeoutMs: 0`) call could never be interrupted at all. Both the
 * timeout and the run's abort signal must kill the child and fail loud.
 *
 * `sleep` stands in for a wedged `rust_scorer`: it is present on every
 * supported platform and never returns within the test's lifetime.
 */

Deno.test("rust scorer runner: a timeout kills the child and fails loud", async () => {
  __resetInternal();
  const runner = __getBatchRunner();

  const error = await assertRejects(
    () => runner("sleep", ["120"], { timeoutMs: 50 }),
    Error,
  );
  assert(
    error.message.includes("timeout"),
    `message must name the timeout, got: ${error.message}`,
  );
});

Deno.test("rust scorer runner: an abort kills an unbounded child and fails loud", async () => {
  __resetInternal();
  const runner = __getBatchRunner();

  const controller = new AbortController();
  // timeoutMs 0 is the shipped default — before #4418 this call had no bound
  // of any kind.
  const pending = runner("sleep", ["120"], {
    timeoutMs: 0,
    signal: controller.signal,
  });
  controller.abort();

  const error = await assertRejects(() => pending, Error);
  assert(
    error.message.includes("abort"),
    `message must name the abort, got: ${error.message}`,
  );
});

Deno.test("rust scorer runner: a child that exits normally is unaffected", async () => {
  __resetInternal();
  const runner = __getBatchRunner();

  const controller = new AbortController();
  const result = await runner("sleep", ["0"], {
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  assert(result.success, "a clean exit must still succeed");
});
