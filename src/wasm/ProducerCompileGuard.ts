/**
 * ProducerCompileGuard.ts — Producer-side WASM compile sanity gate.
 *
 * Issue #2636: Mutation / breeding occasionally emits topologies that compile
 * cleanly through `creatureValidate({ forwardOnly: true })` yet still trap with
 * `RuntimeError: unreachable` inside `CompiledNetwork::new` (the NEAT-AI-core
 * binary parser). The downstream call-site recovery (#2482 / #2483) catches the
 * trap and drops the creature, but the offending genome should never have left
 * the producer in the first place. This module adds a small probe that:
 *
 *  1. Attempts a real WASM compile of the producer's output (via the cached
 *     compilation path so the work is reused at usage time).
 *  2. On failure, runs `creature.fix({ forwardOnly })` to strip bad synapses
 *     and repair the topology, then retries the compile once.
 *  3. Reports the final outcome and the trap message so callers can either
 *     repair, revert to a pre-mutation snapshot, or drop the offspring.
 *
 * The probe is intentionally light:
 *
 *  - It re-uses `getOrCompileWasmModule`, so a freshly-mutated creature that
 *    will be activated immediately afterwards (the normal training path) pays
 *    one compile only — the second call hits the topology cache.
 *  - The probe `free()`s the resulting activation immediately. Buffer pool
 *    reuse keeps allocations bounded.
 *  - When WASM activation is unavailable the probe is a no-op (returns
 *    `{ ok: true, skipped: true }`).
 *
 * Issue #2685: Producers thread a `producerStep` label through the gate so
 * the rejection diagnostic dump, warning line, and periodic histogram can
 * attribute a bad topology to the specific operator (e.g. `AddNeuron.split`,
 * `repairForwardOnlyComputationalInbounds`, `crisprInsertSubgraph`) rather
 * than just the surrounding producer name.
 */

import type { Creature } from "@creature";
import { isWasmActivationAvailable } from "@wasm/WasmModuleLoader.ts";
import {
  getLastWasmCreateFailure,
  resetLastWasmCreateFailure,
} from "@wasm/WasmActivation.ts";
import { getOrCompileWasmModule } from "@wasm/WasmCompilationCache.ts";
import { getLogger } from "@utils/Logger.ts";

/** Result returned by the producer-side compile gate. */
export interface ProducerCompileResult {
  /** True if the creature compiles cleanly to WASM (or the probe was skipped). */
  ok: boolean;
  /** True when WASM activation is unavailable and the probe was skipped. */
  skipped?: boolean;
  /** True when a `fix()` repair pass made the creature compilable. */
  repaired?: boolean;
  /** The trap message recorded by `WasmCreatureActivation.create`, if any. */
  trapMessage?: string;
  /**
   * Issue #2685: The last producer-step label set via `setProducerStep` at
   * the moment the gate fired. `undefined` when no producer set a step
   * (e.g. legacy call sites). Used by callers to enrich the diagnostic dump
   * and warning line.
   */
  producerStep?: string;
}

/**
 * Issue #2685: Module-local label naming the operator/sub-step currently
 * executing inside a producer. Producers call `setProducerStep("AddNeuron")`
 * before applying their mutation and clear it on success; if the producer
 * gate fires while the label is set, the rejection record names that step.
 */
let currentProducerStep: string | undefined;

/**
 * Issue #2685: Set the label naming the operator/sub-step currently
 * executing inside a producer. Pass `undefined` to clear. This is the
 * cheapest threading the issue calls for — no per-call argument plumbing
 * through every producer code path.
 */
export function setProducerStep(label: string | undefined): void {
  currentProducerStep = label;
}

/**
 * Issue #2685: Read the currently-active producer step label. Returns
 * `undefined` when no producer has set one.
 */
export function getProducerStep(): string | undefined {
  return currentProducerStep;
}

/**
 * Issue #2685: Run `fn` with `label` installed as the current producer step,
 * restoring the previous label (or clearing it) when `fn` returns. The label
 * is preserved on error so the gate diagnostic still records the right step.
 */
export function withProducerStep<T>(label: string, fn: () => T): T {
  const previous = currentProducerStep;
  currentProducerStep = label;
  try {
    return fn();
  } finally {
    currentProducerStep = previous;
  }
}

/**
 * Attempt to compile `creature` to WASM and immediately release the
 * activation. Returns `true` when the compile succeeds. Does **not** mutate
 * the creature.
 */
