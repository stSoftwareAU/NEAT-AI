/**
 * Tests for the `./quality.sh --gpu-scorer` pre-flight classifier
 * (Issue #3869).
 *
 * The lane's whole reason to exist is that a GPU run and a silent CPU run look
 * identical from the outside. These cases pin the three outcomes that matter:
 * a real backend proceeds, a host without a GPU skips cleanly, and a scorer
 * that demanded a GPU yet reported `cpu-fallback` fails loud.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  classifyGpuProbe,
  GPU_BACKEND_CPU_FALLBACK,
  readReportedBackends,
  type ScorerRun,
} from "../../scripts/lib/gpuScorerProbe.ts";

/** A directory-mode payload with the given backend per creature. */
function payload(...backends: string[]): string {
  const map: Record<string, unknown> = {};
  backends.forEach((backend, index) => {
    map[`probe-${index}`] = {
      score: 0.5,
      error: 0.25,
      gpuBackend: backend,
    };
  });
  return JSON.stringify(map);
}

function run(
  code: number,
  stdout: string,
  stderr = "",
): ScorerRun {
  return { code, stdout, stderr };
}

const CONTROL_OK = run(
  0,
  payload(GPU_BACKEND_CPU_FALLBACK, GPU_BACKEND_CPU_FALLBACK),
);

Deno.test("readReportedBackends returns one label per scored creature", () => {
  assertEquals(
    readReportedBackends(payload("metal", "metal")),
    ["metal", "metal"],
  );
});

Deno.test("readReportedBackends rejects non-JSON stdout", () => {
  const error = assertThrows(
    () => readReportedBackends("thread 'main' panicked"),
    Error,
  );
  assert(
    error.message.includes("was not JSON"),
    `unexpected message: ${error.message}`,
  );
});

Deno.test("readReportedBackends rejects a single-creature payload", () => {
  // Single-creature mode always reports cpu-fallback, so accepting its shape
  // would silently turn a GPU probe into a CPU measurement.
  const error = assertThrows(
    () =>
      readReportedBackends(
        JSON.stringify({ score: 0.5, gpuBackend: "metal" }),
      ),
    Error,
  );
  assert(
    error.message.includes("is not an object"),
    `unexpected message: ${error.message}`,
  );
});

Deno.test("readReportedBackends rejects a result missing gpuBackend", () => {
  const error = assertThrows(
    () => readReportedBackends(JSON.stringify({ "probe-0": { score: 0.5 } })),
    Error,
  );
  assert(
    error.message.includes("no gpuBackend"),
    `unexpected message: ${error.message}`,
  );
});

Deno.test("readReportedBackends rejects an empty result map", () => {
  assertThrows(() => readReportedBackends("{}"), Error);
});

Deno.test("classifyGpuProbe confirms a real backend", () => {
  const verdict = classifyGpuProbe(
    CONTROL_OK,
    run(0, payload("metal", "metal")),
  );
  assertEquals(verdict.kind, "gpu");
  assert(verdict.kind === "gpu");
  assertEquals(verdict.backend, "metal");
});

Deno.test("classifyGpuProbe reports every distinct backend it saw", () => {
  const verdict = classifyGpuProbe(
    CONTROL_OK,
    run(0, payload("vulkan", "metal")),
  );
  assert(verdict.kind === "gpu");
  assertEquals(verdict.backend, "metal,vulkan");
});

Deno.test("classifyGpuProbe skips when --gpu on finds no adapter", () => {
  const verdict = classifyGpuProbe(
    CONTROL_OK,
    run(1, "", "Error: No compatible GPU adapter found"),
  );
  assertEquals(verdict.kind, "skip");
  assert(
    verdict.detail.includes("No compatible GPU adapter found"),
    "the skip must quote the scorer's own reason",
  );
});

Deno.test("classifyGpuProbe fails loud when --gpu on reports cpu-fallback", () => {
  // The Issue #3869 regression: the lane exits 0 having scored on the CPU.
  const verdict = classifyGpuProbe(
    CONTROL_OK,
    run(0, payload("metal", GPU_BACKEND_CPU_FALLBACK)),
  );
  assertEquals(verdict.kind, "fail");
  assert(
    verdict.detail.includes(GPU_BACKEND_CPU_FALLBACK),
    `unexpected detail: ${verdict.detail}`,
  );
});

Deno.test("classifyGpuProbe fails loud when the CPU control run fails", () => {
  // A broken binary or fixture must not be mistaken for a missing GPU.
  const verdict = classifyGpuProbe(
    run(101, "", "Failed to read creature file"),
    run(1, "", "Error: No compatible GPU adapter found"),
  );
  assertEquals(verdict.kind, "fail");
  assert(
    verdict.detail.includes("not a skip"),
    `unexpected detail: ${verdict.detail}`,
  );
});

Deno.test("classifyGpuProbe fails loud when --gpu off reports a GPU backend", () => {
  // `off` never touches wgpu, so a GPU label there means the field this probe
  // reads no longer means what it assumes.
  const verdict = classifyGpuProbe(
    run(0, payload("metal", "metal")),
    run(0, payload("metal", "metal")),
  );
  assertEquals(verdict.kind, "fail");
  assert(
    verdict.detail.includes("no longer means"),
    `unexpected detail: ${verdict.detail}`,
  );
});

Deno.test("classifyGpuProbe fails loud on unreadable --gpu on output", () => {
  const verdict = classifyGpuProbe(CONTROL_OK, run(0, "not json at all"));
  assertEquals(verdict.kind, "fail");
  assert(
    verdict.detail.includes("unreadable"),
    `unexpected detail: ${verdict.detail}`,
  );
});
