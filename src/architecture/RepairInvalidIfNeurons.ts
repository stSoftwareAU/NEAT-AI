/**
 * IF neurons require three inward roles (condition / positive / negative).
 * Forward-only strip, duplicate merge, or connection removal can leave IF
 * structurally invalid. Downgrade to IDENTITY and strip synapse roles so the
 * graph validates and training/breeding can proceed (Issue: worker IF_CONDITIONS
 * after recurrent strip).
 */

import type { Creature } from "@creature";
import { coalesceInwardDuplicates } from "@architecture/CoalesceInwardSynapses.ts";

import { shedIdentity } from "@architecture/ScoreProvenance.ts";
/**
 * Strip inward synapse roles on the neuron at `indx`, then coalesce any source
 * that fed it more than once.
 *
 * Issue #3873: an `IF` neuron sums each role separately, so one source may feed
 * it once per role. Every other squash sums them all together, so once the
 * roles are gone those rows are one synapse with the summed weight — leaving
 * them apart is a duplicate pair that `creatureValidate` rejects as
 * `duplicate synapse … -> …`.
 *
 * Called when a neuron *leaves* `IF`: `neuron.fix()` after `MOD_SQUASH`,
 * `downgradeToIdentity`, and `IF.fix` when it cannot keep the three roles.
 */
export function stripRolesAndCoalesceSources(
  creature: Creature,
  indx: number,
): void {
  let stripped = false;
  for (const syn of creature.inwardConnections(indx)) {
    if (syn.type) {
      delete syn.type;
      stripped = true;
    }
  }

  // Every inward row now carries the untyped role, so the run stays in
  // canonical order and only the merge below can need a re-sort — which
  // `coalesceInwardDuplicates` does for itself.
  const merged = coalesceInwardDuplicates(creature, indx);
  if (stripped && merged === 0) creature.clearCache();
}

/**
 * Downgrade one `IF` neuron to `IDENTITY`: strip the roles from its inward
 * synapses, then coalesce any source that fed it more than once.
 *
 * Issue #3873: an `IF` neuron sums each role separately, so one source may feed
 * it once per role. An `IDENTITY` neuron sums them all together, so once the
 * roles are gone those rows are one synapse with the summed weight — leaving
 * them apart would be a duplicate pair that `fix()` and `creatureValidate` both
 * reject, and the downgrade would have swapped one invalid creature for
 * another.
 */
function downgradeToIdentity(creature: Creature, indx: number): void {
  creature.neurons[indx].setSquash("IDENTITY");
  stripRolesAndCoalesceSources(creature, indx);
}

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

  downgradeToIdentity(creature, indx);
  shedIdentityAndCaches(creature);
  return true;
}

/**
 * @returns true if any neuron was repaired
 */
export function repairInvalidIfNeuronsInCreature(creature: Creature): boolean {
  let changed = false;
  for (let i = creature.input; i < creature.neurons.length; i++) {
    if (!ifNeuronStructurallyInvalid(creature, i)) continue;
    downgradeToIdentity(creature, i);
    // The coalesce above can drop rows, so the cached inward lists for the
    // neurons still to scan are stale.
    creature.clearCache();
    changed = true;
  }
  if (changed) {
    shedIdentityAndCaches(creature);
  }
  return changed;
}

/** Drop the caches and the content-derived identity the downgrade invalidated. */
function shedIdentityAndCaches(creature: Creature): void {
  // Issue #3843: the repair rewrites a neuron's squash to IDENTITY and strips
  // synapse `type` roles — both are inputs to the creature hash, so the
  // content-derived identity no longer describes the creature. `clearCache()`
  // below invalidates the topology caches but deliberately never touches
  // `uuid`, and `Neuron.setSquash` does not compensate. Shedding it here
  // covers every caller, including the `Upgrade.validateFourX` IF-repair
  // branch that returns without the `fix()` the other three rely on.
  shedIdentity(creature);
  delete creature.memetic;
  creature.clearCache();
}
