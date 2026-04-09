import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { simplify } from "@optimize/Simplify.ts";

/**
 * Issue #2233: simplify causing invalid Memetic.
 *
 * When simplify changes the creature structure (e.g. via simplifyConstants),
 * the memetic object may still reference synapses that no longer exist. This
 * causes a ValidationError: "Memetic from id X to id Y has no matching
 * synapses." The fix is to delete the memetic object from the export before
 * reconstructing the creature via Creature.fromJSON.
 */
Deno.test("simplify - memetic cleared when simplifyConstants removes a synapse (#2233)", () => {
  // A constant neuron feeds into a TANH hidden neuron (non-aggregate squash).
  // simplifyConstants will absorb the constant's contribution into the hidden
  // neuron's bias and remove the constant neuron and its synapse.
  // No IDENTITY neurons exist, so removeNeuron is NOT called.
  const json: CreatureExport = {
    neurons: [
      {
        bias: 2,
        type: "constant",
        uuid: "constant-0",
      },
      {
        bias: 0.5,
        type: "hidden",
        squash: "TANH",
        uuid: "hidden-0",
      },
      { bias: 0, type: "output", squash: "TANH", uuid: "output-0" },
    ],
    synapses: [
      { weight: 1, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: 0.5, fromUUID: "constant-0", toUUID: "hidden-0" },
      { weight: 1, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);

  // Find the constant and hidden neurons by uuid to get their runtime IDs.
  const constantNeuron = creature.neurons.find((n) => n.uuid === "constant-0");
  assert(constantNeuron, "constant-0 must exist");
  const hiddenNeuron = creature.neurons.find((n) => n.uuid === "hidden-0");
  assert(hiddenNeuron, "hidden-0 must exist");

  // Attach a memetic object referencing the constant→hidden synapse.
  // After simplifyConstants absorbs the constant, this synapse will no longer
  // exist, making the memetic reference invalid.
  creature.memetic = {
    generation: 1,
    score: 0.5,
    weights: {
      [constantNeuron.id!]: [{ toId: hiddenNeuron.id!, weight: 0.3 }],
    },
    biases: {
      [hiddenNeuron.id!]: 0.1,
    },
  };

  // Before the fix, this would throw:
  // ValidationError: Memetic from id X to id Y has no matching synapses.
  const simplified = simplify(creature);

  assert(simplified, "Simplify should produce a simplified creature");

  // The memetic must be cleared since the structure changed.
  assertEquals(
    simplified.memetic,
    undefined,
    "Memetic should be cleared after simplify changes structure",
  );
});
