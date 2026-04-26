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
