/**
 * EvolveHardware.ts — best-effort host hardware descriptor for the run-level
 * evolve result (Issue #3422).
 *
 * Recording the machine an evolution ran on makes each `result.json` self
 * contained enough to compare throughput across the ~20-machine production
 * fleet without joining against an external inventory. The three descriptors —
 * CPU cores, total memory, and a host identifier — are the minimum needed to
 * normalise "variants checked per hour" against the hardware that produced it.
 *
 * Reads are best-effort: `Deno.systemMemoryInfo()` and `Deno.hostname()` need
 * the `--allow-sys` permission, so each reader is guarded and falls back to
 * `null` when the value is unavailable. A `null` is an explicit "unknown", not
 * a fault masked as success — the caller can see exactly which descriptor could
 * not be read.
 */

/**
 * Host hardware descriptors recorded on the evolve result. Each field is `null`
 * when the underlying runtime API is unavailable or permission was not granted.
 */
export interface HardwareDescriptor {
  /** Logical CPU cores (`navigator.hardwareConcurrency`). */
  readonly cpuCores: number | null;
  /** Total installed memory in bytes (`Deno.systemMemoryInfo().total`). */
  readonly totalMemoryBytes: number | null;
  /** Host identifier (`Deno.hostname()`). */
  readonly host: string | null;
}

function readCpuCores(): number | null {
  try {
    const cores = navigator.hardwareConcurrency;
    return typeof cores === "number" && Number.isFinite(cores) ? cores : null;
  } catch {
    return null;
  }
}

function readTotalMemoryBytes(): number | null {
  try {
    const total = Deno.systemMemoryInfo().total;
    return typeof total === "number" && Number.isFinite(total) ? total : null;
  } catch {
    // Permission (--allow-sys) not granted, or API unavailable.
    return null;
  }
}

function readHost(): string | null {
  try {
    const host = Deno.hostname();
    return typeof host === "string" && host.length > 0 ? host : null;
  } catch {
    // Permission (--allow-sys) not granted, or API unavailable.
    return null;
  }
}

/**
 * Read the host {@link HardwareDescriptor}. Never throws — unavailable
 * descriptors are reported as `null`.
 */
export function readHardwareDescriptor(): HardwareDescriptor {
  return {
    cpuCores: readCpuCores(),
    totalMemoryBytes: readTotalMemoryBytes(),
    host: readHost(),
  };
}
