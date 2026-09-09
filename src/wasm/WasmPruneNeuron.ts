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
 * ## What this bridge owns, and what it must not
 *
 * It owns the wire shape and nothing else. It does **not** decide what may be
 * removed, how a target is compensated, or which survivors cascade away — core
 * owns all of that, and a second opinion here would be the shadow
 * implementation `docs/ENGINEERING_PRINCIPLES.md` principle 7 forbids. The one
 * thing it does add is carrying fields core has no model for: creature, neuron
 * and synapse `tags`, and the `frozen` flags. Core parses and drops them, so
 * the bridge copies them back onto the survivors by identity — otherwise a
 * prune would silently strip a frozen transfer-learning bias.
 *
 * ## Fail loud, never skip
 *
 * There is no TypeScript fallback rewrite. An unavailable bundle throws a
 * {@link WasmError}; so does an answer that is not a response, and so does a
 * `malformed` failure — core telling us the payload never reached the rewrite
 * is a bug in this bridge, not a verdict on the creature. A refusal core
 * *understood* (an unknown UUID, a protected neuron, an unusable statistic)
 * comes back as {@link PruneNeuronRefusal}, which the caller reads as "no
 * change", never as a rewrite.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import type { TagInterface } from "@stsoftware/tags/mod";
import { WasmError } from "@errors/WasmError.ts";
import { getPruneNeuronFn, getWasmLoadError } from "@wasm/WasmModuleLoader.ts";

/**
 * A surviving neuron the caller believes predicts the one being removed, with
 * the statistics core needs to move the correlated part onto its edge.
 */
export interface PruneProxyStats {
  /** Wire UUID of the surviving neuron. */
  uuid: string;
  /** Its measured mean activation. */
  meanActivation: number;
  /** Its measured variance; must be positive to be usable. */
  variance: number;
  /** Measured covariance with the neuron being removed. */
  covariance: number;
}

/**
 * The caller's measurements of the neuron being removed. Optional in full:
 * core compensates only with what it is handed, and reports every target it
 * could not compensate.
 */
export interface PruneNeuronStats {
  /** Measured mean activation of the neuron being removed. */
  meanActivation: number;
  /** Its measured variance, when the caller has one. */
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

/** What came back when core rewrote the creature. */
export interface PruneNeuronSuccess {
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
  /** Wire UUID of the neuron the request named. */
  removedNeuron?: string;
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
export interface PruneNeuronRefusal {
  ok: false;
  /** Core's stable reason token, e.g. `"PROTECTED_NEURON"`. */
  reason: string;
  /** Core's own human-readable message. */
  message: string;
}

/** Either a rewrite, or a refusal — never a silently unchanged creature. */
export type PruneNeuronOutcome = PruneNeuronSuccess | PruneNeuronRefusal;

/** The metadata core does not model, keyed so it can be put back. */
interface CarriedMetadata {
  tags?: TagInterface[];
  frozen?: boolean;
}

/** A record with the shape of an answer, or `null` when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return (typeof value === "object" && value !== null && !Array.isArray(value))
    ? value as Record<string, unknown>
    : null;
}

/** The identity a synapse keeps across the rewrite: endpoints plus role. */
function synapseKey(synapse: SynapseExport): string {
  return `${synapse.fromUUID} ${synapse.toUUID} ${synapse.type ?? ""}`;
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
function assertFiniteStats(stats: PruneNeuronStats): void {
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
        `prune_neuron was handed a non-finite statistic: ${field} is ` +
          `${value}. JSON cannot carry it, so it must not be sent as a ` +
          `missing measurement — measure it or omit the statistics.`,
        "INVALID_REQUEST",
      );
    }
  }
}

