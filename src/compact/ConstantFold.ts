import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "@architecture/NeuronInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { Activations } from "@methods/activations/Activations.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { isAggregationSquash } from "@methods/activations/SquashUtils.ts";

/**
 * Result of folding constant neurons.
 */
export interface ConstantFoldResult {
  /** Whether any fold/collapse occurred. */
  changed: boolean;
  /** Number of neurons removed (constant producers + collapsed hidden). */
  removedNeurons: number;
  /** Number of synapses removed. */
  removedSynapses: number;
}

/**
 * Duck-type guard: the activation implements a scalar `squash(x)` method.
 *
 * Aggregate activations (IF, MAXIMUM, MINIMUM, HYPOT, HYPOTv2) operate over
 * multiple inputs and do NOT expose a single-argument squash, so they are
 * excluded by this guard.
 */
function hasScalarSquash(
  activation: unknown,
): activation is ActivationInterface {
  return typeof (activation as ActivationInterface).squash === "function";
}

/**
 * Fold `type:"constant"` neurons — and hidden neurons that have become
 * effectively constant — into their additive (non-aggregate) consumers'
 * biases, iterating to a fixpoint (Issue #3035).
 *
 * Two lossless transforms, both belonging to the **safe** compaction variant:
 *
 * 1. **Transitive constant fold (fixpoint).** A constant producer `C` emits the
 *    fixed scalar `C.bias`. For every non-aggregate consumer `B`, the
 *    contribution `weight · C.bias` is folded into `B.bias` and the synapse is
 *    removed. When `C` has no remaining consumers it is deleted. Each fold can
 *    turn another neuron's inputs entirely constant, so the whole pass repeats
 *    until nothing changes.
 *
 * 2. **Zero-varying-input collapse.** When a hidden neuron `H` has **zero**
 *    genuinely varying inputs (every input is constant, or it has no inputs at
 *    all), its output is the fixed scalar `squash(H.pre)` where
 *    `H.pre = Σ(weightᵢ · constantᵢ) + H.bias`. The squash is applied via the
 *    existing activation lookup (never hand-rolled). That scalar is then folded
 *    downstream exactly like a constant producer and `H` is deleted.
 *
 * Safety rules:
 * - Only fold into **non-aggregate** consumers (`!isAggregationSquash`).
 *   Aggregate squashes treat each inbound value specially, so a constant cannot
 *   be folded into their bias. A producer feeding an aggregate consumer is
 *   retained for that consumer.
 * - A neuron is only treated as effectively constant when it has **zero**
 *   varying inputs. Any genuinely varying input means the neuron is never
 *   constant.
 * - Only non-aggregate squashes (those exposing a scalar `squash(x)`) are
 *   collapsed; aggregate hidden neurons are left untouched.
 * - Never fold away an output neuron's last inbound synapse — outputs must keep
 *   at least one inbound connection for structural validity.
 * - Frozen consumers/synapses (Issue #1861) are never modified.
 *
 * The export is modified in place.
 *
 * @param creatureExport - The CreatureExport to fold (modified in place).
 * @returns Counts of removed neurons/synapses and whether anything changed.
 */
export function foldConstants(
  creatureExport: CreatureExport,
): ConstantFoldResult {
  normaliseCreatureExport(creatureExport);

  let removedNeurons = 0;
  let removedSynapses = 0;
  let changedAny = false;

  // Outer fixpoint loop: each iteration folds at most one producer, then
  // rebuilds its working maps so a freshly exposed constant is picked up.
  for (;;) {
    const neuronMap = new Map<number, NeuronExport>();
    for (const n of creatureExport.neurons) {
      neuronMap.set(n.id!, n);
    }

    const inward = new Map<number, SynapseExport[]>();
    const outward = new Map<number, SynapseExport[]>();
    for (const s of creatureExport.synapses) {
      const inList = inward.get(s.toId!);
      if (inList) inList.push(s);
      else inward.set(s.toId!, [s]);

      const outList = outward.get(s.fromId!);
      if (outList) outList.push(s);
      else outward.set(s.fromId!, [s]);
    }

    const constValue = computeConstantValues(
      creatureExport.neurons,
      inward,
    );

    const folded = foldOneProducer(
      creatureExport,
      neuronMap,
      inward,
      outward,
      constValue,
    );

    if (!folded) break;

    removedNeurons += folded.removedNeurons;
    removedSynapses += folded.removedSynapses;
    changedAny = true;
    delete creatureExport.memetic;
  }

  return { changed: changedAny, removedNeurons, removedSynapses };
}

