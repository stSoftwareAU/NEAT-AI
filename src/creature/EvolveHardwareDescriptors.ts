/**
 * Hardware descriptors recorded on the run-level evolve result so a persisted
 * `result.json` is self-contained enough to compare configurations across
 * machines (Issue #3422).
 *
 * Nigel wants to work out the optimal evolution configuration for various
 * hardware — most-variants-checked-per-hour is the proxy — so each run must
 * carry the CPU core count, total physical memory, and a host identifier of the
 * machine it ran on. Without these, throughput numbers from two machines cannot
 * be told apart downstream.
 *
 * Each descriptor is captured independently and best-effort: reading total
 * memory and the hostname needs the `--allow-sys` permission, which is not
 * granted in every context (the test runner deliberately omits it). A denied
 * permission is not a run failure — it is honestly recorded as `null` rather
 * than crashing the evolve loop or masking the gap with a fake value.
 */

/** Machine descriptors captured once at the end of an evolve run. */
export interface HardwareDescriptors {
  /**
   * Logical CPU core count from `navigator.hardwareConcurrency`. `null` only
   * when the runtime does not expose it.
   */
  readonly cpuCores: number | null;
  /**
   * Total physical memory in bytes from `Deno.systemMemoryInfo()`. `null` when
   * the `--allow-sys=systemMemoryInfo` permission is not granted.
   */
  readonly totalMemoryBytes: number | null;
  /**
   * Host identifier from `Deno.hostname()`. `null` when the
   * `--allow-sys=hostname` permission is not granted.
   */
  readonly host: string | null;
}

/**
 * Capture the {@link HardwareDescriptors} of the current machine. Each field is
 * read independently so a single denied permission does not blank the others.
 */
export function captureHardwareDescriptors(): HardwareDescriptors {
  return {
    cpuCores: readCpuCores(),
    totalMemoryBytes: readTotalMemoryBytes(),
    host: readHost(),
  };
}

/** Logical CPU cores; needs no permission. `null` if the runtime hides it. */
function readCpuCores(): number | null {
  const cores = navigator.hardwareConcurrency;
  return typeof cores === "number" && Number.isFinite(cores) && cores > 0
    ? cores
    : null;
}

/**
 * Total physical memory in bytes. Returns `null` when the permission is denied
 * (or the platform reports a non-positive total) rather than throwing.
 */
function readTotalMemoryBytes(): number | null {
  try {
    const total = Deno.systemMemoryInfo().total;
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    // Permission denied (--allow-sys not granted) or unsupported platform.
    // Best-effort metadata: record the gap as null, do not fail the run.
    return null;
  }
}

/** Host identifier. Returns `null` when the permission is denied. */
function readHost(): string | null {
  try {
    const host = Deno.hostname();
    return typeof host === "string" && host.length > 0 ? host : null;
  } catch {
    // Permission denied (--allow-sys not granted): record the gap as null.
    return null;
  }
}
