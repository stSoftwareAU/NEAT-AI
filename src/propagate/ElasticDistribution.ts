/**
 * Error distribution helpers for back propagation.
 *
 * Issue #2416 — the TypeScript implementation has been removed in favour of
 * the canonical WASM `distribute_elastic_error` function from NEAT-AI-core.
 * This module is now a thin shim that adapts the existing `ElasticLink[]` API
 * to the typed-array WASM ABI exposed via `WasmModuleLoader.distributeElasticErrorFn`.
 *
 * The WASM function uses a minimum-change heuristic for a linear pre-activation:
 *   v = b + Σ(w_i * a_i)
 *
 * If we want to change v by Δv, the smallest L2 change in weights that achieves
 * the same Δv (with bias handled separately) allocates contribution changes
 * proportional to a_i² × safeZoneFactor, with a weight²-based fallback when
 * activations are near zero, and an equal split when both are zero.
 *
 * Australian English: "normalise", "behaviour".
 */
import { WasmError } from "@errors/WasmError.ts";
import { getDistributeElasticErrorFn } from "@wasm/WasmModuleLoader.ts";

export type ElasticLink = Readonly<{
  activation: number;
  safeZoneFactor: number;
  /** Optional synapse weight, used for weight-based fallback when activations are near zero. */
  weight?: number;
}>;

/**
 * Distribute `error` across `links` proportional to activation² × safeZoneFactor,
 * delegating to the WASM `distribute_elastic_error` function. The shares returned
 * sum to `error` (within float tolerance) and follow the same fallback semantics
 * as the underlying core function.
 *
 * Throws `WasmError` when the WASM module is not loaded — there is no TS fallback.
 */
export function distributeElasticError(
  error: number,
  links: ReadonlyArray<ElasticLink>,
  options?: Readonly<{
    plankConstant?: number;
  }>,
): number[] {
  const plankConstant = options?.plankConstant ?? 1e-12;
  const count = links.length;

  if (count === 0) {
    return [];
  }

  const fn = getDistributeElasticErrorFn();
  if (!fn) {
    throw new WasmError(
      "distributeElasticError requires the WASM module to be loaded. " +
        "Ensure the NEAT-AI package is installed correctly.",
      "MODULE_NOT_LOADED",
    );
  }

  const activations = new Float32Array(count);
  const safeZoneFactors = new Float32Array(count);
  const weights = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const link = links[i];
    activations[i] = link.activation;
    safeZoneFactors[i] = link.safeZoneFactor;
    weights[i] = link.weight ?? 0;
  }

  const wasmResult = fn(
    error,
    activations,
    safeZoneFactors,
    weights,
    plankConstant,
  );

  // Convert Float32Array → number[] to preserve the historical return type.
  const shares = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    shares[i] = wasmResult[i];
  }
  return shares;
}

/**
 * Issue #3477 — typed-array-native entry point for elastic error distribution.
 *
 * The backward-pass fallback in `NeuronPropagation.propagate` already holds the
 * upstream activations and synapse weights in pre-populated `Float32Array`
 * scratch buffers. The `ElasticLink[]` API (`distributeElasticError`) forces
 * those buffers to be repacked into `count` short-lived `{ activation,
 * safeZoneFactor, weight }` objects only to have the WASM shim immediately
 * unpack them back into typed arrays. This entry point skips that round-trip:
 * it feeds the caller's typed views straight into the WASM ABI with a uniform
 * scalar `safeZoneFactor` (the fallback always uses `1`), allocating nothing
 * per link.
 *
 * The returned `Float32Array` is the raw WASM result — a fresh copy of linear
 * memory (wasm-bindgen returns a new array), so it is safe to retain across
 * subsequent WASM calls, exactly like `fusedErrorDistribution().perLinkError`.
 *
 * `activations` and `weights` must be views of equal length (`count`); a
 * uniform `safeZoneFactor` is applied to every link. Throws `WasmError` when the
 * WASM module is not loaded — there is no TS fallback.
 */
export function distributeElasticErrorTyped(
  error: number,
  activations: Float32Array,
  weights: Float32Array,
  safeZoneFactor: number,
  options?: Readonly<{
    plankConstant?: number;
  }>,
): Float32Array {
  const count = activations.length;
  if (count === 0) {
    return new Float32Array(0);
  }

  const plankConstant = options?.plankConstant ?? 1e-12;

  const fn = getDistributeElasticErrorFn();
  if (!fn) {
    throw new WasmError(
      "distributeElasticErrorTyped requires the WASM module to be loaded. " +
        "Ensure the NEAT-AI package is installed correctly.",
      "MODULE_NOT_LOADED",
    );
  }

  // Reusable scratch of uniform safe-zone factors. Grown on demand and refilled
  // each call; only read during the synchronous WASM call below, so a single
  // module-level buffer is safe even under recursive propagate().
  if (safeZoneScratch.length < count) {
    safeZoneScratch = new Float32Array(count);
  }
  const safeZoneFactors = safeZoneScratch.subarray(0, count);
  safeZoneFactors.fill(safeZoneFactor);

  return fn(error, activations, safeZoneFactors, weights, plankConstant);
}

/** Reusable uniform safe-zone-factor scratch for {@link distributeElasticErrorTyped}. */
let safeZoneScratch = new Float32Array(0);
