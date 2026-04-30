/**
 * CompactModuleGraft.ts — Compact sub-graph graft primitive (Issue #2493).
 *
 * Detect dense, high-activation modules in a small donor (Europa-style) and
 * graft them into a larger sparser recipient (production-style) at periodic
 * import time.
 *
 * Distinct from `SubgraphTransplant` (#2177):
 *   - Targets larger denser modules (default min size 6, vs the 2–5 cap of
 *     `SubgraphTransplant`).
 *   - Selection is density-driven (internal synapse density per neuron) plus
 *     an activation magnitude probe-dataset score, not modularity.
 *   - **Donor neuron UUIDs are preserved verbatim** in the recipient. The
 *     whole point of import-time DNA transfer is that breeding and
 *     cross-machine alignment can later re-align by UUID
 *     (AGENTS.md neuron UUID stability invariant).
 */

import { Creature } from "@creature";
import { addTag } from "@stsoftware/tags/mod";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type {
  DnaSharingPrepareOptions,
  DnaSharingStrategy,
} from "./DnaSharingStrategy.ts";

/** Default minimum size for a dense module. Must exceed `SubgraphTransplant`'s 5-neuron cap. */
const DEFAULT_MIN_SIZE = 6;
/** Default maximum size for a dense module to keep grafts tractable. */
const DEFAULT_MAX_SIZE = 32;
/** Default density factor — module density must be >= factor * median local density. */
const DEFAULT_DENSITY_FACTOR = 1.5;

/**
 * A dense connected hidden-neuron module extracted from a donor creature.
 */
export interface DenseModule {
  /** Donor hidden-neuron UUIDs in the module — preserved verbatim during graft. */
  neuronUuids: string[];
  /** Donor synapses internal to the module (both endpoints in the module). */
  internalSynapses: SynapseExport[];
  /** Donor synapses entering the module from outside (input-N or other hidden). */
  inboundBoundary: SynapseExport[];
  /** Donor synapses leaving the module to the outside. */
  outboundBoundary: SynapseExport[];
  /** Internal-synapse density: `internalSynapses.length / neuronUuids.length`. */
  density: number;
  /**
   * Activation magnitude on the probe dataset. Set by
   * {@link scoreModulesByActivation}; zero before scoring.
   */
  activationScore: number;
}

/** Options shared by detection and the top-level graft entry point. */
export interface DenseModuleDetectionOptions {
  /** Minimum module size. Default {@link DEFAULT_MIN_SIZE} (6). */
  minSize?: number;
  /** Maximum module size. Default {@link DEFAULT_MAX_SIZE} (32). */
  maxSize?: number;
  /**
   * Density multiplier vs the donor's median local density. A module is
   * accepted only if its `density >= densityFactor * medianLocalDensity`.
   * Default {@link DEFAULT_DENSITY_FACTOR} (1.5).
   */
  densityFactor?: number;
}

/** Options accepted by {@link compactModuleGraft}. */
export interface CompactModuleGraftOptions extends DenseModuleDetectionOptions {
  /** Probe dataset used to score module activation magnitude. */
  probe?: DataRecordInterface[];
  /**
   * If set, the graft is rejected unless the recipient has at least this many
   * input neurons. Used to fail fast when the donor relies on inputs the
   * recipient does not provide.
   */
  requireMinimumInputs?: number;
}

/**
 * Detect dense connected hidden-neuron modules in `donorExport`.
 *
 * Modules are connected components of the hidden-only forward graph whose
 * internal-synapse density exceeds `densityFactor * medianLocalDensity`. The
 * returned list is sorted by density descending.
 */
