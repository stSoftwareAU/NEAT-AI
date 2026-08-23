/**
 * What a repair pass actually did, element by element (Issue #3848).
 *
 * The #3845 outage was invisible for two days because nothing recorded the
 * edits. `Upgrade.correct()` rewrote 46 of a champion's 26,077 synapses and the
 * neuron and synapse *counts* were unchanged, so no size or count check saw
 * anything; the damage could only be found by diffing the two exports by hand.
 *
 * This module is that diff, done by the pass itself. It answers two questions:
 *
 * 1. **What changed?** — {@link auditRepair} lists every synapse and neuron the
 *    repair added, removed or altered, so the log can state *rule → element →
 *    action* rather than "repaired".
 * 2. **Did it rewire something it does not understand?** —
 *    {@link findRoleRewiring} looks for exactly the #3845 damage: a role-typed
 *    synapse feeding an `IF` neuron moved off its source, or a new one invented,
 *    on an `IF` no failing rule named. In a grafted decision tree the leaf value
 *    **is** the weight on a shared bias-1 constant, so re-sourcing that edge
 *    turns a constant leaf into a function of unrelated data and the tree stops
 *    being a tree.
 *
 * @module
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { IF } from "@methods/activations/aggregate/IF.ts";

/** One synapse's identity: source, target and the role it carries. */
type SynapseRow = CreatureExport["synapses"][number];

/** One neuron's identity as the audit compares it. */
type NeuronRow = CreatureExport["neurons"][number];

/** `fromUUID -> toUUID [role]` — the identity of one wire. */
export function synapseKey(synapse: SynapseRow): string {
  return `${synapse.fromUUID} -> ${synapse.toUUID} [${synapse.type ?? "none"}]`;
}

/** Everything about a neuron a repair could change without moving an edge. */
function neuronSignature(neuron: NeuronRow): string {
  return `${neuron.type}:${neuron.squash ?? "none"}:${neuron.bias ?? 0}`;
}

/** The structural difference between the creature that arrived and what left. */
export interface RepairAudit {
  /** `fromUUID -> toUUID [role]` of every synapse the repair dropped. */
  synapsesRemoved: string[];
  /** `fromUUID -> toUUID [role]` of every synapse the repair invented. */
  synapsesAdded: string[];
  /** `wire: before -> after` for every surviving synapse whose weight moved. */
  weightsChanged: string[];
  /** UUIDs of neurons the repair dropped. */
  neuronsRemoved: string[];
  /** UUIDs of neurons the repair introduced. */
  neuronsAdded: string[];
  /** `uuid: before -> after` for every surviving neuron whose shape changed. */
  neuronsAltered: string[];
}

/** An audit of a pass that changed nothing. */
export function emptyRepairAudit(): RepairAudit {
  return {
    synapsesRemoved: [],
    synapsesAdded: [],
    weightsChanged: [],
    neuronsRemoved: [],
    neuronsAdded: [],
    neuronsAltered: [],
  };
}

/**
 * Diff two exports of the same creature, before and after a repair.
 *
 * Identity is by UUID throughout — neuron array positions shift the moment a
 * neuron is removed, so a positional diff would report the whole tail of the
 * creature as changed.
 */
export function auditRepair(
  before: CreatureExport,
  after: CreatureExport,
): RepairAudit {
  const beforeSynapses = new Map(
    before.synapses.map((s) => [synapseKey(s), s.weight]),
  );
  const afterSynapses = new Map(
    after.synapses.map((s) => [synapseKey(s), s.weight]),
  );
  const beforeNeurons = new Map(
    before.neurons.map((n) => [n.uuid ?? "", neuronSignature(n)]),
  );
  const afterNeurons = new Map(
    after.neurons.map((n) => [n.uuid ?? "", neuronSignature(n)]),
  );

  return {
    synapsesRemoved: [...beforeSynapses.keys()].filter((k) =>
      !afterSynapses.has(k)
    ),
    synapsesAdded: [...afterSynapses.keys()].filter((k) =>
      !beforeSynapses.has(k)
    ),
    weightsChanged: [...beforeSynapses.entries()]
      .filter(([k, w]) => afterSynapses.has(k) && afterSynapses.get(k) !== w)
      .map(([k, w]) => `${k}: ${w} -> ${afterSynapses.get(k)}`),
    neuronsRemoved: [...beforeNeurons.keys()].filter((u) =>
      !afterNeurons.has(u)
    ),
    neuronsAdded: [...afterNeurons.keys()].filter((u) => !beforeNeurons.has(u)),
    neuronsAltered: [...beforeNeurons.entries()]
      .filter(([u, d]) => afterNeurons.has(u) && afterNeurons.get(u) !== d)
      .map(([u, d]) => `${u}: ${d} -> ${afterNeurons.get(u)}`),
  };
}