function tryCompile(creature: Creature): {
  ok: boolean;
  trapMessage?: string;
} {
  // Drop any cached activation so the probe sees the current topology.
  creature.cachedWasmActivation = undefined;
  resetLastWasmCreateFailure();
  let activation: ReturnType<typeof getOrCompileWasmModule>;
  try {
    activation = getOrCompileWasmModule(creature);
  } catch (err) {
    // A throw inside the cache (e.g. malformed header, oversized buffer) is
    // observationally identical to the WASM constructor trap: the offending
    // topology cannot leave the producer. Surface the message so callers can
    // log a single line per reject.
    return {
      ok: false,
      trapMessage: err instanceof Error ? err.message : String(err),
    };
  }
  if (activation === null) {
    const failure = getLastWasmCreateFailure();
    return {
      ok: false,
      trapMessage: failure?.message ?? "unknown WASM compile failure",
    };
  }
  // The cache owns the topology template; releasing the wrapper frees only
  // the per-creature WASM instance memory.
  try {
    activation.free();
  } catch (_err) {
    // free() may throw if the network was invalidated mid-call; that is
    // already handled inside `WasmCreatureActivation.free()` itself. We
    // swallow here because the caller only cares about the compile outcome.
  }
  // Ensure the probe does not leave a stale activation reference behind.
  creature.cachedWasmActivation = undefined;
  return { ok: true };
}

/**
 * Run a WASM compile sanity check on producer output. If the compile fails,
 * attempt a one-shot repair via `creature.fix({ forwardOnly })` and probe
 * again. The returned result tells the caller whether the topology is fit
 * to leave the producer.
 *
 * Callers should treat `{ ok: false }` as a hard reject — revert the mutation,
 * drop the offspring, or surface a typed error to the surrounding evolution
 * loop.
 */
export function ensureProducerOutputCompiles(
  creature: Creature,
): ProducerCompileResult {
  if (!isWasmActivationAvailable()) {
    return { ok: true, skipped: true };
  }

  const first = tryCompile(creature);
  if (first.ok) {
    return { ok: true };
  }

  // Repair attempt: rerun `fix()` to strip self/back/duplicate synapses,
  // re-link orphan hidden/output neurons, and clean up disconnected hidden
  // neurons. This is the same repair path that breed/mutate already use,
  // so the cost is bounded.
  const forwardOnly = creature.forwardOnly === true;
  try {
    creature.fix({ forwardOnly });
  } catch (_err) {
    // A repair failure means the creature is too broken to recover —
    // surface the original trap message and let the caller drop it.
    return {
      ok: false,
      trapMessage: first.trapMessage,
      producerStep: currentProducerStep,
    };
  }

  const second = tryCompile(creature);
  if (second.ok) {
    return { ok: true, repaired: true };
  }

  return {
    ok: false,
    trapMessage: second.trapMessage ?? first.trapMessage,
    producerStep: currentProducerStep,
  };
}

/**
 * Issue #2671: Test seam. Producers go through `passesProducerCompileGate`
 * which delegates to this function; tests can replace it via
 * `__setProducerCompileGateProbeForTesting` to deterministically force a
 * gate failure without engineering a WASM-tripping topology.
 */
let producerCompileProbe: (creature: Creature) => ProducerCompileResult =
  ensureProducerOutputCompiles;

/**
 * Issue #2671: Test-only — replace the underlying compile probe used by
 * `passesProducerCompileGate` AND `runProducerCompileProbe`. Returns a
 * disposer that restores the real probe.
 *
 * Intentionally not re-exported through `@wasm/mod.ts` — production code
 * must always use the real `ensureProducerOutputCompiles`.
 */
export function __setProducerCompileGateProbeForTesting(
  probe: (creature: Creature) => ProducerCompileResult,
): () => void {
  const previous = producerCompileProbe;
  producerCompileProbe = probe;
  return () => {
    producerCompileProbe = previous;
  };
}

/**
 * Issue #2672: Internal helper that delegates to the (possibly stubbed)
 * compile probe. Direct callers in `Offspring.breed` and
 * `Mutator.repairAfterMutation` use this instead of the raw
 * `ensureProducerOutputCompiles` so the existing test seam
 * (`__setProducerCompileGateProbeForTesting`) can deterministically force
 * a gate rejection without engineering a WASM-tripping topology — the same
 * pattern already used by `passesProducerCompileGate`.
 *
 * Production behaviour is identical: when no test stub is installed the
 * call is exactly `ensureProducerOutputCompiles(creature)`.
 *
 * Issue #2685: The result is enriched with the current producer step
 * label (`producerStep`) when the probe failed without supplying one, so
 * test stubs do not need to know about the threading.
 */
