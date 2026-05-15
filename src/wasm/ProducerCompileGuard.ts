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
    return { ok: false, trapMessage: first.trapMessage };
  }

  const second = tryCompile(creature);
  if (second.ok) {
    return { ok: true, repaired: true };
  }

  return {
    ok: false,
    trapMessage: second.trapMessage ?? first.trapMessage,
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
 * `passesProducerCompileGate`. Returns a disposer that restores the real
 * probe.
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
 * Issue #2671: Convenience wrapper that runs the producer-side WASM compile
 * probe and emits a single warning line tagged with the producer name on
 * failure. Returns `true` when the creature is safe to leave the producer.
 *
 * Producers should branch on the boolean to drop (`Offspring.breed` style),
 * revert (`Mutator.repairAfterMutation` style), or skip
 * (`DeDuplicator.replaceDuplicateCreature` style) the candidate.
 */
export function passesProducerCompileGate(
  creature: Creature,
  producerName: string,
): boolean {
  const result = producerCompileProbe(creature);
  if (result.ok) {
    return true;
  }
  getLogger().warn(
    `[${producerName}] dropping output that fails WASM compile (` +
      `neurons=${creature.neurons.length}, inputs=${creature.input}, ` +
      `outputs=${creature.output}): ${
        result.trapMessage ?? "unknown trap"
      }. Drop the creature or repair its topology before retrying.`,
  );
  return false;
}
