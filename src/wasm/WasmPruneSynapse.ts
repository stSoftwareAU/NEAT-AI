/**
 * @module
 *
 * The bridge to NEAT-AI-core's `prune_synapse` — the fleet's one implementation
 * of "remove this one edge and give me back something I can score"
 * (Issue #3976, core issues #591 / #592).
 *
 * The ABI is the JSON in / JSON out shape `prune_neuron` already crosses on,
 * and the wire machinery is shared with it in
 * {@link module:src/wasm/WasmPruneShared}. What this module adds is the one
 * thing a synapse removal needs that a neuron removal does not: an **identity**
 * for the edge.
 *
 * ```mermaid
 * flowchart LR
 *   TS["SubConnection"] --> A["corePruneSynapse<br/>(this bridge)"]
 *   A -->|"JSON request"| W["WASM prune_synapse"]
 *   W --> R["core prune_synapse —<br/>cut, compensate, IF rewrite,<br/>cascade, validate"]
 *   R -->|"JSON response"| A
 *   A --> M["restore tags / frozen<br/>core does not model"]
 *   M --> TS
 * ```
 *
 * ## The role is part of what names an edge
 *
 * An `IF` neuron keeps a separate sum per role, so one source may feed two of
 * its branches (AGENTS.md §"Synapse identity", core Issue #577). "Remove the
 * `h-a → if-1` synapse" is therefore not a request core can carry out — it
 * would delete a branch nobody named — so the request carries the full
 * `(fromUUID, toUUID, type)` triple and only that triple goes.
 *
 * `type` is optional and absent means the untyped role. An unknown spelling is
 * a boundary fault rather than a silent request for the untyped edge, which is
 * why {@link corePruneSynapse} refuses one here rather than letting core
 * answer `malformed` about a request this repo should never have built.
 *
 * ## What core does that the superseded TypeScript could not
 *
 * `SubConnection` used to decline any removal that would leave an `IF` short a
 * role, so a whole class of typed structure was unreachable to the mutation
 * operators. Core rewrites instead, and both rewrites are exact — they compute
 * the same number on every record:
 *
 * | What the removal left | Rewrite |
 * |---|---|
 * | no condition edge, or a structurally fixed condition | the branch the condition always takes, as an `IDENTITY` sum |
 * | an emptied `positive` / `negative` branch, condition still varying | a zero-weight support edge into that role |
 *
 * ## Fail loud, never skip
 *
 * There is no TypeScript fallback rewrite. An unavailable bundle throws a
 * {@link WasmError}, and so does a `malformed` failure. A refusal core
 * *understood* — an unknown triple, an unusable statistic — comes back as a
 * {@link PruneSynapseRefusal}, which the caller reads as "no change".
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { WasmError } from "@errors/WasmError.ts";
import { getPruneSynapseFn, getWasmLoadError } from "@wasm/WasmModuleLoader.ts";
import {
  assertFiniteStats,
  callPrune,
  describe,
  type PruneBiasFold,
  type PruneProxyStats,
  type PruneRefusal,
  type PruneReport,
  type PruneStats,
  type PruneSynapseKey,
  type PruneUncompensated,
  type PruneWeightShare,
  readCommonReport,
  requiredSynapseKeys,
  type WireContext,
} from "@wasm/WasmPruneShared.ts";

export type {
  PruneBiasFold,
  PruneProxyStats,
  PruneSynapseKey,
  PruneUncompensated,
  PruneWeightShare,
};

/**
 * The caller's measurements of the **source** neuron, whose activation the
 * removed edge carried.
 */
export type PruneSynapseStats = PruneStats;

/**
 * The role spellings core carries. The untyped role is `"standard"`, and is
 * also what an absent `type` means.
 */
export const SYNAPSE_ROLES: readonly string[] = [
  "standard",
  "condition",
  "negative",
  "positive",
];

/** An `IF` flattened to the branch its condition always takes. */
export interface StaticIfRewrite {
  /** Wire UUID of the `IF` neuron. */
  uuid: string;
  /** The branch that survived — `"positive"` or `"negative"`. */
  branch: string;
}

/** What came back when core rewrote the creature. */
export interface PruneSynapseSuccess extends PruneReport {
  /** The edges the request itself took — one triple, or the rows it was written in. */
  removedSynapses: PruneSynapseKey[];
  /** Synapses the cleanup cascade removed alongside the request. */
  cascadeSynapses: PruneSynapseKey[];
  /** `IF` neurons flattened to the branch their condition always takes. */
  staticIfNeurons: StaticIfRewrite[];
  /** Zero-weight support edges added to give an `IF` back an emptied role. */
  restoredIfRoles: PruneSynapseKey[];
}

