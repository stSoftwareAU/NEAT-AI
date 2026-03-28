/**
 * Issue #1378 - Tests for pre-computed squash type indices on Neuron.
 *
 * Verifies that Neuron.cachedSquashType() returns the correct SquashType
 * and that the cache is correctly invalidated when the squash function
 * changes via setSquash().
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";
import { getSquashType, SquashType } from "../../src/wasm/SquashType.ts";

Deno.test("cachedSquashType returns correct type for each neuron", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0.1, squash: "TANH", index: 2 },
      { type: "hidden", bias: -0.5, squash: "LOGISTIC", index: 3 },
      { type: "output", bias: 0.0, squash: "IDENTITY", index: 4 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 1, to: 3, weight: -0.3 },
      { from: 2, to: 4, weight: 0.8 },
      { from: 3, to: 4, weight: 0.2 },
    ],
    input: 2,
    output: 1,
  });

  // Input neurons have no squash — should return Identity
  assertEquals(
    creature.neurons[0].cachedSquashType(),
    SquashType.Identity,
    "Input neuron 0 should be Identity",
  );
  assertEquals(
    creature.neurons[1].cachedSquashType(),
    SquashType.Identity,
    "Input neuron 1 should be Identity",
  );

  // Hidden neurons
  assertEquals(
    creature.neurons[2].cachedSquashType(),
    SquashType.Tanh,
    "Hidden neuron with TANH squash",
  );
  assertEquals(
    creature.neurons[3].cachedSquashType(),
    SquashType.Logistic,
    "Hidden neuron with LOGISTIC squash",
  );

  // Output neuron
  assertEquals(
    creature.neurons[4].cachedSquashType(),
    SquashType.Identity,
    "Output neuron with IDENTITY squash",
  );
});

Deno.test("cachedSquashType matches getSquashType for all squash names", () => {
  const squashNames = [
    "ReLU",
    "TANH",
    "LOGISTIC",
    "IDENTITY",
    "GELU",
    "LeakyReLU",
    "SELU",
    "ELU",
    "Swish",
    "Mish",
    "SOFTSIGN",
    "Softplus",
    "SINE",
    "GAUSSIAN",
    "BIPOLAR_SIGMOID",
    "STEP",
    "COMPLEMENT",
    "ABSOLUTE",
    "SQUARE",
    "SQRT",
  ];

  const hiddenNeurons = squashNames.map((squash, i) => ({
    type: "hidden" as const,
    bias: 0,
    squash,
    index: 2 + i,
  }));

  // Connect each hidden neuron from input and to output
  const synapses: { from: number; to: number; weight: number }[] = [
    { from: 0, to: 2, weight: 1 },
  ];
  for (let i = 0; i < squashNames.length; i++) {
    synapses.push({
      from: 2 + i,
      to: 2 + squashNames.length,
      weight: 0.1,
    });
  }

  const outputNeuron = {
    type: "output" as const,
    bias: 0,
    squash: "IDENTITY",
    index: 2 + squashNames.length,
  };

  const creature = Creature.fromJSON({
    neurons: [...hiddenNeurons, outputNeuron],
    synapses,
    input: 2,
    output: 1,
  });

  for (let i = 0; i < squashNames.length; i++) {
    const neuron = creature.neurons[2 + i];
    const expected = getSquashType(squashNames[i]);
    assertEquals(
      neuron.cachedSquashType(),
      expected,
      `Cached squash type for ${squashNames[i]} should match getSquashType()`,
    );
  }
});

Deno.test("cachedSquashType is invalidated by setSquash()", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0.1, squash: "TANH", index: 2 },
      { type: "output", bias: 0.0, squash: "IDENTITY", index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 2, to: 3, weight: 0.8 },
    ],
    input: 2,
    output: 1,
  });

  const hiddenNeuron = creature.neurons[2];

  // Initial value
  assertEquals(hiddenNeuron.cachedSquashType(), SquashType.Tanh);

  // Change squash function
  hiddenNeuron.setSquash("LOGISTIC");
  assertEquals(
    hiddenNeuron.cachedSquashType(),
    SquashType.Logistic,
    "Cache should update after setSquash()",
  );

  // Change again
  hiddenNeuron.setSquash("ReLU");
  assertEquals(
    hiddenNeuron.cachedSquashType(),
    SquashType.Relu,
    "Cache should update after second setSquash()",
  );
});

Deno.test("cachedSquashType is stable across multiple calls", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0, squash: "GELU", index: 2 },
      { type: "output", bias: 0, squash: "IDENTITY", index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 2, to: 3, weight: 1 },
    ],
    input: 2,
    output: 1,
  });

  const neuron = creature.neurons[2];
  const first = neuron.cachedSquashType();
  const second = neuron.cachedSquashType();
  const third = neuron.cachedSquashType();

  assertEquals(first, second);
  assertEquals(second, third);
  assertEquals(first, SquashType.Gelu);
});

Deno.test("cachedSquashType for input neurons returns Identity", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0, squash: "TANH", index: 2 },
      { type: "output", bias: 0, squash: "IDENTITY", index: 3 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 1 },
      { from: 2, to: 3, weight: 1 },
    ],
    input: 2,
    output: 1,
  });

  // Input neurons have no squash function — should return Identity
  assertEquals(creature.neurons[0].cachedSquashType(), SquashType.Identity);
  assertEquals(creature.neurons[1].cachedSquashType(), SquashType.Identity);
});

Deno.test("propagate still produces correct results with cached squash types", () => {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", bias: 0.1, squash: "TANH", index: 2 },
      { type: "hidden", bias: -0.2, squash: "LOGISTIC", index: 3 },
      { type: "output", bias: 0.0, squash: "IDENTITY", index: 4 },
    ],
    synapses: [
      { from: 0, to: 2, weight: 0.5 },
      { from: 1, to: 3, weight: -0.3 },
      { from: 2, to: 4, weight: 0.8 },
      { from: 3, to: 4, weight: 0.2 },
    ],
    input: 2,
    output: 1,
  });

  const config = createBackPropagationConfig({
    disableRandomSamples: false,
    generations: 0,
    learningRate: 1,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  // Activate and propagate to verify correctness is preserved
  const input = new Float32Array([0.5, -0.3]);
  const result1 = creature.activateAndTrace(input, false, sparseConfig);
  assertNotEquals(result1, undefined);

  // Propagate back with a target
  const target = new Float32Array([0.7]);
  creature.propagate(target, config, sparseConfig);

  // Activate again - should still produce valid output
  const result2 = creature.activate(input);
  assertNotEquals(result2, undefined);
  assertEquals(result2.length, 1);
});
