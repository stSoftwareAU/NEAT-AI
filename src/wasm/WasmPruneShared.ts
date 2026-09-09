/**
 * @module
 *
 * The wire machinery both pruning bridges share (Issues #3975, #3976).
 *
 * NEAT-AI-core answers `prune_neuron` and `prune_synapse` with **one** response
 * shape — the same creature, the same honest `transform` label, the same fold /
 * share / uncompensated report, the same failure record. Writing that reader
 * twice would be two chances to disagree with core about what a field means, so
 * it is written once here and the two bridges add only the fields that are
 * genuinely theirs: the neuron a neuron removal named, the edges a synapse
 * removal took.
 *
 * ```mermaid
 * flowchart LR
 *   N["corePruneNeuron"] --> S["WasmPruneShared —<br/>envelope, readers, metadata"]
 *   Y["corePruneSynapse"] --> S
 *   S -->|"JSON request"| W["WASM prune_neuron /<br/>prune_synapse"]
 *   W -->|"JSON response"| S
 * ```
 *
 * ## What this layer owns, and what it must not
 *
 * It owns the wire shape and nothing else. It does **not** decide what may be
 * removed, how a target is compensated, or which survivors cascade away — core
 * owns all of that, and a second opinion here would be the shadow
 * implementation `docs/ENGINEERING_PRINCIPLES.md` principle 7 forbids. The one
 * thing it adds is carrying fields core has no model for: creature, neuron and
 * synapse `tags`, and the `frozen` flags. Core parses and drops them, so they
 * are copied back onto the survivors by identity — otherwise a prune would
 * silently strip a frozen transfer-learning bias.
 *
 * ## Fail loud, never skip
 *
 * There is no TypeScript fallback rewrite. An unavailable bundle throws a
 * {@link WasmError}; so does an answer that is not a response, and so does a
 * `malformed` failure — core telling us the payload never reached the rewrite
 * is a bug in the bridge, not a verdict on the creature. A refusal core
 * *understood* comes back as a {@link PruneRefusal}, which the caller reads as
 * "no change", never as a rewrite.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import type { TagInterface } from "@stsoftware/tags/mod";
import { WasmError } from "@errors/WasmError.ts";
import {
  type SynapseRole,
  synapseTripleKey,
} from "@architecture/SynapseKey.ts";

/**
 * A surviving neuron the caller believes predicts what is being removed, with
 * the statistics core needs to move the correlated part onto its edge.
 */
export interface PruneProxyStats {
  /** Wire UUID of the surviving neuron. */
  uuid: string;
  /** Its measured mean activation. */
  meanActivation: number;
  /** Its measured variance; must be positive to be usable. */
  variance: number;
  /** Measured covariance with what is being removed. */
  covariance: number;
}

/**
 * The caller's measurements of the neuron whose activation is going away — the
 * neuron itself for a neuron removal, the source neuron for a synapse removal.
 * Optional in full: core compensates only with what it is handed, and reports
 * every target it could not compensate.
 */
export interface PruneStats {
  /** Measured mean activation. */
  meanActivation: number;
  /** The measured variance, when the caller has one. */
  variance?: number;
  /** A correlated survivor, when the caller has one. */
  proxy?: PruneProxyStats;
}

/** One target's bias fold, as core reported it. */
export interface PruneBiasFold {
  /** Wire UUID of the target whose bias moved. */
  targetUUID: string;
  /** Total weight the removal took out of that target. */
  weightSum: number;
  /** What was added to the target's bias. */
  delta: number;
  /** True when the folded value is what the creature computed on every record. */
  exact: boolean;
  /** Variance of what the compensation could not carry, when derivable. */
  residualVariance?: number;
}

/** Weight moved onto a correlated survivor's edge, as core reported it. */
export interface PruneWeightShare {
  /** Wire UUID of the survivor carrying the correlated part. */
  fromUUID: string;
  /** Wire UUID of the target it feeds. */
  toUUID: string;
  /** What was added to that edge's weight. */
  delta: number;
}

