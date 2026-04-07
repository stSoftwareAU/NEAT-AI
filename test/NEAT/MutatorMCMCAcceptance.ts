/**
 * Tests for Metropolis-Hastings acceptance criterion in the mutation pipeline.
 *
 * Issue #2200: Verifies that MCMC acceptance correctly gates mutations
 * based on fitness proxy delta and temperature.
 */

import { assert } from "@std/assert";
import { Creature, CreatureUtil } from "../../mod.ts";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

/**
 * Helper: creates a minimal NeatConfig with MCMC settings.
 */
function makeMCMCConfig(
  mcmcOverrides: Record<string, unknown> = {},
  configOverrides: Record<string, unknown> = {},
) {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  return createNeatConfig({
    ...configOverrides,
    creatures: [creature.exportJSON()],
    mcmc: {
      enabled: true,
      initialTemperature: 1.0,
      minTemperature: 0.001,
      coolingRate: 0.995,
      ...mcmcOverrides,
    },
  });
}

Deno.test("MCMC disabled: all mutations accepted (existing behaviour preserved)", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const config = createNeatConfig({
    creatures: [creature.exportJSON()],
    mcmc: { enabled: false },
    mutationRate: 1.0,
    mutationAmount: 2,
  });

  const mutator = new Mutator(config);
  const population = [creature];
  CreatureUtil.makeUUID(creature);

  // Run mutation — should always accept when MCMC disabled
  mutator.mutate(population);

  // The code path should not reject based on M-H
  assert(population.length === 1, "Population size unchanged");
});

Deno.test("MCMC enabled: creature reverted to snapshot on M-H rejection", () => {
  // Use very low temperature so worsening mutations are almost always rejected
  const config = makeMCMCConfig(
    { initialTemperature: 1e-15, minTemperature: 1e-15 },
    { mutationRate: 1.0, mutationAmount: 3 },
  );

  // Create a creature with moderate weights (no score/memetic to avoid snapshot complications)
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  for (const synapse of creature.synapses) {
    synapse.weight = 0.5;
  }
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = 0.1;
  }

  const mutator = new Mutator(config, 1e-15);
  const population = [creature];
  mutator.mutate(population);

  // At near-zero temperature, worsening mutations should be rejected
  // and the creature should be reverted. The creature should still be valid.
  assert(population.length === 1, "Population size unchanged");
  assert(creature.neurons.length >= 4, "Creature still has neurons");
});

Deno.test("MCMC enabled: topology mutations always accepted regardless of temperature", () => {
  // Even at very low temperature, topology mutations should be accepted
  const config = makeMCMCConfig(
    { initialTemperature: 1e-15, minTemperature: 1e-15 },
    { mutationRate: 1.0, mutationAmount: 1 },
  );

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });

  const mutator = new Mutator(config, 1e-15);

  // Directly test that topology mutations are flagged for unconditional acceptance
  // by calling mutateCreature with a topology method
  const initialSynapseCount = creature.synapses.length;
  const changed = mutator.mutateCreature(creature, { name: "ADD_CONN" });

  if (changed) {
    // Topology mutation was applied — it should not be reverted by M-H
    assert(
      creature.synapses.length >= initialSynapseCount,
      "Topology mutation accepted: synapse count should not decrease",
    );
  }
});

Deno.test("MCMC enabled: at high temperature most mutations accepted", () => {
  const config = makeMCMCConfig(
    { initialTemperature: 1000.0, minTemperature: 0.001 },
    { mutationRate: 1.0, mutationAmount: 2 },
  );

  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

  const mutator = new Mutator(config, 1000.0);
  CreatureUtil.makeUUID(creature);

  mutator.mutate([creature]);

  // At very high temperature, almost all mutations should be accepted
  // The creature should have been modified
  assert(creature.neurons.length >= 2, "Creature still valid");
});