export function runProducerCompileProbe(
  creature: Creature,
): ProducerCompileResult {
  const result = producerCompileProbe(creature);
  if (!result.ok && result.producerStep === undefined && currentProducerStep) {
    return { ...result, producerStep: currentProducerStep };
  }
  return result;
}

/**
 * Issue #2685: Histogram of producer-step rejection counts, flushed
 * periodically by `passesProducerCompileGate`. The key is the producer
 * step (or producer name when no step was set). Tests reset the histogram
 * via `__resetProducerStepHistogramForTesting`.
 */
const producerStepHistogram = new Map<string, number>();
let lastHistogramFlushMs = 0;
let producerStepLogIntervalMs = 60_000;

/**
 * Issue #2685: Test-only — reset the rejection histogram and last-flush
 * timestamp so a single test can observe its own counts.
 */
export function __resetProducerStepHistogramForTesting(): void {
  producerStepHistogram.clear();
  lastHistogramFlushMs = 0;
}

/**
 * Issue #2685: Override the periodic summary interval. Used by tests to
 * force or suppress a flush. Returns a disposer that restores the
 * previous value (default 60 000 ms).
 */
export function __setProducerStepLogIntervalMsForTesting(
  intervalMs: number,
): () => void {
  const previous = producerStepLogIntervalMs;
  producerStepLogIntervalMs = intervalMs;
  return () => {
    producerStepLogIntervalMs = previous;
  };
}

/**
 * Issue #2685: Snapshot the histogram. Test helper.
 */
export function __getProducerStepHistogramSnapshotForTesting(): Map<
  string,
  number
> {
  return new Map(producerStepHistogram);
}

/**
 * Issue #2685: Record a rejection for `key` (producer step label, or the
 * producer name when no step was set). When at least
 * `producerStepLogIntervalMs` has elapsed since the previous flush, emit
 * a single info line containing a histogram sorted by frequency
 * descending.
 */
function recordRejection(key: string): void {
  producerStepHistogram.set(key, (producerStepHistogram.get(key) ?? 0) + 1);

  const now = Date.now();
  if (lastHistogramFlushMs === 0) {
    // First rejection in this process; arm the timer but do not flush yet.
    lastHistogramFlushMs = now;
    return;
  }
  if (now - lastHistogramFlushMs < producerStepLogIntervalMs) {
    return;
  }
  flushProducerStepHistogram();
  lastHistogramFlushMs = now;
}

/**
 * Issue #2685: Emit the current histogram as a single info line, then
 * clear it. Public so other producer paths can trigger a flush when they
 * notice an end-of-generation boundary. Tests use this to assert the
 * sorted format.
 */
export function flushProducerStepHistogram(): void {
  if (producerStepHistogram.size === 0) return;
  const sorted = [...producerStepHistogram.entries()].sort((a, b) =>
    b[1] - a[1]
  );
  const summary = sorted.map(([k, v]) => `${k}=${v}`).join(", ");
  getLogger().info(`[ProducerCompileGate] step rejects: ${summary}`);
  producerStepHistogram.clear();
}

/**
 * Issue #2671: Convenience wrapper that runs the producer-side WASM compile
 * probe and emits a single warning line tagged with the producer name on
 * failure. Returns `true` when the creature is safe to leave the producer.
 *
 * Producers should branch on the boolean to drop (`Offspring.breed` style),
 * revert (`Mutator.repairAfterMutation` style), or skip
 * (`DeDuplicator.replaceDuplicateCreature` style) the candidate.
 *
 * Issue #2685: The warning line includes the producer step label when
 * known, and the rejection is recorded in a rate-limited histogram.
 */
export function passesProducerCompileGate(
  creature: Creature,
  producerName: string,
): boolean {
  const result = producerCompileProbe(creature);
  if (result.ok) {
    return true;
  }
  const step = result.producerStep ?? currentProducerStep;
  const stepSuffix = step ? ` from step=${step}` : "";
  getLogger().warn(
    `[${producerName}] dropping output${stepSuffix} that fails WASM compile (` +
      `neurons=${creature.neurons.length}, inputs=${creature.input}, ` +
      `outputs=${creature.output}): ${
        result.trapMessage ?? "unknown trap"
      }. Drop the creature or repair its topology before retrying.`,
  );
  recordRejection(step ?? producerName);
  return false;
}