/** A target left carrying the removal with nothing folded back. */
export interface PruneUncompensated {
  /** Wire UUID of the target. */
  targetUUID: string;
  /** Role the removed edges played at that target. */
  type: string;
  /** Total weight the removal took out of that role of that target. */
  weightSum: number;
  /** The target's squash, which is what makes an aggregate uncompensable. */
  squash: string;
  /** `"NO_STATISTICS"` or `"AGGREGATE_TARGET"`. */
  reason: string;
}

/**
 * Core's spelling of the untyped role, which `SynapseRole` — the canonical
 * TypeScript home for a synapse's role (AGENTS.md §"Synapse identity") — writes
 * as `undefined`. The two spellings mean the same edge, and core accepts either.
 */
export const STANDARD_ROLE = "standard";

/**
 * A role as the pruning wire spells it: the three canonical typed roles, plus
 * core's name for the untyped one. Derived from {@link SynapseRole} rather than
 * restated, so a role added there is a compile error here and not a silent
 * divergence.
 */
export type PruneRole = SynapseRole | typeof STANDARD_ROLE;

/**
 * The same vocabulary at runtime, for guarding a value that reached the bridge
 * untyped. The annotation is what keeps it honest: a spelling outside
 * {@link PruneRole} fails to compile.
 */
export const PRUNE_ROLES: readonly PruneRole[] = [
  STANDARD_ROLE,
  "condition",
  "negative",
  "positive",
];

/** The `(from, to, role)` triple core names an edge by, on the wire. */
export interface PruneSynapseKey {
  /** Wire UUID of the source neuron. */
  fromUUID: string;
  /** Wire UUID of the target neuron. */
  toUUID: string;
  /**
   * The role the edge plays at its target. Absent means the untyped role —
   * core defaults it, and an unknown spelling is a boundary fault rather than a
   * silent request for the untyped edge.
   */
  type?: PruneRole;
}

/** The half of a successful answer both rewrites report identically. */
export interface PruneReport {
  ok: true;
  /** The canonical, core-validated creature. */
  creature: CreatureExport;
  /**
   * `"exact"` when the pruned creature computes the same number on every
   * record, `"approximate"` otherwise. Core's own honest label — never
   * inferred here.
   */
  transform: "exact" | "approximate";
  /** How many cleanup passes the fixed point took. */
  passes: number;
  /** Neurons the cleanup cascade removed on top of the request. */
  cascadeNeurons: string[];
  /** Hidden neurons the cascade folded into constant support. */
  foldedNeurons: string[];
  /** `IF` neurons downgraded to `IDENTITY` because a role went with the removal. */
  downgradedIfNeurons: string[];
  /** The mean folds applied, one per compensated target. */
  biasFolds: PruneBiasFold[];
  /** The correlated-survivor shares applied. */
  weightShares: PruneWeightShare[];
  /** Targets that carried the removal with nothing folded back. */
  uncompensated: PruneUncompensated[];
}

/** A request core understood and refused. The creature is unchanged. */
export interface PruneRefusal {
  ok: false;
  /** Core's stable reason token, e.g. `"PROTECTED_NEURON"`. */
  reason: string;
  /** Core's own human-readable message. */
  message: string;
}

/**
 * Which export answered, and what it answered — carried together so every
 * fault message names the export that produced it rather than a generic
 * "prune".
 */
export interface WireContext {
  /** The WASM export name, e.g. `"prune_synapse"`. */
  readonly exportName: string;
  /** The raw answer, quoted (and truncated) into fault messages. */
  readonly answer: string;
}

/** The metadata core does not model, keyed so it can be put back. */
interface CarriedMetadata {
  tags?: TagInterface[];
  frozen?: boolean;
}

/** A record with the shape of an answer, or `null` when it is not one. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return (typeof value === "object" && value !== null && !Array.isArray(value))
    ? value as Record<string, unknown>
    : null;
}

/**
 * A response is a whole creature, so it can run to megabytes. Error messages
 * quote enough to identify the fault without flooding the log with the
 * creature that provoked it.
 */
