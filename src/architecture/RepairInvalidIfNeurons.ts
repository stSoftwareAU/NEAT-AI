/**
 * IF neurons require three inward roles (condition / positive / negative).
 * Forward-only strip, duplicate merge, or connection removal can leave IF
 * structurally invalid. Downgrade to IDENTITY and strip synapse roles so the
 * graph validates and training/breeding can proceed (Issue: worker IF_CONDITIONS
 * after recurrent strip).
 */

import type { Creature } from "@creature";

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
 * Downgrade the single `IF` neuron at `indx`, when that one neuron is the one
 * breaking the rule (Issue #3848).
 *
 * The whole-creature sweep below scans for every offender; a rule-driven repair
 * already knows which neuron `IF_CONDITIONS` named and must change only that
 * one. Both share this body so the two paths cannot drift apart.
 *
 * @returns true when the named neuron was an invalid `IF` and was downgraded.
 */
export function repairInvalidIfNeuron(
  creature: Creature,
  indx: number,
): boolean {
  if (indx < 0 || indx >= creature.neurons.length) return false;
  if (!ifNeuronStructurallyInvalid(creature, indx)) return false;

  creature.neurons[indx].setSquash("IDENTITY");
  for (const syn of creature.inwardConnections(indx)) {
    if (syn.type) delete syn.type;
  }
  shedIdentity(creature);
  return true;
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
    shedIdentity(creature);
  }
  return changed;
}

/** Drop the caches and the content-derived identity the downgrade invalidated. */
function shedIdentity(creature: Creature): void {
  // Issue #3843: the repair rewrites a neuron's squash to IDENTITY and strips
  // synapse `type` roles — both are inputs to the creature hash, so the
  // content-derived identity no longer describes the creature. `clearCache()`
  // below invalidates the topology caches but deliberately never touches
  // `uuid`, and `Neuron.setSquash` does not compensate. Shedding it here
  // covers every caller, including the `Upgrade.validateFourX` IF-repair
  // branch that returns without the `fix()` the other three rely on.
  delete creature.uuid;
  delete creature.memetic;
  creature.clearCache();
}
