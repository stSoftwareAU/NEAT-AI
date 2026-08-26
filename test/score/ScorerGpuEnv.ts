/**
 * `scorerGpuEnv()` — the GPU mode every `rust_scorer` subprocess the suite
 * spawns is handed (Issue #3869).
 *
 * The default lane forces `NEAT_SCORER_GPU=off` because parallel wgpu contexts
 * exhaust the host. The opt-in `./quality.sh --gpu-scorer` lane exports
 * `auto` instead, and these cases pin that the helper carries the lane's
 * choice through rather than pinning every child back to `off` — a lane that
 * says GPU while every scorer call runs on the CPU is the exact false
 * confidence the lane exists to remove.
 */
import { assertEquals } from "@std/assert";
import { scorerGpuEnv } from "./NativeScorerFixtures.ts";

const VARIABLE = "NEAT_SCORER_GPU";

/** Run `fn` with `NEAT_SCORER_GPU` set to `value` (or removed), then restore. */
function withGpuEnv(value: string | undefined, fn: () => void): void {
  const original = Deno.env.get(VARIABLE);
  try {
    if (value === undefined) Deno.env.delete(VARIABLE);
    else Deno.env.set(VARIABLE, value);
    fn();
  } finally {
    if (original === undefined) Deno.env.delete(VARIABLE);
    else Deno.env.set(VARIABLE, original);
  }
}

Deno.test("scorerGpuEnv defaults to off when the lane sets nothing", () => {
  withGpuEnv(undefined, () => {
    assertEquals(scorerGpuEnv(), { NEAT_SCORER_GPU: "off" });
  });
});

Deno.test("scorerGpuEnv carries the GPU lane's auto mode through", () => {
  withGpuEnv("auto", () => {
    assertEquals(scorerGpuEnv(), { NEAT_SCORER_GPU: "auto" });
  });
});

Deno.test("scorerGpuEnv honours an explicit off from the default lane", () => {
  withGpuEnv("off", () => {
    assertEquals(scorerGpuEnv(), { NEAT_SCORER_GPU: "off" });
  });
});

Deno.test("scorerGpuEnv treats a blank value as unset", () => {
  withGpuEnv("   ", () => {
    assertEquals(scorerGpuEnv(), { NEAT_SCORER_GPU: "off" });
  });
});