/** A request core understood and refused. The creature is unchanged. */
export type PruneSynapseRefusal = PruneRefusal;

/** Either a rewrite, or a refusal — never a silently unchanged creature. */
export type PruneSynapseOutcome = PruneSynapseSuccess | PruneSynapseRefusal;

/** Read the success half of a response, refusing anything under-specified. */
function readSuccess(
  response: Record<string, unknown>,
  ctx: WireContext,
): PruneSynapseSuccess {
  const report = readCommonReport(response, ctx);

  return {
    ...report,
    removedSynapses: requiredSynapseKeys(
      response.removedSynapses,
      "removedSynapses",
      ctx,
    ),
    cascadeSynapses: requiredSynapseKeys(
      response.cascadeSynapses,
      "cascadeSynapses",
      ctx,
    ),
    staticIfNeurons: readStaticIfRewrites(response.staticIfNeurons, ctx),
    restoredIfRoles: requiredSynapseKeys(
      response.restoredIfRoles,
      "restoredIfRoles",
      ctx,
    ),
  };
}

/**
 * Read the `staticIfNeurons` list, whose entries are `{ uuid, branch }` rather
 * than a synapse triple. Dropping an unreadable entry would under-report a
 * rewrite the caller may need to explain, so it is a fault.
 */
function readStaticIfRewrites(
  value: unknown,
  ctx: WireContext,
): StaticIfRewrite[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new WasmError(
      `${ctx.exportName} sent staticIfNeurons as ${typeof value}, not an ` +
        `array: ${describe(ctx.answer)}`,
      "INVALID_REQUEST",
    );
  }
  return value.map((entry, index) => {
    const record = entry as Record<string, unknown> | null;
    if (
      typeof record !== "object" || record === null ||
      typeof record.uuid !== "string" || typeof record.branch !== "string"
    ) {
      throw new WasmError(
        `${ctx.exportName} sent staticIfNeurons[${index}] without a string ` +
          `uuid and branch: ${describe(ctx.answer)}`,
        "INVALID_REQUEST",
      );
    }
    return { uuid: record.uuid, branch: record.branch };
  });
}

/**
 * Refuse a role spelling core does not carry, before it becomes a boundary
 * fault.
 *
 * Core answers `malformed` for an unknown role, which is a bug report about
 * this repo rather than a verdict on the creature. Naming the offending
 * spelling here is what tells the caller which of its own values was wrong.
 */
function assertKnownRole(key: PruneSynapseKey): void {
  if (key.type === undefined) return;
  if (SYNAPSE_ROLES.includes(key.type)) return;
  throw new WasmError(
    `prune_synapse was asked for role '${key.type}' on ` +
      `${key.fromUUID} -> ${key.toUUID}, which is not one of ` +
      `${SYNAPSE_ROLES.join(", ")}.`,
    "INVALID_REQUEST",
  );
}

/**
 * Remove one typed synapse through NEAT-AI-core.
 *
 * @param creature The creature to rewrite, in the export wire shape. It is
 *   read, never mutated — the rewrite comes back as a new export.
 * @param synapse The `(fromUUID, toUUID, type)` triple naming the edge. An
 *   absent `type` is the untyped role.
 * @param stats The caller's own measurements of the source neuron, when it has
 *   any. Core compensates with these and never invents them; where the creature
 *   itself fixes the source's activation, the fold is exact and no statistic is
 *   needed or used.
 * @param pruneFn Injectable for testing an unavailable or misbehaving bundle;
 *   defaults to the loader's own pointer.
 * @param loadError Injectable for the same reason; defaults to the loader's
 *   recorded failure.
 * @returns The rewritten creature and its report, or core's refusal.
 * @throws {WasmError} When the bundle is unavailable (`MODULE_NOT_LOADED`), or
 *   when the request or the answer breaks the contract (`INVALID_REQUEST`).
 */
export function corePruneSynapse(
  creature: CreatureExport,
  synapse: PruneSynapseKey,
  stats?: PruneSynapseStats,
  pruneFn: ((request: string) => string) | null = getPruneSynapseFn(),
  loadError: Error | null = getWasmLoadError(),
): PruneSynapseOutcome {
  assertKnownRole(synapse);
  if (stats) assertFiniteStats("prune_synapse", stats);

  return callPrune(
    "prune_synapse",
    "a synapse",
    pruneFn,
    loadError,
    creature,
    { creature, synapse, stats },
    readSuccess,
  );
}