/**
 * Compute, to a fixpoint, the scalar value of every effectively-constant
 * neuron. A `constant`-type neuron's value is its bias. A non-aggregate hidden
 * neuron whose every input is constant (or which has no inputs) is constant
 * with value `squash(Σ(weightᵢ · constantᵢ) + bias)`.
 */
function computeConstantValues(
  neurons: NeuronExport[],
  inward: Map<number, SynapseExport[]>,
): Map<number, number> {
  const constValue = new Map<number, number>();

  for (const n of neurons) {
    if (n.type === "constant") {
      constValue.set(n.id!, n.bias);
    }
  }

  for (;;) {
    let added = false;
    for (const n of neurons) {
      if (n.type !== "hidden") continue;
      if (constValue.has(n.id!)) continue;
      if (!n.squash || isAggregationSquash(n.squash)) continue;

      const ins = inward.get(n.id!) ?? [];

      let pre = n.bias;
      let allConst = true;
      for (const s of ins) {
        const v = constValue.get(s.fromId!);
        if (v === undefined) {
          allConst = false;
          break;
        }
        pre += s.weight * v;
      }
      if (!allConst) continue;

      const activation = Activations.find(n.squash);
      if (!hasScalarSquash(activation)) continue;

      constValue.set(n.id!, activation.squash(pre));
      added = true;
    }
    if (!added) break;
  }

  return constValue;
}

/**
 * Fold a single constant producer into its non-aggregate consumers. Returns the
 * removal counts when a fold happened, or `undefined` when nothing could be
 * folded (the fixpoint has been reached).
 */
function foldOneProducer(
  creatureExport: CreatureExport,
  neuronMap: Map<number, NeuronExport>,
  inward: Map<number, SynapseExport[]>,
  outward: Map<number, SynapseExport[]>,
  constValue: Map<number, number>,
): { removedNeurons: number; removedSynapses: number } | undefined {
  for (const producer of creatureExport.neurons) {
    const value = constValue.get(producer.id!);
    if (value === undefined) continue;
    // Never fold/delete an output; disconnected producers are left to the
    // dedicated orphan cleanup.
    if (producer.type === "output") continue;
    if (producer.frozen) continue;

    const outs = outward.get(producer.id!) ?? [];
    if (outs.length === 0) continue;

    // Group the foldable synapses by consumer so output last-inbound protection
    // can be applied per consumer.
    const foldableByConsumer = new Map<number, SynapseExport[]>();
    for (const s of outs) {
      if (s.type) continue; // typed synapses (eg IF roles) are never folded
      if (s.frozen) continue;
      const consumer = neuronMap.get(s.toId!);
      if (!consumer) continue;
      if (consumer.frozen) continue;
      if (isAggregationSquash(consumer.squash)) continue;

      const list = foldableByConsumer.get(s.toId!);
      if (list) list.push(s);
      else foldableByConsumer.set(s.toId!, [s]);
    }

    if (foldableByConsumer.size === 0) continue;

    const foldSet = new Set<SynapseExport>();
    for (const [consumerId, synapses] of foldableByConsumer) {
      const consumer = neuronMap.get(consumerId)!;
      let toFold = synapses;

      // Structural validity: an output must keep at least one inbound synapse.
      if (consumer.type === "output") {
        const totalInbound = (inward.get(consumerId) ?? []).length;
        if (totalInbound - synapses.length < 1) {
          // Retain one synapse unfolded so the output keeps an inbound edge.
          toFold = synapses.slice(1);
        }
      }

      for (const s of toFold) {
        consumer.bias += s.weight * value;
        foldSet.add(s);
      }
    }

    if (foldSet.size === 0) continue;

    let removedSynapses = 0;
    let removedNeurons = 0;

    const before = creatureExport.synapses.length;
    creatureExport.synapses = creatureExport.synapses.filter(
      (s) => !foldSet.has(s),
    );
    removedSynapses += before - creatureExport.synapses.length;

    // Delete the producer when it has no remaining outbound synapses, removing
    // any now-orphaned inbound synapses along with it.
    const remainingOut = outs.filter((s) => !foldSet.has(s));
    if (remainingOut.length === 0) {
      const beforeIncident = creatureExport.synapses.length;
      creatureExport.synapses = creatureExport.synapses.filter(
        (s) => s.fromId !== producer.id! && s.toId !== producer.id!,
      );
      removedSynapses += beforeIncident - creatureExport.synapses.length;
      creatureExport.neurons = creatureExport.neurons.filter(
        (n) => n.id !== producer.id!,
      );
      removedNeurons += 1;
    }

    return { removedNeurons, removedSynapses };
  }

  return undefined;
}
