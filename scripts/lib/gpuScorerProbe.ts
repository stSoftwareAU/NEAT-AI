/**
 * Pre-flight classification for the `./quality.sh --gpu-scorer` lane
 * (Issue #3869).
 *
 * The lane's regression risk is a run that *looks* like it exercised the GPU
 * but did not: `NEAT_SCORER_GPU` says `auto`, no adapter is available, and
 * `rust_scorer` silently scores on CPU. So the verdict is taken from the
 * scorer's **own reported backend** — the `gpuBackend` field of its directory
 * mode JSON — never from the environment variable it was handed.
 *
 * Two runs over one tiny fixture decide it, with no stderr string matching:
 *
 * 1. **Control** — `--gpu off`. Proves the binary and the probe fixture are
 *    sound, and that `gpuBackend` is being read from the right place (it must
 *    report `cpu-fallback`). A failing control is a broken probe, not a
 *    missing GPU, so it fails loud.
 * 2. **Demanded** — `--gpu on`. A non-zero exit means this host cannot give
 *    the scorer a GPU at all, which is a clean skip for a contributor without
 *    one. Exit 0 with `cpu-fallback` is the silent-CPU regression and fails
 *    loud.
 */

/** The label `rust_scorer` reports when a run did not touch a GPU backend. */
export const GPU_BACKEND_CPU_FALLBACK = "cpu-fallback";

/** One `rust_scorer` invocation's captured result. */
export interface ScorerRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * What the probe concluded.
 *
 * - `gpu` — a real backend ran; the lane may proceed.
 * - `skip` — this host has no usable GPU; skip the lane, exit 0.
 * - `fail` — the probe itself is untrustworthy, or the scorer silently ran on
 *   CPU while a GPU was demanded. Never downgrade this to a skip.
 */
export type GpuProbeVerdict =
  | { kind: "gpu"; backend: string; detail: string }
  | { kind: "skip"; detail: string }
  | { kind: "fail"; detail: string };

/**
 * Collect the `gpuBackend` label of every creature in a directory-mode
 * `rust_scorer` payload.
 *
 * Directory mode prints a JSON object keyed by creature stem, each value a
 * `ScoreResult` carrying `gpuBackend`. Anything else — malformed JSON, a
 * single-creature payload, a missing field, an empty map — throws rather than
 * returning a value the caller could mistake for "no GPU".
 *
 * @param stdout - the scorer's stdout, verbatim
 * @returns one backend label per scored creature, in payload order
 * @throws Error when the payload cannot be read as a directory-mode result
 */
export function readReportedBackends(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`rust_scorer stdout was not JSON (${reason})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "rust_scorer stdout was not a directory-mode object keyed by creature",
    );
  }

  const backends: string[] = [];
  for (const [stem, entry] of Object.entries(parsed)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`rust_scorer result for '${stem}' is not an object`);
    }
    const backend = (entry as { gpuBackend?: unknown }).gpuBackend;
    if (typeof backend !== "string" || backend.trim().length === 0) {
      throw new Error(
        `rust_scorer result for '${stem}' carries no gpuBackend field`,
      );
    }
    backends.push(backend.trim());
  }
  if (backends.length === 0) {
    throw new Error("rust_scorer scored no creatures in the probe fixture");
  }
  return backends;
}

/** Trim and label a captured stream so an empty one still reads clearly. */
function quote(label: string, text: string): string {
  const trimmed = text.trim();
  return trimmed.length === 0 ? `${label}: <empty>` : `${label}:\n${trimmed}`;
}

/**
 * Decide whether the GPU scorer lane may run, from two probe invocations.
 *
 * @param control - the `--gpu off` run over the probe fixture
 * @param demanded - the `--gpu on` run over the same fixture
 * @returns the verdict; `fail` is never returned for a merely absent GPU
 */
export function classifyGpuProbe(
  control: ScorerRun,
  demanded: ScorerRun,
): GpuProbeVerdict {
  if (control.code !== 0) {
    return {
      kind: "fail",
      detail:
        `rust_scorer --gpu off failed on the probe fixture (exit ${control.code}). ` +
        `The probe cannot tell a missing GPU from a broken scorer, so this is not a skip.\n` +
        quote("stderr", control.stderr),
    };
  }

  let controlBackends: string[];
  try {
    controlBackends = readReportedBackends(control.stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      kind: "fail",
      detail:
        `rust_scorer --gpu off produced an unreadable result: ${reason}\n` +
        quote("stdout", control.stdout),
    };
  }

  const unexpected = controlBackends.filter((b) =>
    b !== GPU_BACKEND_CPU_FALLBACK
  );
  if (unexpected.length > 0) {
    return {
      kind: "fail",
      detail:
        `rust_scorer --gpu off reported backend(s) ${unexpected.join(", ")}; ` +
        `expected every creature to report ${GPU_BACKEND_CPU_FALLBACK}. ` +
        `The gpuBackend field no longer means what this probe assumes.`,
    };
  }

  if (demanded.code !== 0) {
    return {
      kind: "skip",
      detail:
        `rust_scorer --gpu on exited ${demanded.code}: this host has no usable GPU backend.\n` +
        quote("stderr", demanded.stderr),
    };
  }

  let backends: string[];
  try {
    backends = readReportedBackends(demanded.stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      kind: "fail",
      detail:
        `rust_scorer --gpu on produced an unreadable result: ${reason}\n` +
        quote("stdout", demanded.stdout),
    };
  }

  if (backends.includes(GPU_BACKEND_CPU_FALLBACK)) {
    return {
      kind: "fail",
      detail:
        `rust_scorer --gpu on exited 0 but reported ${GPU_BACKEND_CPU_FALLBACK}. ` +
        `The lane would have looked green while every score ran on the CPU.\n` +
        quote("stderr", demanded.stderr),
    };
  }

  const distinct = [...new Set(backends)].sort();
  return {
    kind: "gpu",
    backend: distinct.join(","),
    detail: `rust_scorer selected GPU backend ${distinct.join(", ")}.`,
  };
}