export function describe(answer: string): string {
  const limit = 400;
  return answer.length <= limit
    ? answer
    : `${answer.slice(0, limit)}… (${answer.length} bytes)`;
}

/**
 * The identity a synapse keeps across the rewrite: endpoints plus role.
 *
 * `synapseTripleKey` is the canonical home for this key (AGENTS.md §"Synapse
 * identity"). A wire synapse's endpoints are optional on the export type, so
 * an absent endpoint is spelled out rather than silently keyed as `undefined`
 * — two different synapses missing an endpoint must not collide.
 */
function synapseKey(synapse: SynapseExport): string {
  return synapseTripleKey(
    synapse.fromUUID ?? "",
    synapse.toUUID ?? "",
    synapse.type,
  );
}

/**
 * Refuse a statistic JSON cannot carry, before the wire turns it into `null`.
 *
 * `JSON.stringify` writes `NaN` and `±Infinity` as `null`, so a non-finite
 * measurement would reach core as a missing field and come back as an
 * unreadable "expected f64" boundary fault. This is a wire-encoding guard, not
 * a second opinion on core's rules: core refuses non-finite statistics too, and
 * this only makes sure the caller hears *which* number it handed over.
 */
export function assertFiniteStats(
  exportName: string,
  stats: PruneStats,
): void {
  const named: [string, number][] = [
    ["meanActivation", stats.meanActivation],
  ];
  if (stats.variance !== undefined) named.push(["variance", stats.variance]);
  if (stats.proxy) {
    named.push(
      ["proxy.meanActivation", stats.proxy.meanActivation],
      ["proxy.variance", stats.proxy.variance],
      ["proxy.covariance", stats.proxy.covariance],
    );
  }

  for (const [field, value] of named) {
    if (!Number.isFinite(value)) {
      throw new WasmError(
        `${exportName} was handed a non-finite statistic: ${field} is ` +
          `${value}. JSON cannot carry it, so it must not be sent as a ` +
          `missing measurement — measure it or omit the statistics.`,
        "INVALID_REQUEST",
      );
    }
  }
}

/**
 * The error raised when the bundle carrying the rewrite is not there.
 *
 * @param exportName The core export that cannot be reached.
 * @param subject What would have been removed, for the "must never be removed
 *   by a superseded rewrite" clause — e.g. `"a neuron"`.
 */
export function bundleUnavailable(
  exportName: string,
  subject: string,
  loadError: Error | null,
): WasmError {
  const cause = loadError
    ? `The WASM loader reported: ${loadError.message}`
    : "The WASM loader reported no error, so the bundle was never initialised.";
  return new WasmError(
    `${exportName} requires the NEAT-AI-core WASM bundle, but it could not be ` +
      `loaded, and there is no TypeScript fallback — ${subject} must never be ` +
      `removed by a superseded rewrite because the proven one could not run. ` +
      `${cause} If you are consuming @stsoftware/neat-ai from JSR, ensure the ` +
      `runtime can load the vendored bundle at wasm_activation/pkg. If you ` +
      `are developing NEAT-AI locally, run ./build.sh to refresh ` +
      `wasm_activation/pkg from the pinned core revision.`,
    "MODULE_NOT_LOADED",
    loadError ? { cause: loadError } : undefined,
  );
}

/**
 * Copy the metadata core parsed and dropped back onto the survivors.
 *
 * Identity is the wire UUID for a neuron and `(fromUUID, toUUID, type)` for a
 * synapse — via `synapseTripleKey`, the canonical key — so a survivor is
 * matched to what it was, and a support edge core *added* correctly carries
 * nothing.
 */
