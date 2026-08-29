/**
 * Rule-driven repair: fix the element the failed rule named, and nothing else
 * (Issue #3848).
 *
 * The pass this replaces ran every heuristic it owned over the whole creature
 * whenever any rule failed — and, before #3845, whenever *no* rule failed. On a
 * champion carrying grafted `IF` forests that rewrote 46 unrelated edges while
 * the validator had flagged nothing at all.
 *
 * `creatureValidate` already knows better than that: NEAT-AI-core reports the
 * rule that broke **and** the neuron it broke on, and Issue #3848 carries that
 * neuron index out through {@link ValidationError}. So a repair can be dispatched
 * per rule against that one element and be able to state *"rule R failed at
 * element E, so I changed E"*.
 *
 * Each repair here is a **removal or a downgrade**. None of them invents a
 * synapse: substituting an arbitrary source for an edge the pass cannot
 * interpret is a guess about intent, and an honest repair either removes the
 * offending element or declines and lets the caller report failure.
 *
 * A rule with no entry here returns `null`, which is not a silent pass — the
 * caller ({@link module:src/repair/VerifiedRepair}) records the gap and falls
 * back to the legacy blunt pass under the same verification.
 *
 * @module
 */

import type { Creature } from "@creature";
import type { ValidationError } from "@errors/ValidationError.ts";
import { removeHiddenNeuron } from "@compact/CompactUtils.ts";
import { pruneOrphanMemeticReferences } from "@compact/MemeticCleanup.ts";
import { moveConstantNeuronIntoPrefix } from "@architecture/NormaliseComputationalNeuronOrder.ts";
import { repairInvalidIfNeuron } from "@architecture/RepairInvalidIfNeurons.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { neuronWireLabelForDiagnostics } from "@neuron/NeuronSerialization.ts";

import { shedIdentity } from "@architecture/ScoreProvenance.ts";
/** One entry in the repair's audit trail: rule → element → action. */
export interface RepairAction {
  /** The validation rule that failed. */
  rule: string;
  /** Wire label of the element the rule named, or `"creature"` when it named none. */
  element: string;
  /** What was done about it, in words. */
  action: string;
  /** UUID of the neuron the rule named, when it named one. */
  neuronUuid?: string;
}

/** `rule → element → action`, the one line the audit trail is made of. */
export function describeRepairAction(action: RepairAction): string {
  return `${action.rule} → ${action.element} → ${action.action}`;
}

/** The neuron a failure named, if the index it carried still points at one. */
function namedNeuron(
  creature: Creature,
  error: ValidationError,
): { indx: number; label: string; uuid?: string } | null {
  const indx = error.neuronIndex;
  if (indx === undefined || indx < 0 || indx >= creature.neurons.length) {
    return null;
  }
  const neuron = creature.neurons[indx];
  return {
    indx,
    label: neuronWireLabelForDiagnostics(neuron, indx),
    uuid: neuron.uuid,
  };
}

/**
 * Repair the one element the failure named.
 *
 * The creature is edited in place. Callers must re-validate afterwards rather
 * than assuming the creature is now whole: a removal can strand the neurons
 * downstream of it, and each of those is its own rule failure naming its own
 * element on the next round.
 *
 * @param creature - The creature to repair, edited in place.
 * @param error - The failure `creatureValidate` raised.
 * @returns What was done, or `null` when this rule has no targeted repair.
 */
export function applyTargetedRepair(
  creature: Creature,
  error: ValidationError,
): RepairAction | null {
  const named = namedNeuron(creature, error);

  switch (error.reason) {
    case "NO_OUTWARD_CONNECTIONS": {
      // A hidden or constant neuron nothing reads. It contributes to no output,
      // so removing it is exact; `removeHiddenNeuron` cascades to any feeder it
      // strands, which is the same rule failing one step upstream.
      if (!named) return null;
      const type = creature.neurons[named.indx].type;
      if (type !== "hidden" && type !== "constant") return null;
      removeHiddenNeuron(creature, named.indx);
      return {
        rule: error.reason,
        element: named.label,
        neuronUuid: named.uuid,
        action: `removed the ${type} neuron nothing reads`,
      };
    }

    case "NO_INWARD_CONNECTIONS": {
      // A hidden neuron nothing writes to. Its activation is a function of its
      // bias alone, so it is rewritten as the constant it already is — the same
      // in-place conversion `SubConnection` uses, which keeps the *same neuron
      // object* and therefore the same uuid. An output neuron cannot be
      // rewritten this way and is declined rather than guessed at.
      if (!named) return null;
      const neuron = creature.neurons[named.indx];
      if (neuron.type !== "hidden") return null;

      if (creature.outwardConnections(named.indx).length === 0) {
        removeHiddenNeuron(creature, named.indx);
        return {
          rule: error.reason,
          element: named.label,
          neuronUuid: named.uuid,
          action: "removed the hidden neuron nothing writes to or reads from",
        };
      }

      const activation = neuron.findSquash() as ActivationInterface;
      if (activation.squash) neuron.bias = activation.squash(neuron.bias);
      neuron.type = "constant";
      neuron.setSquash(undefined);
      moveConstantNeuronIntoPrefix(creature, named.indx);
      shedIdentity(creature);
      delete creature.memetic;
      creature.clearCache();
      return {
        rule: error.reason,
        element: named.label,
        neuronUuid: named.uuid,
        action: "rewrote the inbound-less hidden neuron as the constant it is",
      };
    }

    case "SELF_CONNECTION": {
      const removed = removeSynapses(
        creature,
        (from, to) => from === to && (named === null || to === named.indx),
      );
      if (removed === 0) return null;
      return {
        rule: error.reason,
        element: named?.label ?? "creature",
        neuronUuid: named?.uuid,
        action: `removed ${removed} self connection(s)`,
      };
    }

    case "RECURSIVE_SYNAPSE": {
      const removed = removeSynapses(
        creature,
        (from, to) => from > to && (named === null || to === named.indx),
      );
      if (removed === 0) return null;
      return {
        rule: error.reason,
        element: named?.label ?? "creature",
        neuronUuid: named?.uuid,
        action: `removed ${removed} backward synapse(s)`,
      };
    }

    case "IF_CONDITIONS": {
      // The one repair that may touch role-typed structure, and only because
      // the rule named this `IF` as the thing that is broken.
      if (!named) return null;
      if (!repairInvalidIfNeuron(creature, named.indx)) return null;
      return {
        rule: error.reason,
        element: named.label,
        neuronUuid: named.uuid,
        action:
          "downgraded the incomplete IF to IDENTITY and stripped its branch roles",
      };
    }

    case "MEMETIC": {
      pruneOrphanMemeticReferences(creature);
      return {
        rule: error.reason,
        element: named?.label ?? "creature",
        neuronUuid: named?.uuid,
        action: "pruned memetic references to elements that no longer exist",
      };
    }

    default:
      return null;
  }
}

/**
 * Drop every synapse matching `doomed`, keeping the array sorted and shedding
 * the caches and content-derived identity the edit invalidates.
 *
 * `connect`/`disconnect` deliberately do not clear `creature.uuid` (see
 * AGENTS.md), so an edit made here has to shed identity itself.
 *
 * @returns How many synapses were removed.
 */
function removeSynapses(
  creature: Creature,
  doomed: (from: number, to: number) => boolean,
): number {
  const kept = creature.synapses.filter((s) => !doomed(s.from, s.to));
  const removed = creature.synapses.length - kept.length;
  if (removed === 0) return 0;

  creature.synapses = kept;
  shedIdentity(creature);
  delete creature.memetic;
  creature.clearCache();
  return removed;
}
