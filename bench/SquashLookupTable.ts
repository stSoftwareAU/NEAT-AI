/**
 * Benchmark for squash lookup table optimisation (Issue #1017).
 *
 * Acceptance criteria from the issue:
 * "Once the JS function is generated for a creature. We call creature activate
 * for the whole training set (a million rows or so) for a creature of 2000
 * observations, 700 hidden neurons and 18000 synapses. The scoring phase MUST
 * be faster."
 *
 * This benchmark creates a creature matching these specifications and measures
 * activation performance.
 *
 * Run with: deno bench --allow-read bench/SquashLookupTable.ts
 */
import { Creature } from "../src/Creature.ts";

// Configuration matching acceptance criteria
const INPUT_COUNT = 2000; // 2000 observations
const HIDDEN_COUNT = 700; // 700 hidden neurons
const OUTPUT_COUNT = 5; // Output neurons
const SYNAPSE_DENSITY = 25; // Average synapses per neuron to achieve ~18000 total

// Non-inline squash functions to test the lookup table
const NON_INLINE_SQUASHES = [
  "SELU",
  "ELU",
  "GELU",
  "Swish",
  "Mish",
  "LOGISTIC",
  "LeakyReLU",
  "Softplus",
  "BENT_IDENTITY",
  "SOFTSIGN",
  "GAUSSIAN",
  "BIPOLAR_SIGMOID",
];

// Inline squash functions for comparison
const INLINE_SQUASHES = [
  "TANH",
  "IDENTITY",
  "ReLU",
  "ABSOLUTE",
  "SINE",
  "STEP",
];

/**
 * Create a large creature with mixed squash functions.
 */
function createLargeCreature(useNonInlineSquashes: boolean): Creature {
  const squashes = useNonInlineSquashes ? NON_INLINE_SQUASHES : INLINE_SQUASHES;

  const neurons: {
    bias: number;
    type: "hidden" | "output";
    squash: string;
    index: number;
  }[] = [];
  const synapses: { weight: number; from: number; to: number }[] = [];

  // Add hidden neurons with mixed squash functions
  for (let i = 0; i < HIDDEN_COUNT; i++) {
    neurons.push({
      bias: (Math.random() - 0.5) * 2,
      type: "hidden",
      squash: squashes[i % squashes.length],
      index: INPUT_COUNT + i,
    });
  }

  // Add output neurons
  for (let i = 0; i < OUTPUT_COUNT; i++) {
    neurons.push({
      bias: (Math.random() - 0.5) * 2,
      type: "output",
      squash: "IDENTITY",
      index: INPUT_COUNT + HIDDEN_COUNT + i,
    });
  }

  // Create synapses - aim for ~18000 total
  // Input to hidden connections
  for (let h = 0; h < HIDDEN_COUNT; h++) {
    // Each hidden neuron connects to ~25 input neurons (randomly selected)
    const inputConnections = Math.min(SYNAPSE_DENSITY, INPUT_COUNT);
    const selectedInputs = new Set<number>();
    while (selectedInputs.size < inputConnections) {
      selectedInputs.add(Math.floor(Math.random() * INPUT_COUNT));
    }
    for (const inputIdx of selectedInputs) {
      synapses.push({
        weight: (Math.random() - 0.5) * 2,
        from: inputIdx,
        to: INPUT_COUNT + h,
      });
    }
  }

  // Hidden to output connections
  for (let o = 0; o < OUTPUT_COUNT; o++) {
    for (let h = 0; h < HIDDEN_COUNT; h++) {
      synapses.push({
        weight: (Math.random() - 0.5) * 2,
        from: INPUT_COUNT + h,
        to: INPUT_COUNT + HIDDEN_COUNT + o,
      });
    }
  }

  console.log(
    `Created creature with ${INPUT_COUNT} inputs, ${HIDDEN_COUNT} hidden, ` +
      `${OUTPUT_COUNT} outputs, ${synapses.length} synapses`,
  );

  return Creature.fromJSON({
    neurons,
    synapses,
    input: INPUT_COUNT,
    output: OUTPUT_COUNT,
  });
}

/**
 * Generate input data.
 */
function generateInputs(count: number, inputSize: number): Float32Array[] {
  const inputs: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const input = new Float32Array(inputSize);
    for (let j = 0; j < inputSize; j++) {
      input[j] = Math.random() * 4 - 2;
    }
    inputs.push(input);
  }
  return inputs;
}

// Create creatures and inputs for benchmarking
const creatureNonInline = createLargeCreature(true);
creatureNonInline.validate();

const creatureInline = createLargeCreature(false);
creatureInline.validate();

const inputs = generateInputs(100, INPUT_COUNT);

// Warm up both creatures
for (const input of inputs) {
  creatureNonInline.activate(input);
  creatureInline.activate(input);
}

/**
 * Benchmark non-inline squash functions (uses lookup table or bound parameters).
 * This is the main benchmark for issue #1017.
 */
Deno.bench(
  "Activate with non-inline squashes (700 hidden, 18k synapses)",
  { group: "squash-comparison" },
  () => {
    for (let i = 0; i < 10; i++) {
      const input = inputs[i % inputs.length];
      creatureNonInline.activate(input);
    }
  },
);

/**
 * Benchmark inline squash functions for comparison.
 */
Deno.bench(
  "Activate with inline squashes (700 hidden, 18k synapses)",
  { group: "squash-comparison", baseline: true },
  () => {
    for (let i = 0; i < 10; i++) {
      const input = inputs[i % inputs.length];
      creatureInline.activate(input);
    }
  },
);

// Also test with the existing traced.json creature for comparison
const tracedCreature = Creature.fromJSON(
  JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
);
tracedCreature.fix();
tracedCreature.clearState();

const tracedInputs = generateInputs(100, tracedCreature.input);

// Warm up
for (const input of tracedInputs) {
  tracedCreature.activate(input);
}

Deno.bench("Activate traced.json creature (mixed squashes)", () => {
  for (let i = 0; i < 100; i++) {
    const input = tracedInputs[i % tracedInputs.length];
    tracedCreature.activate(input);
  }
});
