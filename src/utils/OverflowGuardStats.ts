/**
 * Proactive weight/bias overflow-guard telemetry. Issue #2421.
 *
 * Issue #2378/#2384 added a reactive clamp at load time via
 * {@link clampWeightBiasDetail}. Issue #2421 extends that defence by clamping
 * proactively at every write site — mutation operators, backprop propagation,
 * predictive-coding Hebbian updates, and Rust/WASM FFI ingestion — before a
 * runaway value can propagate through scoring, mutation decisions, or
 * serialisation.
 *
 * This module provides:
 *   1. A tagged clamp helper {@link clampAndTrack} that records per-source
 *      clamp events.
 *   2. An in-memory counter keyed by logical source (mutation, training,
 *      predictive-coding, rust-ffi) that MemoryMonitor (and tests) can read.
 *   3. A reset helper for tests and per-run reporting.
 *
 * The counter is intentionally a small, module-level singleton: these events
 * are rare under healthy conditions, and aggregating them centrally lets us
 * surface "proactive clamp fired N times this run" in diagnostics. If the
 * counter is consistently high, that points at a still-unfixed propagation
 * bug upstream of the clamp — the clamp is a safety net, not a cure.
 *
 * @module
 */
import { clampWeightBiasDetail } from "@utils/WeightBiasClamp.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Logical source of a proactive weight/bias clamp event. Keeps counter keys
 * stable across releases so log scrapers can compare runs.
 */
export type OverflowGuardSource =
  | "mutation.weight"
  | "mutation.bias"
  | "mutation.synapse" // new-synapse weights (AddConnection / AddNeuron)
  | "training.weight"
  | "training.bias"
  | "predictiveCoding.weight"
  | "predictiveCoding.bias"
  | "rustFfi.weight"
  | "rustFfi.bias";

/**
 * Per-source counter of proactive clamp events since the last reset.
 */
export interface OverflowGuardStats {
  readonly counts: Readonly<Record<OverflowGuardSource, number>>;
  /** Total number of clamp events across all sources. */
  readonly total: number;
}

function emptyCounts(): Record<OverflowGuardSource, number> {
  return {
    "mutation.weight": 0,
    "mutation.bias": 0,
    "mutation.synapse": 0,
    "training.weight": 0,
    "training.bias": 0,
    "predictiveCoding.weight": 0,
    "predictiveCoding.bias": 0,
    "rustFfi.weight": 0,
    "rustFfi.bias": 0,
  };
}

/** Module-level counter — reset between runs or in tests. */
let _counts: Record<OverflowGuardSource, number> = emptyCounts();

/**
 * Clamp a weight/bias value and, if clamping actually occurred, increment the
 * per-source counter and emit a single `debug`-level log line.
 *
 * The caller supplies the {@link OverflowGuardSource} tag and, when helpful,
 * a free-form `context` string (creature UUID, operator name, synapse
 * endpoints) that is appended to the debug log. Debug is appropriate here
 * because a healthy run should produce zero clamps — a steady stream would
 * swamp info-level logs, but dropping events entirely would hide real bugs.
 *
 * @param value - The incoming weight or bias.
 * @param source - Logical source used for the counter key.
 * @param context - Optional free-form context string (operator, UUID, etc.).
 * @returns The clamped value.
 */
export function clampAndTrack(
  value: number,
  source: OverflowGuardSource,
  context?: string,
): number {
  const detail = clampWeightBiasDetail(value);
  if (detail.clamped) {
    _counts[source]++;
    getLogger().debug(
      `[OverflowGuard] Proactively clamped ${source}${
        context ? ` (${context})` : ""
      }: ${value} → ${detail.value}`,
    );
  }
  return detail.value;
}

/**
 * Snapshot the current per-source counter.
 *
 * The returned object is a defensive copy so callers cannot mutate the
 * module-level state.
 */
export function getOverflowGuardStats(): OverflowGuardStats {
  const counts = { ..._counts };
  let total = 0;
  for (const key of Object.keys(counts) as OverflowGuardSource[]) {
    total += counts[key];
  }
  return { counts, total };
}

/**
 * Reset the per-source counter. Intended for test isolation and for start-of-run
 * zeroing from the evolution loop.
 */
export function resetOverflowGuardStats(): void {
  _counts = emptyCounts();
}