/** True when the repair left the creature structurally identical. */
export function repairChangedNothing(audit: RepairAudit): boolean {
  return audit.synapsesRemoved.length === 0 &&
    audit.synapsesAdded.length === 0 &&
    audit.weightsChanged.length === 0 &&
    audit.neuronsRemoved.length === 0 &&
    audit.neuronsAdded.length === 0 &&
    audit.neuronsAltered.length === 0;
}

/** Longest sample of any one category quoted in a log line. */
const AUDIT_SAMPLE = 4;

/** One-line, log-friendly rendering of what the repair changed. */
export function describeRepairAudit(audit: RepairAudit): string {
  const part = (label: string, values: string[]) =>
    `${label} ${values.length}${
      values.length > 0
        ? ` ${JSON.stringify(values.slice(0, AUDIT_SAMPLE))}`
        : ""
    }`;
  return [
    part("synapses-removed", audit.synapsesRemoved),
    part("synapses-added", audit.synapsesAdded),
    part("weights-changed", audit.weightsChanged),
    part("neurons-removed", audit.neuronsRemoved),
    part("neurons-added", audit.neuronsAdded),
    part("neurons-altered", audit.neuronsAltered),
  ].join("; ");
}

/** UUIDs of the `IF` neurons in an export, keyed for O(1) lookup. */
function ifNeuronUuids(creatureExport: CreatureExport): Set<string> {
  const uuids = new Set<string>();
  for (const neuron of creatureExport.neurons) {
    if (neuron.squash === IF.NAME && neuron.uuid !== undefined) {
      uuids.add(neuron.uuid);
    }
  }
  return uuids;
}

/** Every neuron UUID present in an export. */
function neuronUuids(creatureExport: CreatureExport): Set<string> {
  const uuids = new Set<string>();
  for (const neuron of creatureExport.neurons) {
    if (neuron.uuid !== undefined) uuids.add(neuron.uuid);
  }
  return uuids;
}

/**
 * Role-typed edges a repair moved on an `IF` it had no reason to touch.
 *
 * An `IF` node's `condition` / `positive` / `negative` edges matter by
 * **presence and source**, not magnitude, and a bias-1 constant feeding a branch
 * is not a redundant constant — it *is* the leaf value. A repair pass whose
 * heuristics predate role-typed synapses cannot interpret any of that, so it
 * must decline to touch it. Two things count as touching it:
 *
 * - **removing** a role-typed edge whose source and target both survived the
 *   repair — the edge could have been left exactly where it was;
 * - **adding** one that was not there before — substitution is a guess about
 *   intent, and re-pointing a branch at an arbitrary input fabricates a model;
 * - **downgrading** the `IF` itself to an ordinary activation, which discards
 *   the routing the branch roles encoded.
 *
 * An edge whose source neuron the repair legitimately removed is not counted:
 * the edge had to go with it, and the `IF` left short of a role is then reported
 * by `IF_CONDITIONS` on the next validation, which puts it in `justified`. Nor
 * is an `IF` the repair removed outright — the neuron rules name that neuron
 * themselves, and a cascade removal of a feeder is answering a rule of its own.
 *
 * @param before - The creature as it arrived.
 * @param after - The creature the repair proposes to return.
 * @param justified - UUIDs of neurons a failing validation rule actually named.
 * @returns One line per violation; empty when the repair kept its hands off.
 */
export function findRoleRewiring(
  before: CreatureExport,
  after: CreatureExport,
  justified: ReadonlySet<string>,
): string[] {
  const originalIfs = ifNeuronUuids(before);
  const survivingIfs = ifNeuronUuids(after);
  const survivingNeurons = neuronUuids(after);
  const afterKeys = new Set(after.synapses.map(synapseKey));
  const beforeKeys = new Set(before.synapses.map(synapseKey));
  const violations: string[] = [];

  for (const uuid of originalIfs) {
    if (!survivingNeurons.has(uuid)) continue;
    if (survivingIfs.has(uuid) || justified.has(uuid)) continue;
    violations.push(
      `downgraded IF ${uuid} to an ordinary activation — no rule named it, ` +
        `so the routing its branch roles encoded was discarded on a guess`,
    );
  }

  for (const synapse of before.synapses) {
    if (synapse.type === undefined) continue;
    const target = synapse.toUUID ?? "";
    if (!survivingIfs.has(target) || justified.has(target)) continue;
    if (!survivingNeurons.has(synapse.fromUUID ?? "")) continue;
    if (afterKeys.has(synapseKey(synapse))) continue;
    violations.push(
      `removed ${synapseKey(synapse)} — both endpoints survived and no rule ` +
        `named ${target}`,
    );
  }

  for (const synapse of after.synapses) {
    if (synapse.type === undefined) continue;
    const target = synapse.toUUID ?? "";
    if (!survivingIfs.has(target) || justified.has(target)) continue;
    if (beforeKeys.has(synapseKey(synapse))) continue;
    violations.push(
      `added ${synapseKey(synapse)} — no rule named ${target}, so this edge ` +
        `is a guess about intent`,
    );
  }

  return violations;
}
