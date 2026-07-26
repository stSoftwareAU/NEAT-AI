/**
 * Issue #3472 — Cost of the per-creature diagnostic `shallowClone()` that
 * `Mutator.mutate()` used to take unconditionally on the happy path.
 *
 * `mutate()` runs once per generation on the **main thread** over the whole
 * new population. Before this change every creature that passed the mutation
 * gate was deep-cloned purely to seed the producer-gate diagnostic dump — an
 * O(neurons+synapses) allocation consumed **only** on the rare compile-failure
 * path. At production scale (~1,500 neurons, ~20,000 synapses — see
 * `CreatureUtils.ts`) that is ~1,500 fresh `Neuron` allocations plus ~19,000
 * synapse copies per mutated creature, per generation.
 *
 * This benchmark isolates that eliminated clone: `Creature.shallowClone()` at
 * production scale is exactly the main-thread work and allocation the happy
 * path no longer performs (no score, MCMC off, `DEBUG` off). Multiply the
 * per-creature figure by the population size for the per-generation saving.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/MutatorDiagnosticClone.ts
 */
import { Creature } from "@creature";

/**
 * Build a sparse, production-scale creature (~1,500 neurons / ~19k synapses).
 * A deep chain of small fully-connected layers keeps the neuron/synapse ratio
 * near an evolved network's (~13 synapses per neuron) rather than the dense
 * quadratic blow-up of a few wide layers.
 */
function buildProductionScaleCreature(): Creature {
  const layers = [];
  for (let i = 0; i < 113; i++) layers.push({ count: 13 });
  return new Creature(13, 3, { layers });
}

const creature = buildProductionScaleCreature();

console.log("=== Production-scale creature ===");
console.log(
  `neurons=${creature.neurons.length} synapses=${creature.synapses.length}`,
);

// The per-creature clone eliminated from the happy path of Mutator.mutate().
Deno.bench({
  name:
    "diagnostic shallowClone (production scale ~1500 neurons / ~19k synapses)",
  fn() {
    const clone = creature.shallowClone();
    if (clone.neurons.length === 0) throw new Error("Empty clone");
  },
});
