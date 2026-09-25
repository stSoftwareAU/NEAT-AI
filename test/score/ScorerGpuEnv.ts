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

/**
 * An environment where `NEAT_SCORER_GPU` holds `value` (or is unset). Injected
 * rather than set on the shared process environment, which every file under
 * `deno test --parallel` reads (Issue #4034).
 */
function gpuEnv(value: string | undefined) {
  return (key: string) => key === VARIABLE ? value : undefined;
}

Deno.test("scorerGpuEnv defaults to off when the lane sets nothing", () => {
  assertEquals(scorerGpuEnv(gpuEnv(undefined)), { NEAT_SCORER_GPU: "off" });
});

Deno.test("scorerGpuEnv carries the GPU lane's auto mode through", () => {
  assertEquals(scorerGpuEnv(gpuEnv("auto")), { NEAT_SCORER_GPU: "auto" });
});

Deno.test("scorerGpuEnv honours an explicit off from the default lane", () => {
  assertEquals(scorerGpuEnv(gpuEnv("off")), { NEAT_SCORER_GPU: "off" });
});

Deno.test("scorerGpuEnv treats a blank value as unset", () => {
  assertEquals(scorerGpuEnv(gpuEnv("   ")), { NEAT_SCORER_GPU: "off" });
});

Deno.test("scorerGpuEnv keeps the safe default when the environment is unreadable", () => {
  const unreadable = (): string | undefined => {
    throw new Deno.errors.NotCapable("no env permission");
  };
  assertEquals(scorerGpuEnv(unreadable), { NEAT_SCORER_GPU: "off" });
});