export function restoreCarriedMetadata(
  before: CreatureExport,
  after: CreatureExport,
): void {
  if (before.tags) after.tags = before.tags.slice();

  const neuronMeta = new Map<string, CarriedMetadata>();
  for (const neuron of before.neurons) {
    if (!neuron.uuid) continue;
    if (!neuron.tags && !neuron.frozen) continue;
    neuronMeta.set(neuron.uuid, { tags: neuron.tags, frozen: neuron.frozen });
  }
  if (neuronMeta.size > 0) {
    for (const neuron of after.neurons) {
      const meta = neuron.uuid ? neuronMeta.get(neuron.uuid) : undefined;
      if (!meta) continue;
      const writable = neuron as NeuronExport & CarriedMetadata;
      if (meta.tags) writable.tags = meta.tags.slice();
      if (meta.frozen) writable.frozen = true;
    }
  }

  const synapseMeta = new Map<string, CarriedMetadata>();
  for (const synapse of before.synapses) {
    if (!synapse.tags && !synapse.frozen) continue;
    synapseMeta.set(synapseKey(synapse), {
      tags: synapse.tags,
      frozen: synapse.frozen,
    });
  }
  if (synapseMeta.size > 0) {
    for (const synapse of after.synapses) {
      const meta = synapseMeta.get(synapseKey(synapse));
      if (!meta) continue;
      if (meta.tags) synapse.tags = meta.tags.slice();
      if (meta.frozen) synapse.frozen = true;
    }
  }
}

/**
 * Read a field core's contract says is a string.
 *
 * `String(undefined)` would turn a field core failed to send into the literal
 * `"undefined"` — a UUID that matches no neuron and is then silently skipped
 * downstream. A contract mismatch must be a fault, not plausible-looking data.
 */
export function requiredString(
  source: Record<string, unknown>,
  field: string,
  where: string,
  ctx: WireContext,
): string {
  const value = source[field];
  if (typeof value !== "string") {
    throw new WasmError(
      `${ctx.exportName} sent ${where}.${field} as ${typeof value}, not a ` +
        `string: ${describe(ctx.answer)}`,
      "INVALID_REQUEST",
    );
  }
  return value;
}

/**
 * Read a field core's contract says is a finite number.
 *
 * `Number(undefined)` is `NaN`, and a `NaN` weight or bias silently poisons
 * every downstream activation, so an absent or unusable number is refused here.
 */
export function requiredNumber(
  source: Record<string, unknown>,
  field: string,
  where: string,
  ctx: WireContext,
): number {
  const value = source[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WasmError(
      `${ctx.exportName} sent ${where}.${field} as ${String(value)}, not a ` +
        `finite number: ${describe(ctx.answer)}`,
      "INVALID_REQUEST",
    );
  }
  return value;
}

/**
 * Read a field core's contract says is a boolean.
 *
 * `value === true` would quietly turn a field core failed to send into a
 * confident `false` — here, an approximate fold reported as exact.
 */
export function requiredBoolean(
  source: Record<string, unknown>,
  field: string,
  where: string,
  ctx: WireContext,
): boolean {
  const value = source[field];
  if (typeof value !== "boolean") {
    throw new WasmError(
      `${ctx.exportName} sent ${where}.${field} as ${typeof value}, not a ` +
        `boolean: ${describe(ctx.answer)}`,
      "INVALID_REQUEST",
    );
  }
  return value;
}

/**
 * Read an array core's contract says holds only strings.
 *
 * Dropping an element of the wrong shape would under-report what core removed,
 * so an unreadable element is a fault rather than a shorter list.
 */
export function requiredStrings(
  value: unknown,
  where: string,
  ctx: WireContext,
): string[] {
  if (!Array.isArray(value)) {
    throw new WasmError(
      `${ctx.exportName} sent ${where} as ${typeof value}, not an array: ` +
        describe(ctx.answer),
      "INVALID_REQUEST",
    );
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new WasmError(
        `${ctx.exportName} sent ${where}[${index}] as ${typeof entry}, not a ` +
          `string: ${describe(ctx.answer)}`,
        "INVALID_REQUEST",
      );
    }
    return entry;
  });
}

