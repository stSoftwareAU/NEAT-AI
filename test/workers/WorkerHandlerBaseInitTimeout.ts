/**
 * Tests for the getInitTimeoutMs function from WorkerHandlerBase.
 *
 * Issue #1698: Validates environment-based timeout configuration.
 * Issue #4034: the environment is injected rather than set on the shared
 * process, which `deno test --parallel` shares across every test file.
 */
import { assertEquals } from "@std/assert";
import { getInitTimeoutMs } from "@workers/WorkerHandlerBase.ts";

/** An environment holding only the init-timeout variable (or nothing). */
function envWith(value: string | undefined) {
  return (key: string) =>
    key === "NEAT_AI_WORKER_INIT_TIMEOUT_MS" ? value : undefined;
}

Deno.test("getInitTimeoutMs: returns default 60000 when env not set", () => {
  assertEquals(getInitTimeoutMs(envWith(undefined)), 60_000);
});

Deno.test("getInitTimeoutMs: returns custom value from env", () => {
  assertEquals(getInitTimeoutMs(envWith("30000")), 30_000);
});

Deno.test("getInitTimeoutMs: returns default for values below 1000", () => {
  assertEquals(getInitTimeoutMs(envWith("500")), 60_000);
});

Deno.test("getInitTimeoutMs: returns default for non-numeric env value", () => {
  assertEquals(getInitTimeoutMs(envWith("not-a-number")), 60_000);
});

Deno.test("getInitTimeoutMs: returns default for empty string", () => {
  assertEquals(getInitTimeoutMs(envWith("")), 60_000);
});

Deno.test("getInitTimeoutMs: defaults to the real environment when not injected", () => {
  const expected = getInitTimeoutMs((key) => Deno.env.get(key));
  assertEquals(getInitTimeoutMs(), expected);
});
