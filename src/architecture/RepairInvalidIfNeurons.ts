/**
 * IF neurons require three inward roles (condition / positive / negative).
 * Forward-only strip, duplicate merge, or connection removal can leave IF
 * structurally invalid. Downgrade to IDENTITY and strip synapse roles so the
 * graph validates and training/breeding can proceed (Issue: worker IF_CONDITIONS
 * after recurrent strip).
 */

import type { Creature } from "../Creature.ts";

function ifNeuronStructurallyInvalid(
  creature: Creature,
  indx: number,
): boolean {
  const neuron = creature.neurons[indx];
  if (neuron.squash !== "IF" || indx <= 2) return false;
  const inward = creature.inwardConnections(indx);
  if (inward.length < 3) return true;
  let foundPositive = false;
  let foundCondition = false;
  let foundNegative = false;
  for (const c of inward) {
    const synapseType = c.type ?? "positive";
    if (synapseType === "condition") foundCondition = true;
    else if (synapseType === "negative") foundNegative = true;
    else if (synapseType === "positive") foundPositive = true;
  }
  return !foundCondition || !foundPositive || !foundNegative;
}

/**
 * @returns true if any neuron was repaired
 */
export function repairInvalidIfNeuronsInCreature(creature: Creature): boolean {
  let changed = false;
  for (let i = creature.input; i < creature.neurons.length; i++) {
    if (!ifNeuronStructurallyInvalid(creature, i)) continue;
    const neuron = creature.neurons[i];
    const inward = creature.inwardConnections(i);
    neuron.setSquash("IDENTITY");
    for (const syn of inward) {
      if (syn.type) {
        delete syn.type;
      }
    }
    changed = true;
  }
  if (changed) {
    delete creature.memetic;
    creature.clearCache();
  }
  return changed;
}
