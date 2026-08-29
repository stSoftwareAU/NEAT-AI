import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../../mod.ts";
import type { Approach } from "@neat/LogApproach.ts";
import { CreatureExportBuilder } from "@utils/CreatureExportBuilder.ts";
import { pruneOrphanMemeticReferences } from "@compact/MemeticCleanup.ts";
import {
  recordScoreWithoutCorpus,
  shedScore,
} from "@architecture/ScoreProvenance.ts";

/**
 * Restores a creature from its memetic source data.
 *
 * This function takes a creature that has been modified through memetic learning
 * and restores it to a state based on the original memetic data. It applies
 * the stored biases and weights from the memetic interface to create a new
 * creature instance.
 *
 * The restore is a **structural change**: a weight the record names but the
 * live creature has lost is re-added as a synapse. The returned creature still
 * carries the memetic record, pruned of any reference that no longer resolves
 * (Issue #3844) — including `ancestry[]` snapshots, which nothing else checks.
 *
 * @param creature - The creature to restore from memetic data
 * @returns A new creature instance with restored memetic data, or undefined if no memetic data exists
 * @throws {Error} When memetic data references non-existent neurons
 *
 * @example
 * ```ts
 * const restoredCreature = restoreSource(creature);
 * if (restoredCreature) {
 *   getLogger().info("Creature restored from memetic data");
 * }
 * ```
 */
export function restoreSource(creature: Creature): Creature | undefined {
  if (!creature.memetic) return;

  const restoredCreature = new CreatureExportBuilder(creature).build(true);
  const memetic = creature.memetic;
  const idToWire = new Map<number, string>();

  for (let i = 0; i < creature.input; i++) {
    idToWire.set(i, `input-${i}`);
  }
  let outputIndex = 0;
  creature.neurons.forEach((neuron) => {
    if (neuron.type === "input") return;
    if (neuron.type === "output") {
      idToWire.set(neuron.id, `output-${outputIndex}`);
      outputIndex++;
      return;
    }
    idToWire.set(neuron.id, neuron.uuid ?? `legacy-neuron-${neuron.id}`);
  });

  // Restore biases from memetic
  for (const neuronId in memetic.biases) {
    const bias = memetic.biases[neuronId];
    const neuronUuid = idToWire.get(Number(neuronId));
    if (!neuronUuid) {
      return undefined;
    }
    const neuron = restoredCreature.neurons.find((n) => n.uuid === neuronUuid);
    if (!neuron) {
      return undefined;
    }
    neuron.bias = bias;
  }

  // Restore weights from memetic
  for (const fromId in memetic.weights) {
    const weightArray = memetic.weights[fromId];
    const fromUUID = idToWire.get(Number(fromId));
    if (!fromUUID) {
      return undefined;
    }
    for (const weightObj of weightArray) {
      const toUUID = idToWire.get(weightObj.toId);
      if (!toUUID) {
        return undefined;
      }
      const matches = restoredCreature.synapses.filter((s) =>
        s.fromUUID === fromUUID && s.toUUID === toUUID
      );
      if (matches.length > 1) {
        // Issue #3873: one source may feed an `IF` neuron once per role, but
        // the memetic record names only `(fromId, toId)`. Restoring one of the
        // roles at random would quietly change what the creature computes.
        return undefined;
      }
      let synapse = matches[0];
      assert(Number.isFinite(weightObj.weight), "weight must be a number");
      if (!synapse) {
        synapse = {
          fromUUID,
          toUUID,
          weight: weightObj.weight,
        };
        restoredCreature.synapses.push(synapse);
      } else {
        synapse.weight = weightObj.weight;
      }
    }
  }
  addTag(restoredCreature, "restored", memetic.generation.toString());
  addTag(restoredCreature, "approach", "fine" as Approach);
  addTag(restoredCreature, "approach-logged", "fine" as Approach);

  // GRQ #4537: the weight loop above rewrote the creature, so whatever score
  // rode in on the export describes something else now. Shed it first; the
  // memetic record's own score is then the only claim that can survive, and it
  // names no corpus.
  shedScore(restoredCreature);
  if (!creature.score || memetic.score < creature.score) {
    recordScoreWithoutCorpus(restoredCreature, memetic.score);
  }

  const realCreature = Creature.fromJSON(restoredCreature);

  // Issue #3844: the restore is a structural change — the weight loop above
  // re-adds synapses the record names but the live creature had lost — and the
  // whole memetic record rides along onto the restored creature. The two loops
  // above bail out the moment a *top-level* key fails to resolve, but nothing
  // checks `ancestry[]`, and `memeticUpdate` propagates that subtree to
  // offspring by reference without ever touching it. An ancestor snapshot
  // therefore routinely outlives the neurons it was keyed to.
  //
  // A stale key of that kind is not harmless: `convertMapKeys` copies a runtime
  // integer through as "already a numeric key" and `canonicalBiases` writes it
  // to the wire verbatim, where the Rust reader fails loud on a neuron uuid the
  // creature does not have.
  //
  // Prune rather than `delete realCreature.memetic`: every reference the
  // restore itself established is valid by construction, and the surviving
  // neurons' deltas are exactly the fine-tuning history this function exists to
  // carry forward. Only the keys that resolve to nothing are dropped, ancestry
  // included.
  pruneOrphanMemeticReferences(realCreature);

  realCreature.score = memetic.score;
  return realCreature;
}
