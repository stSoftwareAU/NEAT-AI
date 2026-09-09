/**
 * @module
 *
 * The bridge to NEAT-AI-core's `prune_neuron` — the fleet's one implementation
 * of "remove this hidden neuron and give me back something I can score"
 * (Issue #3975, core issues #590 / #592).
 *
 * The ABI is JSON in, JSON out, exactly as `WasmCreatureValidate` uses for
 * `creature_validate`: a whole creature does not fit a packed scalar export,
 * and the report a rewrite owes its caller — what was folded, what cascaded,
 * what could not be compensated — is a record rather than a number. The
 * creature crosses the boundary in the `CreatureExport` wire shape NEAT-AI
 * already exchanges, so a creature file goes in and a creature file comes out.
 *
 * ```mermaid
 * flowchart LR
 *   TS["removeHarmfulNeuron /<br/>removeLowImpactNeuron"] --> A["corePruneNeuron<br/>(this bridge)"]
 *   A -->|"JSON request"| W["WASM prune_neuron"]
 *   W --> R["core prune_neuron —<br/>fold, cut, cascade, validate"]
 *   R -->|"JSON response"| A
 *   A --> M["restore tags / frozen<br/>core does not model"]
 *   M --> TS
 * ```
 *
 * The wire machinery — the envelope, the strict field readers, and the
 * `tags` / `frozen` metadata core parses and drops — is shared with
 * `WasmPruneSynapse` in {@link module:src/wasm/WasmPruneShared}; this module
 * adds only what is specific to removing a neuron. What it must **not** add is
 * a second opinion on core's rules: core decides what may be removed, how a
 * target is compensated and which survivors cascade away.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { WasmError } from "@errors/WasmError.ts";
import { getPruneNeuronFn, getWasmLoadError } from "@wasm/WasmModuleLoader.ts";
import {
  assertFiniteStats,
  callPrune,
  describe,
  type PruneBiasFold,
  type PruneProxyStats,
  type PruneRefusal,
  type PruneReport,
  type PruneStats,
  type PruneUncompensated,
  type PruneWeightShare,
  readCommonReport,
  requiredString,
  type WireContext,
} from "@wasm/WasmPruneShared.ts";

export type {
  PruneBiasFold,
  PruneProxyStats,
  PruneUncompensated,
  PruneWeightShare,
};

/** The caller's measurements of the neuron being removed. */
export type PruneNeuronStats = PruneStats;

/** What came back when core rewrote the creature. */
export interface PruneNeuronSuccess extends PruneReport {
  /** Wire UUID of the neuron the request named. */
  removedNeuron?: string;
}

/** A request core understood and refused. The creature is unchanged. */
export type PruneNeuronRefusal = PruneRefusal;

/** Either a rewrite, or a refusal — never a silently unchanged creature. */
export type PruneNeuronOutcome = PruneNeuronSuccess | PruneNeuronRefusal;

/** Read the success half of a response, refusing anything under-specified. */
function readSuccess(
  response: Record<string, unknown>,
  ctx: WireContext,
  requestedUuid: string,
): PruneNeuronSuccess {
  const report = readCommonReport(response, ctx);

  // Core answering "removed" about a neuron nobody asked about is a bridge or
  // contract fault; downstream it would show up only as an unexplained
  // unchanged-UUID, long after the evidence is gone.
  const removedNeuron = response.removedNeuron === undefined
    ? undefined
    : requiredString(response, "removedNeuron", "response", ctx);
  if (removedNeuron !== undefined && removedNeuron !== requestedUuid) {
    throw new WasmError(
      `prune_neuron was asked to remove ${requestedUuid} but reported ` +
        `removing ${removedNeuron}: ${describe(ctx.answer)}`,
      "INVALID_REQUEST",
    );
  }

  return { ...report, removedNeuron };
}

/**
 * Remove one hidden neuron through NEAT-AI-core.
 *
 * @param creature The creature to rewrite, in the export wire shape. It is
 *   read, never mutated — the rewrite comes back as a new export.
 * @param uuid Wire UUID of the neuron to remove.
 * @param stats The caller's own measurements, when it has any. Core
 *   compensates with these and never invents them.
 * @param pruneFn Injectable for testing an unavailable or misbehaving bundle;
 *   defaults to the loader's own pointer.
 * @param loadError Injectable for the same reason; defaults to the loader's
 *   recorded failure.
 * @returns The rewritten creature and its report, or core's refusal.
 * @throws {WasmError} When the bundle is unavailable (`MODULE_NOT_LOADED`), or
 *   when the payload never reached the rewrite (`INVALID_REQUEST`).
 */
export function corePruneNeuron(
  creature: CreatureExport,
  uuid: string,
  stats?: PruneNeuronStats,
  pruneFn: ((request: string) => string) | null = getPruneNeuronFn(),
  loadError: Error | null = getWasmLoadError(),
): PruneNeuronOutcome {
  if (stats) assertFiniteStats("prune_neuron", stats);

  return callPrune(
    "prune_neuron",
    "a neuron",
    pruneFn,
    loadError,
    creature,
    { creature, uuid, stats },
    (response, ctx) => readSuccess(response, ctx, uuid),
  );
}