/**
 * Read an array core's contract says holds only records, refusing anything
 * else for the same reason {@link requiredStrings} does.
 */
export function requiredRecords(
  value: unknown,
  where: string,
  ctx: WireContext,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new WasmError(
      `${ctx.exportName} sent ${where} as ${typeof value}, not an array: ` +
        describe(ctx.answer),
      "INVALID_REQUEST",
    );
  }
  return value.map((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      throw new WasmError(
        `${ctx.exportName} sent ${where}[${index}] as ${typeof entry}, not a ` +
          `record: ${describe(ctx.answer)}`,
        "INVALID_REQUEST",
      );
    }
    return record;
  });
}

/**
 * Read a list of `(from, to, role)` triples core reported removing.
 *
 * The role is optional on the wire — core omits it for the untyped edge — so an
 * absent `type` is the untyped role rather than a fault.
 */
export function requiredSynapseKeys(
  value: unknown,
  where: string,
  ctx: WireContext,
): PruneSynapseKey[] {
  return requiredRecords(value ?? [], where, ctx).map((entry, index) => {
    const type = entry.type;
    if (
      type !== undefined &&
      !PRUNE_ROLES.includes(type as PruneRole)
    ) {
      throw new WasmError(
        `${ctx.exportName} sent ${where}[${index}].type as ${String(type)}, ` +
          `not one of ${PRUNE_ROLES.join(", ")}: ${describe(ctx.answer)}`,
        "INVALID_REQUEST",
      );
    }
    return {
      fromUUID: requiredString(entry, "fromUUID", `${where}[${index}]`, ctx),
      toUUID: requiredString(entry, "toUUID", `${where}[${index}]`, ctx),
      type: type as PruneRole | undefined,
    };
  });
}

/** Read the half of a success both rewrites report the same way. */
export function readCommonReport(
  response: Record<string, unknown>,
  ctx: WireContext,
): PruneReport {
  const creature = asRecord(response.creature) as CreatureExport | null;
  if (!creature) {
    throw new WasmError(
      `${ctx.exportName} reported a successful rewrite with no creature: ` +
        describe(ctx.answer),
      "INVALID_REQUEST",
    );
  }
  // A "creature" that is not one would otherwise die as a TypeError deep in
  // metadata restoration, naming neither core nor this bridge.
  if (!Array.isArray(creature.neurons) || !Array.isArray(creature.synapses)) {
    throw new WasmError(
      `${ctx.exportName} reported a rewrite whose creature has no neurons or ` +
        `synapses array: ${describe(ctx.answer)}`,
      "INVALID_REQUEST",
    );
  }
  const transform = response.transform;
  if (transform !== "exact" && transform !== "approximate") {
    throw new WasmError(
      `${ctx.exportName} reported a rewrite with no honest transform label: ` +
        describe(ctx.answer),
      "INVALID_REQUEST",
    );
  }

  return {
    ok: true,
    creature,
    transform,
    passes: requiredNumber(response, "passes", "response", ctx),
    cascadeNeurons: requiredStrings(
      response.cascadeNeurons ?? [],
      "cascadeNeurons",
      ctx,
    ),
    foldedNeurons: requiredStrings(
      response.foldedNeurons ?? [],
      "foldedNeurons",
      ctx,
    ),
    downgradedIfNeurons: requiredStrings(
      response.downgradedIfNeurons ?? [],
      "downgradedIfNeurons",
      ctx,
    ),
    biasFolds: requiredRecords(response.biasFolds ?? [], "biasFolds", ctx)
      .map((fold, i) => ({
        targetUUID: requiredString(fold, "targetUUID", `biasFolds[${i}]`, ctx),
        weightSum: requiredNumber(fold, "weightSum", `biasFolds[${i}]`, ctx),
        delta: requiredNumber(fold, "delta", `biasFolds[${i}]`, ctx),
        exact: requiredBoolean(fold, "exact", `biasFolds[${i}]`, ctx),
        residualVariance: typeof fold.residualVariance === "number"
          ? fold.residualVariance
          : undefined,
      })),
    weightShares: requiredRecords(
      response.weightShares ?? [],
      "weightShares",
      ctx,
    ).map((share, i) => ({
      fromUUID: requiredString(share, "fromUUID", `weightShares[${i}]`, ctx),
      toUUID: requiredString(share, "toUUID", `weightShares[${i}]`, ctx),
      delta: requiredNumber(share, "delta", `weightShares[${i}]`, ctx),
    })),
    uncompensated: requiredRecords(
      response.uncompensated ?? [],
      "uncompensated",
      ctx,
    ).map((target, i) => ({
      targetUUID: requiredString(
        target,
        "targetUUID",
        `uncompensated[${i}]`,
        ctx,
      ),
      type: requiredString(target, "type", `uncompensated[${i}]`, ctx),
      weightSum: requiredNumber(
        target,
        "weightSum",
        `uncompensated[${i}]`,
        ctx,
      ),
      squash: requiredString(target, "squash", `uncompensated[${i}]`, ctx),
      reason: requiredString(target, "reason", `uncompensated[${i}]`, ctx),
    })),
  };
}

