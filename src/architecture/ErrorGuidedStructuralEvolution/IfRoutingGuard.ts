/**
 * Structure-aware guard for discovery's low-impact neuron removal
 * (GRQ issue #4303).
 *
 * Discovery ranks removal candidates by **impact** — a neuron's magnitude of
 * contribution to the activation sums downstream of it. That metric is blind to
 * one whole class of structure: an `IF` neuron routes on the *presence* of its
 * `condition` / `positive` / `negative` inbound edges, and Forests grafts carry
 * their thresholds and leaf values as weights on shared bias-1 constant
 * neurons. Such a neuron adds almost nothing to any sum, so it scores ~0.00%
 * impact, yet deleting it flips or breaks the routing decision of every node
 * hanging off it — and one shared constant can back hundreds of nodes.
 *
 * A Forests-lineage champion was published after exactly this: one neuron
 * removed at a measured `impact: 0.00%` cost 0.118 of score, about a third of
 * the creature's value.
 *
 * The remedy matches the rule the compaction pass already documents ("synapses
 * targeting an `IF` neuron are never pruned", `compact/AggressivePrune.ts`):
 * a neuron that feeds an `IF` neuron is not a low-impact removal candidate,
 * because activation contribution cannot assess it.
 */

/** Minimal neuron shape the guard reads. */
interface GuardNeuron {
  uuid?: string;
  squash?: string;
}

/** Minimal synapse shape the guard reads. */
interface GuardSynapse {
  fromUUID?: string;
  toUUID?: string;
}

/** Activation name of the aggregate routing neuron Forests grafts as tree nodes. */
const IF_SQUASH = "IF";

/**
 * Does `neuronUuid` feed an `IF` neuron?
 *
 * Every inbound edge of an `IF` node carries a routing role (condition,
 * positive, negative), and the constants those roles read ride on the same
 * edges, so a single outgoing synapse into an `IF` neuron is enough to pin the
 * source neuron regardless of role or weight magnitude.
 *
 * @param neurons - the creature's non-input neurons (`CreatureExport.neurons`).
 * @param synapses - the creature's synapses (`CreatureExport.synapses`).
 * @param neuronUuid - the removal candidate under consideration.
 * @returns `true` when removing the neuron would disturb `IF` routing.
 */
export function feedsIfNeuron(
  neurons: readonly GuardNeuron[],
  synapses: readonly GuardSynapse[],
  neuronUuid: string,
): boolean {
  const ifNeuronUUIDs = new Set<string>();
  for (const neuron of neurons) {
    if (neuron.squash === IF_SQUASH && neuron.uuid !== undefined) {
      ifNeuronUUIDs.add(neuron.uuid);
    }
  }
  if (ifNeuronUUIDs.size === 0) return false;

  for (const synapse of synapses) {
    if (synapse.fromUUID !== neuronUuid) continue;
    if (synapse.toUUID !== undefined && ifNeuronUUIDs.has(synapse.toUUID)) {
      return true;
    }
  }
  return false;
}