/** The error raised when the bundle carrying the rewrite is not there. */
function bundleUnavailable(loadError: Error | null): WasmError {
  const cause = loadError
    ? `The WASM loader reported: ${loadError.message}`
    : "The WASM loader reported no error, so the bundle was never initialised.";
  return new WasmError(
    `prune_neuron requires the NEAT-AI-core WASM bundle, but it could not be ` +
      `loaded, and there is no TypeScript fallback — a neuron must never be ` +
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
 * synapse — the same key `SynapseKey.ts` uses — so a survivor is matched to
 * what it was, and a support edge core *added* correctly carries nothing.
 */
function restoreCarriedMetadata(
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
 * A response is a whole creature, so it can run to megabytes. Error messages
 * quote enough to identify the fault without flooding the log with the
 * creature that provoked it.
 */
function describe(answer: string): string {
  const limit = 400;
  return answer.length <= limit
    ? answer
    : `${answer.slice(0, limit)}… (${answer.length} bytes)`;
}

/**
 * Read a field core's contract says is a string.
 *
 * `String(undefined)` would turn a field core failed to send into the literal
 * `"undefined"` — a UUID that matches no neuron and is then silently skipped
 * downstream. A contract mismatch must be a fault, not plausible-looking data.
 */
function requiredString(
  source: Record<string, unknown>,
  field: string,
  where: string,
  answer: string,
): string {
  const value = source[field];
  if (typeof value !== "string") {
    throw new WasmError(
      `prune_neuron sent ${where}.${field} as ${typeof value}, not a string: ` +
        describe(answer),
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
function requiredNumber(
  source: Record<string, unknown>,
  field: string,
  where: string,
  answer: string,
): number {
  const value = source[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WasmError(
      `prune_neuron sent ${where}.${field} as ${String(value)}, not a finite ` +
        `number: ${describe(answer)}`,
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
function requiredStrings(
  value: unknown,
  where: string,
  answer: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new WasmError(
      `prune_neuron sent ${where} as ${typeof value}, not an array: ` +
        describe(answer),
      "INVALID_REQUEST",
    );
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new WasmError(
        `prune_neuron sent ${where}[${index}] as ${typeof entry}, not a ` +
          `string: ${describe(answer)}`,
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
function requiredRecords(
  value: unknown,
  where: string,
  answer: string,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new WasmError(
      `prune_neuron sent ${where} as ${typeof value}, not an array: ` +
        describe(answer),
      "INVALID_REQUEST",
    );
  }
  return value.map((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      throw new WasmError(
        `prune_neuron sent ${where}[${index}] as ${typeof entry}, not a ` +
          `record: ${describe(answer)}`,
        "INVALID_REQUEST",
      );
    }
    return record;
  });
}

/** Read the success half of a response, refusing anything under-specified. */
function readSuccess(
  response: Record<string, unknown>,
  requestedUuid: string,
  answer: string,
): PruneNeuronSuccess {
  const creature = asRecord(response.creature) as CreatureExport | null;
  if (!creature) {
    throw new WasmError(
      `prune_neuron reported a successful rewrite with no creature: ` +
        describe(answer),
      "INVALID_REQUEST",
    );
  }
  // A "creature" that is not one would otherwise die as a TypeError deep in
  // metadata restoration, naming neither core nor this bridge.
  if (!Array.isArray(creature.neurons) || !Array.isArray(creature.synapses)) {
    throw new WasmError(
      `prune_neuron reported a rewrite whose creature has no neurons or ` +
        `synapses array: ${describe(answer)}`,
      "INVALID_REQUEST",
    );
  }
  const transform = response.transform;
  if (transform !== "exact" && transform !== "approximate") {
    throw new WasmError(
      `prune_neuron reported a rewrite with no honest transform label: ` +
        describe(answer),
      "INVALID_REQUEST",
    );
  }
  const passes = requiredNumber(response, "passes", "response", answer);

  // Core answering "removed" about a neuron nobody asked about is a bridge or
  // contract fault; downstream it would show up only as an unexplained
  // unchanged-UUID, long after the evidence is gone.
  const removedNeuron = response.removedNeuron === undefined
    ? undefined
    : requiredString(response, "removedNeuron", "response", answer);
  if (removedNeuron !== undefined && removedNeuron !== requestedUuid) {
    throw new WasmError(
      `prune_neuron was asked to remove ${requestedUuid} but reported ` +
        `removing ${removedNeuron}: ${describe(answer)}`,
      "INVALID_REQUEST",
    );
  }

  return {
    ok: true,
    creature,
    transform,
    passes,
    removedNeuron,
    cascadeNeurons: requiredStrings(
      response.cascadeNeurons ?? [],
      "cascadeNeurons",
      answer,
    ),
    foldedNeurons: requiredStrings(
      response.foldedNeurons ?? [],
      "foldedNeurons",
      answer,
    ),
    downgradedIfNeurons: requiredStrings(
      response.downgradedIfNeurons ?? [],
      "downgradedIfNeurons",
      answer,
    ),
    biasFolds: requiredRecords(response.biasFolds ?? [], "biasFolds", answer)
      .map((fold, i) => ({
        targetUUID: requiredString(
          fold,
          "targetUUID",
          `biasFolds[${i}]`,
          answer,
        ),
        weightSum: requiredNumber(fold, "weightSum", `biasFolds[${i}]`, answer),
        delta: requiredNumber(fold, "delta", `biasFolds[${i}]`, answer),
        exact: fold.exact === true,
        residualVariance: typeof fold.residualVariance === "number"
          ? fold.residualVariance
          : undefined,
      })),
    weightShares: requiredRecords(
      response.weightShares ?? [],
      "weightShares",
      answer,
    ).map((share, i) => ({
      fromUUID: requiredString(share, "fromUUID", `weightShares[${i}]`, answer),
      toUUID: requiredString(share, "toUUID", `weightShares[${i}]`, answer),
      delta: requiredNumber(share, "delta", `weightShares[${i}]`, answer),
    })),
    uncompensated: requiredRecords(
      response.uncompensated ?? [],
      "uncompensated",
      answer,
    ).map((target, i) => ({
      targetUUID: requiredString(
        target,
        "targetUUID",
        `uncompensated[${i}]`,
        answer,
      ),
      type: requiredString(target, "type", `uncompensated[${i}]`, answer),
      weightSum: requiredNumber(
        target,
        "weightSum",
        `uncompensated[${i}]`,
        answer,
      ),
      squash: requiredString(target, "squash", `uncompensated[${i}]`, answer),
      reason: requiredString(target, "reason", `uncompensated[${i}]`, answer),
    })),
  };
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
  if (!pruneFn) {
    throw bundleUnavailable(loadError);
  }
  if (stats) assertFiniteStats(stats);

  const answer = pruneFn(JSON.stringify({ creature, uuid, stats }));

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch (error) {
    throw new WasmError(
      `prune_neuron answered with something that is not JSON: ${
        describe(answer)
      }`,
      "INVALID_REQUEST",
      { cause: error instanceof Error ? error : undefined },
    );
  }

  const response = asRecord(parsed);
  if (!response) {
    throw new WasmError(
      `prune_neuron answered with something that is not a response: ${
        describe(answer)
      }`,
      "INVALID_REQUEST",
    );
  }

  if (response.ok === true) {
    const success = readSuccess(response, uuid, answer);
    restoreCarriedMetadata(creature, success.creature);
    return success;
  }

  const failure = asRecord(response.failure);
  if (!failure) {
    throw new WasmError(
      `prune_neuron reported a failure with no detail: ${describe(answer)}`,
      "INVALID_REQUEST",
    );
  }

  const message = requiredString(failure, "message", "failure", answer);
  // `malformed` says the payload never reached the rewrite, so it says nothing
  // about the creature. Reporting it as a refusal would let a bridge bug
  // masquerade as a neuron core declined to remove.
  if (failure.malformed === true) {
    throw new WasmError(
      `prune_neuron refused the request built for it: ${message}`,
      "INVALID_REQUEST",
    );
  }

  return {
    ok: false,
    reason: requiredString(failure, "reason", "failure", answer),
    message,
  };
}