/**
 * Send one request across the boundary and read the answer back.
 *
 * The envelope is identical for both rewrites: refuse an unavailable bundle,
 * refuse an answer that is not a response, refuse a `malformed` failure — which
 * says the payload never reached the rewrite and therefore says nothing about
 * the creature — and otherwise hand back either the caller's success shape or
 * core's refusal.
 *
 * @param exportName The core export being called.
 * @param subject What is being removed, for the unavailable-bundle message.
 * @param before The creature as it was sent, so the metadata core drops can be
 *   copied back onto the survivors.
 * @param buildRequest Builds the whole JSON request payload. Called only once
 *   the bundle is known to be there, so a request-shape refusal can never
 *   pre-empt the "there is no bundle at all" fault.
 * @param readSuccess Reads the rewrite-specific half of a successful answer.
 */
export function callPrune<T extends PruneReport>(
  exportName: string,
  subject: string,
  pruneFn: ((request: string) => string) | null,
  loadError: Error | null,
  before: CreatureExport,
  buildRequest: () => unknown,
  readSuccess: (
    response: Record<string, unknown>,
    ctx: WireContext,
  ) => T,
): T | PruneRefusal {
  if (!pruneFn) {
    throw bundleUnavailable(exportName, subject, loadError);
  }

  const answer = pruneFn(JSON.stringify(buildRequest()));
  const ctx: WireContext = { exportName, answer };

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch (error) {
    throw new WasmError(
      `${exportName} answered with something that is not JSON: ${
        describe(answer)
      }`,
      "INVALID_REQUEST",
      { cause: error instanceof Error ? error : undefined },
    );
  }

  const response = asRecord(parsed);
  if (!response) {
    throw new WasmError(
      `${exportName} answered with something that is not a response: ${
        describe(answer)
      }`,
      "INVALID_REQUEST",
    );
  }

  if (response.ok === true) {
    const success = readSuccess(response, ctx);
    restoreCarriedMetadata(before, success.creature);
    return success;
  }

  const failure = asRecord(response.failure);
  if (!failure) {
    throw new WasmError(
      `${exportName} reported a failure with no detail: ${describe(answer)}`,
      "INVALID_REQUEST",
    );
  }

  const message = requiredString(failure, "message", "failure", ctx);
  // `malformed` says the payload never reached the rewrite, so it says nothing
  // about the creature. Reporting it as a refusal would let a bridge bug
  // masquerade as a removal core declined to make.
  if (failure.malformed === true) {
    throw new WasmError(
      `${exportName} refused the request built for it: ${message}`,
      "INVALID_REQUEST",
    );
  }

  return {
    ok: false,
    reason: requiredString(failure, "reason", "failure", ctx),
    message,
  };
}
