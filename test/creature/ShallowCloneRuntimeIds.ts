/**
 * Verify shallowClone() preserves all state that exportJSONWithRuntimeIds +
 * fromJSON preserves, making it a safe replacement in CreatureTraining.ts.
 *
 * Issue #2276: Eliminate JSON round-trip in evolveDir bestCreature tracking.
 *
 * The old pattern:
 *   bestCreature = CreatureClass.fromJSON(exportJSONWithRuntimeIds(fittest));
 *   bestCreature.uuid = fittest.uuid;
 *   bestCreature.score = bestScore;
 *
 * The new pattern:
 *   bestCreature = fittest.shallowClone();
 *   bestCreature.score = bestScore;
 *
 * This test confirms the two approaches produce functionally equivalent
 * creatures with matching neuron UUIDs, runtime IDs, synapse structure,
 * activation outputs, tags, and score.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test(
  "shallowClone preserves runtime IDs equivalent to exportJSONWithRuntimeIds",
  () => {
    const original = new Creature(5, 3, {
      layers: [{ count: 10, squash: "LOGISTIC" }],
    });
    original.uuid = "runtime-id-preservation-test";
    original.score = 0.92;
    addTag(original, "error", "0.08");
    addTag(original, "approach", "trained");
    creatureValidate(original);

    // Old pattern: exportJSONWithRuntimeIds + fromJSON
    const jsonClone = Creature.fromJSON(exportJSONWithRuntimeIds(original));
    jsonClone.uuid = original.uuid;
    jsonClone.score = original.score;

    // New pattern: shallowClone
    const shallowCloneResult = original.shallowClone();
    shallowCloneResult.score = original.score;

    // Verify both clones have the same uuid
    assertEquals(
      shallowCloneResult.uuid,
      jsonClone.uuid,
      "UUID should match between shallowClone and JSON clone",
    );

    // Verify both clones have the same score
    assertEquals(
      shallowCloneResult.score,
      jsonClone.score,
      "Score should match between shallowClone and JSON clone",
    );

    // Verify neuron runtime IDs match
    assertEquals(
      shallowCloneResult.neurons.length,
      jsonClone.neurons.length,
      "Neuron count should match",
    );
    for (let i = 0; i < shallowCloneResult.neurons.length; i++) {
      assertEquals(
        shallowCloneResult.neurons[i].id,
        jsonClone.neurons[i].id,
        `Neuron ${i} runtime ID should match`,
      );
      assertEquals(
        shallowCloneResult.neurons[i].type,
        jsonClone.neurons[i].type,
        `Neuron ${i} type should match`,
      );
      if (shallowCloneResult.neurons[i].type !== "input") {
        assertEquals(
          shallowCloneResult.neurons[i].bias,
          jsonClone.neurons[i].bias,
          `Neuron ${i} bias should match`,
        );
        assertEquals(
          shallowCloneResult.neurons[i].squash,
          jsonClone.neurons[i].squash,
          `Neuron ${i} squash should match`,
        );
      }
    }

    // Verify neuron UUIDs match for hidden neurons
    for (let i = original.input; i < shallowCloneResult.neurons.length; i++) {
      const shallowNeuron = shallowCloneResult.neurons[i];
      const jsonNeuron = jsonClone.neurons[i];
      if (
        shallowNeuron.type === "hidden" || shallowNeuron.type === "constant"
      ) {
        assertEquals(
          shallowNeuron.uuid,
          jsonNeuron.uuid,
          `Neuron ${i} UUID should match`,
        );
      }
    }

    // Verify synapse structure matches
    assertEquals(
      shallowCloneResult.synapses.length,
      jsonClone.synapses.length,
      "Synapse count should match",
    );
    for (let i = 0; i < shallowCloneResult.synapses.length; i++) {
      assertEquals(
        shallowCloneResult.synapses[i].from,
        jsonClone.synapses[i].from,
        `Synapse ${i} from should match`,
      );
      assertEquals(
        shallowCloneResult.synapses[i].to,
        jsonClone.synapses[i].to,
        `Synapse ${i} to should match`,
      );
      assertEquals(
        shallowCloneResult.synapses[i].weight,
        jsonClone.synapses[i].weight,
        `Synapse ${i} weight should match`,
      );
    }

    // Verify tags are preserved
    assertEquals(
      getTag(shallowCloneResult, "error"),
      getTag(jsonClone, "error"),
      "Error tag should match",
    );

    // Verify activation outputs match
    const input = new Float32Array([0.1, 0.5, 0.9, 0.3, 0.7]);
    shallowCloneResult.clearState();
    jsonClone.clearState();
    const shallowOutput = shallowCloneResult.activate(input);
    const jsonOutput = jsonClone.activate(input);

    for (let j = 0; j < shallowOutput.length; j++) {
      assertAlmostEquals(
        shallowOutput[j],
        jsonOutput[j],
        1e-10,
        `Output mismatch at index ${j}`,
      );
    }
  },
);

Deno.test(
  "shallowClone preserves runtime IDs for multi-layer creature",
  () => {
    const original = new Creature(10, 5, {
      layers: [
        { count: 20, squash: "LOGISTIC" },
        { count: 10, squash: "TANH" },
      ],
    });
    original.uuid = "multi-layer-runtime-ids";
    original.score = 0.75;
    addTag(original, "error", "0.25");
    creatureValidate(original);

    // Old pattern
    const jsonClone = Creature.fromJSON(exportJSONWithRuntimeIds(original));
    jsonClone.uuid = original.uuid;
    jsonClone.score = original.score;

    // New pattern
    const shallowCloneResult = original.shallowClone();
    shallowCloneResult.score = original.score;

    // Verify all neuron runtime IDs match
    for (let i = 0; i < shallowCloneResult.neurons.length; i++) {
      assertEquals(
        shallowCloneResult.neurons[i].id,
        jsonClone.neurons[i].id,
        `Neuron ${i} runtime ID mismatch in multi-layer creature`,
      );
    }

    // Verify all synapse from/to runtime IDs match
    for (let i = 0; i < shallowCloneResult.synapses.length; i++) {
      assertEquals(
        shallowCloneResult.synapses[i].from,
        jsonClone.synapses[i].from,
        `Synapse ${i} from ID mismatch`,
      );
      assertEquals(
        shallowCloneResult.synapses[i].to,
        jsonClone.synapses[i].to,
        `Synapse ${i} to ID mismatch`,
      );
    }

    // Verify activation equivalence with multiple inputs
    for (let trial = 0; trial < 5; trial++) {
      const input = new Float32Array(10);
      for (let j = 0; j < 10; j++) {
        input[j] = Math.random();
      }
      shallowCloneResult.clearState();
      jsonClone.clearState();
      const shallowOutput = shallowCloneResult.activate(input);
      const jsonOutput = jsonClone.activate(input);

      for (let j = 0; j < shallowOutput.length; j++) {
        assertAlmostEquals(
          shallowOutput[j],
          jsonOutput[j],
          1e-10,
          `Multi-layer output mismatch at trial ${trial}, index ${j}`,
        );
      }
    }
  },
);

Deno.test("shallowClone preserves semantic version and forwardOnly", () => {
  const original = new Creature(3, 2, {
    layers: [{ count: 5 }],
  });
  original.uuid = "version-fwd-test";
  original.score = 0.9;
  original.forwardOnly = true;
  creatureValidate(original);

  // Old pattern
  const jsonClone = Creature.fromJSON(exportJSONWithRuntimeIds(original));
  jsonClone.uuid = original.uuid;
  jsonClone.score = original.score;

  // New pattern
  const shallowCloneResult = original.shallowClone();
  shallowCloneResult.score = original.score;

  assertEquals(
    shallowCloneResult.semanticVersion,
    jsonClone.semanticVersion,
    "Semantic version should match",
  );

  assertEquals(
    shallowCloneResult.forwardOnly,
    jsonClone.forwardOnly,
    "forwardOnly flag should match",
  );
});