export function detectDenseModules(
  donorExport: CreatureExport,
  options: DenseModuleDetectionOptions = {},
): DenseModule[] {
  const minSize = options.minSize ?? DEFAULT_MIN_SIZE;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  const densityFactor = options.densityFactor ?? DEFAULT_DENSITY_FACTOR;

  const hiddenUuidSet = new Set<string>();
  for (const n of donorExport.neurons) {
    if (n.type === "hidden" && typeof n.uuid === "string") {
      hiddenUuidSet.add(n.uuid);
    }
  }
  if (hiddenUuidSet.size < minSize) return [];

  // Build undirected adjacency over hidden neurons (cluster discovery is
  // direction-agnostic; direction is preserved in the synapse copies).
  const adj = new Map<string, Set<string>>();
  for (const u of hiddenUuidSet) adj.set(u, new Set());

  // Per-neuron internal degree — needed to compute a median local density.
  const localDegree = new Map<string, number>();
  for (const u of hiddenUuidSet) localDegree.set(u, 0);

  for (const syn of donorExport.synapses) {
    const f = syn.fromUUID;
    const t = syn.toUUID;
    if (!f || !t) continue;
    if (hiddenUuidSet.has(f) && hiddenUuidSet.has(t) && f !== t) {
      adj.get(f)!.add(t);
      adj.get(t)!.add(f);
      localDegree.set(f, (localDegree.get(f) ?? 0) + 1);
      localDegree.set(t, (localDegree.get(t) ?? 0) + 1);
    }
  }

  // Median local degree across hidden neurons. Local density per neuron is
  // its hidden-neighbour count divided by the (possible) hidden neighbours.
  // We use raw degree (count) for the median because the divisor is constant
  // across neurons in a single donor — order is preserved.
  const degrees = [...localDegree.values()].sort((a, b) => a - b);
  const median = degrees.length === 0
    ? 0
    : degrees[Math.floor(degrees.length / 2)];
  // Avoid a zero threshold producing trivial acceptance.
  const localMedianDensity = median / Math.max(1, hiddenUuidSet.size - 1);
  const minDensity = Math.max(
    densityFactor * localMedianDensity,
    // Floor: at least one synapse per neuron on average to call it "dense".
    1,
  );

  // Connected components via BFS.
  const seen = new Set<string>();
  const modules: DenseModule[] = [];
  for (const start of hiddenUuidSet) {
    if (seen.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const u = queue.shift()!;
      component.push(u);
      for (const v of adj.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
    if (component.length < minSize) continue;
    if (component.length > maxSize) {
      // Keep the densest sub-prefix of this component up to maxSize.
      // Greedy: order by local degree desc and take the top maxSize.
      component.sort((a, b) =>
        (localDegree.get(b) ?? 0) - (localDegree.get(a) ?? 0)
      );
      component.length = maxSize;
    }

    const moduleSet = new Set(component);
    const internal: SynapseExport[] = [];
    const inbound: SynapseExport[] = [];
    const outbound: SynapseExport[] = [];
    for (const syn of donorExport.synapses) {
      const f = syn.fromUUID;
      const t = syn.toUUID;
      if (!f || !t) continue;
      const fInside = moduleSet.has(f);
      const tInside = moduleSet.has(t);
      if (fInside && tInside) internal.push(syn);
      else if (!fInside && tInside) inbound.push(syn);
      else if (fInside && !tInside) outbound.push(syn);
    }

    if (internal.length === 0) continue;
    const density = internal.length / component.length;
    if (density < minDensity) continue;

    modules.push({
      neuronUuids: component,
      internalSynapses: internal,
      inboundBoundary: inbound,
      outboundBoundary: outbound,
      density,
      activationScore: 0,
    });
  }

  modules.sort((a, b) => b.density - a.density);
  return modules;
}

/**
 * Score `modules` by aggregate activation magnitude on `probe`.
 *
 * Activates the donor on each probe sample and sums |activation| across all
 * neurons in each module. Higher means the module does more work on the
 * probe dataset — it is the candidate worth grafting.
 *
 * Mutates `modules[i].activationScore` in place and returns the same array
 * for chaining.
 */
export function scoreModulesByActivation(
  modules: DenseModule[],
  donor: Creature,
  probe: DataRecordInterface[],
): DenseModule[] {
  if (modules.length === 0 || probe.length === 0) {
    for (const m of modules) m.activationScore = 0;
    return modules;
  }

  // Map each module's UUIDs to runtime neuron indices via the donor neurons.
  const uuidToIndex = new Map<string, number>();
  for (const n of donor.neurons) {
    if (typeof n.uuid === "string" && typeof n.index === "number") {
      uuidToIndex.set(n.uuid, n.index);
    }
  }

  const moduleIndices = modules.map((m) =>
    m.neuronUuids
      .map((u) => uuidToIndex.get(u))
      .filter((i): i is number => typeof i === "number")
  );

  const sums = new Array<number>(modules.length).fill(0);

  for (const sample of probe) {
    donor.activate(sample.input, false);
    const acts = donor.state.activations;
    for (let mi = 0; mi < modules.length; mi++) {
      let s = 0;
      for (const idx of moduleIndices[mi]) {
        const v = acts[idx];
        if (Number.isFinite(v)) s += Math.abs(v);
      }
      sums[mi] += s;
    }
  }

  for (let i = 0; i < modules.length; i++) {
    modules[i].activationScore = sums[i] / probe.length;
  }
  return modules;
}

/**
 * Detect, score, and graft the best dense module from `donor` into a copy of
 * `recipient`. Returns the new offspring or `undefined` if no graft survives
 * validation.
 *
 * Donor neuron UUIDs are preserved verbatim. UUIDs already present in the
 * recipient are skipped — the recipient's neuron wins, since the recipient is
 * the topology of record (UUID stability for the recipient).
 */
export function compactModuleGraft(
  recipient: Creature,
  donor: Creature,
  options: CompactModuleGraftOptions = {},
): Creature | undefined {
  const recipientExport = recipient.exportJSON();

  if (
    typeof options.requireMinimumInputs === "number" &&
    recipientExport.input < options.requireMinimumInputs
  ) {
    return undefined;
  }

  const donorExport = donor.exportJSON();
  const modules = detectDenseModules(donorExport, options);
  if (modules.length === 0) return undefined;

  // Score and pick the module with the highest activationScore. Ties break on
  // density (module list is already density-sorted, so the original order
  // breaks the tie deterministically).
  if (options.probe && options.probe.length > 0) {
    scoreModulesByActivation(modules, donor, options.probe);
    modules.sort((a, b) => {
      if (b.activationScore !== a.activationScore) {
        return b.activationScore - a.activationScore;
      }
      return b.density - a.density;
    });
  }

  const recipientUuids = new Set<string>();
  for (const n of recipientExport.neurons) {
    if (typeof n.uuid === "string") recipientUuids.add(n.uuid);
  }

  for (const m of modules) {
    const offspring = tryGraft(recipientExport, donorExport, m, recipientUuids);
    if (offspring) return offspring;
  }
  return undefined;
}

/**
 * Attempt to graft `module` from `donorExport` into a clone of
 * `recipientExport`. Returns the resulting Creature when the graft passes
 * validation, otherwise `undefined`.
 */
function tryGraft(
  recipientExport: CreatureExport,
  donorExport: CreatureExport,
  module: DenseModule,
  recipientUuids: Set<string>,
): Creature | undefined {
  // Clone the recipient's neurons and synapses into mutable arrays.
  const offspringNeurons: NeuronExport[] = recipientExport.neurons.map((n) => ({
    ...n,
  }));
  const offspringSynapses: SynapseExport[] = recipientExport.synapses.map(
    (s) => ({ ...s }),
  );

  // Donor neuron lookup keyed by UUID.
  const donorNeuronByUuid = new Map<string, NeuronExport>();
  for (const n of donorExport.neurons) {
    if (n.type === "hidden" && typeof n.uuid === "string") {
      donorNeuronByUuid.set(n.uuid, n);
    }
  }

  // Insert donor module neurons before the first output neuron, preserving
  // each donor neuron's original UUID. UUIDs already present in the
  // recipient are skipped — the recipient wins.
  let insertIndex = offspringNeurons.length;
  for (let i = offspringNeurons.length - 1; i >= 0; i--) {
    if (offspringNeurons[i].type === "output") insertIndex = i;
    else break;
  }

  const inserted: NeuronExport[] = [];
  for (const uuid of module.neuronUuids) {
    if (recipientUuids.has(uuid)) continue;
    const donorNeuron = donorNeuronByUuid.get(uuid);
    if (!donorNeuron) continue;
    const cloned: NeuronExport = {
      type: "hidden",
      uuid,
      squash: donorNeuron.squash,
      bias: donorNeuron.bias,
    };
    addTag(cloned, "approach", "compact-module-graft");
    inserted.push(cloned);
  }
  if (inserted.length === 0) return undefined;
  offspringNeurons.splice(insertIndex, 0, ...inserted);

  const insertedUuids = new Set(inserted.map((n) => n.uuid as string));

  // Copy internal module synapses verbatim — donor UUIDs are preserved so
  // the synapse endpoints resolve unchanged.
  for (const syn of module.internalSynapses) {
    if (
      typeof syn.fromUUID === "string" &&
      typeof syn.toUUID === "string" &&
      insertedUuids.has(syn.fromUUID) &&
      insertedUuids.has(syn.toUUID)
    ) {
      offspringSynapses.push({
        fromUUID: syn.fromUUID,
        toUUID: syn.toUUID,
        weight: syn.weight,
        type: syn.type,
      });
    }
  }

  // Boundary alignment by shared input. Connect any inbound `input-N`
  // synapse from the donor to the same `input-N` in the recipient (only when
  // the recipient has that input) — same input semantics, same edge. Keep
  // the donor's weight so the module's learned activation pattern is
  // preserved end-to-end.
  for (const syn of module.inboundBoundary) {
    if (
      typeof syn.fromUUID === "string" &&
      typeof syn.toUUID === "string" &&
      syn.fromUUID.startsWith("input-") &&
      insertedUuids.has(syn.toUUID)
    ) {
      const idx = parseInputIndex(syn.fromUUID);
      if (idx === undefined || idx >= recipientExport.input) continue;
      offspringSynapses.push({
        fromUUID: syn.fromUUID,
        toUUID: syn.toUUID,
        weight: syn.weight,
        type: syn.type,
      });
    }
  }

  // Outbound boundary: connect each module exit to every recipient output
  // with a near-zero seed weight. The graft must be score-neutral on day 0
  // (so absolute lift can be positive after subsequent training) — the
  // recipient's existing pathways are left intact and the new pathway only
  // contributes meaningfully once weights have evolved.
  const exits = findModuleExits(module);
  const outputUuids = recipientExport.neurons
    .filter((n) => n.type === "output" && typeof n.uuid === "string")
    .map((n) => n.uuid as string);

  // Boundary seed weight: small enough to be score-neutral but non-zero so
  // gradient descent can escape it.
  const BOUNDARY_SEED_WEIGHT = 0.001;
  for (const exitUuid of exits) {
    if (!insertedUuids.has(exitUuid)) continue;
    for (const outUuid of outputUuids) {
      offspringSynapses.push({
        fromUUID: exitUuid,
        toUUID: outUuid,
        weight: BOUNDARY_SEED_WEIGHT,
      });
    }
  }

  // Ensure each inserted module neuron has at least one inbound and one
  // outbound edge in the offspring (creatureValidate rejects orphans).
  // Bridge from input-0 / to output-0 only when missing.
  ensureBoundaries(offspringSynapses, insertedUuids, outputUuids);

  // De-duplicate synapses on (fromUUID, toUUID) — the recipient may already
  // have an `input-N -> module` edge if the donor reused a popular UUID.
  const seenEdges = new Set<string>();
  const dedupedSynapses: SynapseExport[] = [];
  for (const s of offspringSynapses) {
    const key = `${s.fromUUID}->${s.toUUID}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    dedupedSynapses.push(s);
  }

  const offspringJson: CreatureExport = {
    input: recipientExport.input,
    output: recipientExport.output,
    neurons: offspringNeurons,
    synapses: dedupedSynapses,
    forwardOnly: recipientExport.forwardOnly,
  };

  let offspring: Creature;
  try {
    offspring = Creature.fromJSON(offspringJson);
    offspring.fix();
  } catch {
    return undefined;
  }

  try {
    if (recipientExport.forwardOnly) {
      creatureValidate(offspring, { forwardOnly: true });
    } else {
      creatureValidate(offspring);
    }
  } catch {
    return undefined;
  }

  return offspring;
}

/** Parse the numeric index from `input-N`. Returns undefined if malformed. */
function parseInputIndex(uuid: string): number | undefined {
  if (!uuid.startsWith("input-")) return undefined;
  const tail = uuid.slice("input-".length);
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Module exits: neurons with no outbound internal synapse. */
function findModuleExits(module: DenseModule): string[] {
  const internalOutbound = new Set<string>();
  for (const syn of module.internalSynapses) {
    if (typeof syn.fromUUID === "string") internalOutbound.add(syn.fromUUID);
  }
  const exits = module.neuronUuids.filter((u) => !internalOutbound.has(u));
  return exits.length > 0 ? exits : module.neuronUuids.slice(-1);
}

/**
 * Ensure each inserted module neuron has at least one inbound and outbound
 * edge in the offspring synapse list. Bridges from `input-0` and to the
 * first recipient output as a defensive default.
 */
function ensureBoundaries(
  synapses: SynapseExport[],
  insertedUuids: Set<string>,
  outputUuids: string[],
): void {
  const hasInbound = new Set<string>();
  const hasOutbound = new Set<string>();
  for (const s of synapses) {
    if (s.toUUID && insertedUuids.has(s.toUUID)) hasInbound.add(s.toUUID);
    if (s.fromUUID && insertedUuids.has(s.fromUUID)) {
      hasOutbound.add(s.fromUUID);
    }
  }
  for (const uuid of insertedUuids) {
    if (!hasInbound.has(uuid)) {
      synapses.push({ fromUUID: "input-0", toUUID: uuid, weight: 0.001 });
    }
    if (!hasOutbound.has(uuid) && outputUuids.length > 0) {
      synapses.push({ fromUUID: uuid, toUUID: outputUuids[0], weight: 0.001 });
    }
  }
}

/**
 * `DnaSharingStrategy` adapter for the bake-off harness.
 *
 * Calling `prepare(recipient, donor)` runs {@link compactModuleGraft} and, on
 * success, mutates the recipient in place via `loadFrom` so the harness
 * proceeds with the grafted topology. On rejection (no viable module, or
 * `creatureValidate` fails), the recipient is left untouched and the row
 * shows zero structural change.
 */
export class CompactModuleGraftStrategy implements DnaSharingStrategy {
  readonly name = "CompactModuleGraft";

  constructor(private readonly opts: CompactModuleGraftOptions = {}) {}

  prepare(
    recipient: Creature,
    donor: Creature,
    _options: DnaSharingPrepareOptions,
  ): Promise<void> {
    const grafted = compactModuleGraft(recipient, donor, this.opts);
    if (grafted) {
      recipient.loadFrom(grafted.exportJSON(), false, "transfer:compactGraft");
    }
    return Promise.resolve();
  }
}
