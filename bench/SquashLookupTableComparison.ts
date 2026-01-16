/**
 * Before/After comparison benchmark for squash lookup table (Issue #1017).
 *
 * This benchmark implements BOTH approaches in the same file to allow
 * direct comparison on the same hardware and runtime conditions.
 *
 * Run with: deno bench --allow-read bench/SquashLookupTableComparison.ts
 */
import type { Creature as CreatureType } from "../src/Creature.ts";
import { Creature } from "../src/Creature.ts";
import type { ActivationInterface } from "../src/methods/activations/ActivationInterface.ts";
import type { NeuronActivationInterface } from "../src/methods/activations/NeuronActivationInterface.ts";
import { ReLU } from "../src/methods/activations/types/ReLU.ts";
import type { InlineActivationInterface } from "../src/optimize/InlineActivationInterface.ts";
import type { InlineSquashInterface } from "../src/optimize/InlineSquashInterface.ts";
import { inlineActivation as inlineActivationOriginal } from "../src/optimize/MakeNeuronActivation.ts";

// ============================================================================
// ORIGINAL IMPLEMENTATION (before Issue #1017)
// Uses spread parameters for individual squash functions
// ============================================================================

function inlineActivationOldStyle(
  neuron: CreatureType["neurons"][0],
): string {
  // For non-inline squash functions, use direct function name (old style)
  // This is a simplified version that generates code using direct function names
  if (neuron.type === "constant") {
    return `a[${neuron.index}]=${neuron.bias};\n`;
  }
  const squash = neuron.findSquash();

  // Check for inline activation interface
  if ("inlineActivation" in squash) {
    return (squash as InlineActivationInterface).inlineActivation(neuron);
  }

  // Check for neuron activation interface - OLD STYLE: direct function call
  if ("activate" in squash) {
    return `a[${neuron.index}] = ${neuron.squash}(neurons[${neuron.index}]);\n`;
  }

  const inwardList = neuron.creature.inwardConnections(neuron.index);
  let valueLine = "";
  if (neuron.bias || inwardList.length === 0) {
    valueLine = `${neuron.bias}`;
  }

  const neurons = neuron.creature.neurons;
  const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);
  for (let i = 0, len = inwardListClone.length; i < len; i++) {
    const { from, weight } = inwardListClone[i];
    const fromNeuron = neurons[from];
    let value: string;
    if (fromNeuron.type === "constant") {
      value = `${fromNeuron.bias * weight}`;
    } else if (weight === 1) {
      value = `a[${from}]`;
    } else if (weight === -1) {
      value = `-a[${from}]`;
    } else {
      value = `a[${from}]*${weight}`;
    }

    if (valueLine !== "") {
      valueLine += "+";
    }
    valueLine += value;
  }

  if (neuron.squash === ReLU.NAME) {
    return `const t${neuron.index}=${valueLine};\na[${neuron.index}]=t${neuron.index}>0?t${neuron.index}:0;\n`;
  }

  // Check for inline squash interface
  if ("inlineSquash" in squash) {
    return `a[${neuron.index}]= ${
      (squash as InlineSquashInterface).inlineSquash(valueLine)
    };\n`;
  }

  // OLD STYLE: direct function name reference
  return `a[${neuron.index}]= ${neuron.squash}(${valueLine});\n`;
}

function makeCreatureActivationFunctionOldStyle(creature: CreatureType) {
  let functionBody = "const a = this.activations;\n";

  // OLD STYLE: Map of individual squash functions
  const squashMap = new Map<string, () => number>();
  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const neuron = creature.neurons[indx];
    functionBody += inlineActivationOldStyle(neuron);
    if (
      neuron.squash && !squashMap.has(neuron.squash) &&
      neuron.squash !== ReLU.NAME
    ) {
      const sf = neuron.findSquash();
      const inlineSquash = (sf as unknown) as InlineSquashInterface;
      if (!inlineSquash.inlineSquash) {
        const inlineActivation = (sf as unknown) as InlineActivationInterface;
        if (!inlineActivation.inlineActivation) {
          const squashActivation = sf as ActivationInterface;

          if (squashActivation.squash) {
            const bound = squashActivation.squash.bind(squashActivation);
            squashMap.set(neuron.squash, bound as () => number);
          } else {
            const neuronActivation = sf as NeuronActivationInterface;
            const bound = neuronActivation.activate.bind(squashActivation);
            squashMap.set(neuron.squash, bound as () => number);
          }
        }
      }
    }
  }

  const squashList = Array.from(squashMap.keys());
  // OLD STYLE: Spread parameters
  const func = new Function(
    "neurons",
    ...squashList,
    functionBody,
  ) as () => undefined;

  // OLD STYLE: Spread bound values
  const bondedFunction = func.bind(
    creature.state,
    creature.neurons,
    ...squashMap.values(),
  );

  return {
    inlineFunction: bondedFunction,
    inlineText: functionBody,
    squashList: squashList,
    parameterCount: 1 + squashList.length, // neurons + each squash function
  };
}

// ============================================================================
// NEW IMPLEMENTATION (Issue #1017)
// Uses single lookup table object
// ============================================================================

// deno-lint-ignore no-explicit-any
type SquashTable = Record<string, (...args: any[]) => number>;

function makeCreatureActivationFunctionNewStyle(creature: CreatureType) {
  let functionBody = "const a = this.activations;\n";

  // NEW STYLE: Lookup table object
  const squashTable: SquashTable = {};
  const squashList: string[] = [];

  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const neuron = creature.neurons[indx];
    functionBody += inlineActivationOriginal(neuron); // Uses new style with squash["name"]
    if (
      neuron.squash && !(neuron.squash in squashTable) &&
      neuron.squash !== ReLU.NAME
    ) {
      const sf = neuron.findSquash();
      const inlineSquash = (sf as unknown) as InlineSquashInterface;
      if (!inlineSquash.inlineSquash) {
        const inlineActivation = (sf as unknown) as InlineActivationInterface;
        if (!inlineActivation.inlineActivation) {
          const squashActivation = sf as ActivationInterface;

          if (squashActivation.squash) {
            const bound = squashActivation.squash.bind(squashActivation);
            squashTable[neuron.squash] = bound;
            squashList.push(neuron.squash);
          } else {
            const neuronActivation = sf as NeuronActivationInterface;
            const bound = neuronActivation.activate.bind(squashActivation);
            squashTable[neuron.squash] = bound;
            squashList.push(neuron.squash);
          }
        }
      }
    }
  }

  // NEW STYLE: Single squash parameter
  const func = new Function(
    "neurons",
    "squash",
    functionBody,
  );

  // NEW STYLE: Single lookup table object
  const bondedFunction = func.bind(
    creature.state,
    creature.neurons,
    squashTable,
  ) as () => undefined;

  return {
    inlineFunction: bondedFunction,
    inlineText: functionBody,
    squashList: squashList,
    parameterCount: 2, // neurons + squash table
  };
}

// ============================================================================
// BENCHMARKS
// ============================================================================

// Create test creature with many non-inline squash functions
const creature = Creature.fromJSON({
  neurons: [
    { bias: 0.1, type: "hidden", squash: "SELU", index: 2 },
    { bias: 0.2, type: "hidden", squash: "ELU", index: 3 },
    { bias: -0.1, type: "hidden", squash: "GELU", index: 4 },
    { bias: 0.3, type: "hidden", squash: "Swish", index: 5 },
    { bias: -0.2, type: "hidden", squash: "Mish", index: 6 },
    { bias: 0.05, type: "hidden", squash: "LOGISTIC", index: 7 },
    { bias: 0.15, type: "hidden", squash: "LeakyReLU", index: 8 },
    { bias: 0.25, type: "hidden", squash: "Softplus", index: 9 },
    { bias: -0.05, type: "hidden", squash: "BENT_IDENTITY", index: 10 },
    { bias: 0.0, type: "hidden", squash: "SOFTSIGN", index: 11 },
    { bias: 0.1, type: "hidden", squash: "GAUSSIAN", index: 12 },
    { bias: 0.0, type: "output", squash: "IDENTITY", index: 13 },
  ],
  synapses: [
    { weight: 1.0, from: 0, to: 2 },
    { weight: 0.5, from: 0, to: 3 },
    { weight: -0.5, from: 0, to: 4 },
    { weight: 0.3, from: 0, to: 5 },
    { weight: -0.3, from: 0, to: 6 },
    { weight: 0.8, from: 1, to: 7 },
    { weight: -0.8, from: 1, to: 8 },
    { weight: 0.6, from: 1, to: 9 },
    { weight: -0.6, from: 1, to: 10 },
    { weight: 0.4, from: 1, to: 11 },
    { weight: -0.4, from: 1, to: 12 },
    { weight: 0.1, from: 2, to: 13 },
    { weight: 0.1, from: 3, to: 13 },
    { weight: 0.1, from: 4, to: 13 },
    { weight: 0.1, from: 5, to: 13 },
    { weight: 0.1, from: 6, to: 13 },
    { weight: 0.1, from: 7, to: 13 },
    { weight: 0.1, from: 8, to: 13 },
    { weight: 0.1, from: 9, to: 13 },
    { weight: 0.1, from: 10, to: 13 },
    { weight: 0.1, from: 11, to: 13 },
    { weight: 0.1, from: 12, to: 13 },
  ],
  input: 2,
  output: 1,
});

creature.validate();

// Generate activation functions using both approaches
const oldResult = makeCreatureActivationFunctionOldStyle(creature);
const newResult = makeCreatureActivationFunctionNewStyle(creature);

console.log("=== Comparison Results ===");
console.log(`Old style parameter count: ${oldResult.parameterCount}`);
console.log(`New style parameter count: ${newResult.parameterCount}`);
console.log(`Squash functions in lookup table: ${newResult.squashList.length}`);
console.log(`Old style squash list: ${oldResult.squashList.join(", ")}`);
console.log(`New style squash list: ${newResult.squashList.join(", ")}`);

// Test inputs
const inputs: Float32Array[] = [];
for (let i = 0; i < 1000; i++) {
  inputs.push(new Float32Array([Math.random() * 2 - 1, Math.random() * 2 - 1]));
}

// Warm up old style
for (let i = 0; i < 100; i++) {
  creature.state.makeActivation(inputs[i % inputs.length], false);
  oldResult.inlineFunction();
}

// Warm up new style
for (let i = 0; i < 100; i++) {
  creature.state.makeActivation(inputs[i % inputs.length], false);
  newResult.inlineFunction();
}

Deno.bench(
  "OLD: Spread parameters (11 squash functions)",
  { group: "activation-comparison", baseline: true },
  () => {
    for (let i = 0; i < 10000; i++) {
      creature.state.makeActivation(inputs[i % inputs.length], false);
      oldResult.inlineFunction();
    }
  },
);

Deno.bench(
  "NEW: Lookup table (11 squash functions)",
  { group: "activation-comparison" },
  () => {
    for (let i = 0; i < 10000; i++) {
      creature.state.makeActivation(inputs[i % inputs.length], false);
      newResult.inlineFunction();
    }
  },
);

// Also test with the real traced.json creature
const tracedCreature = Creature.fromJSON(
  JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
);
tracedCreature.fix();

const oldTracedResult = makeCreatureActivationFunctionOldStyle(tracedCreature);
const newTracedResult = makeCreatureActivationFunctionNewStyle(tracedCreature);

console.log("\n=== Traced.json Comparison ===");
console.log(`Old style parameter count: ${oldTracedResult.parameterCount}`);
console.log(`New style parameter count: ${newTracedResult.parameterCount}`);
console.log(
  `Squash functions in lookup table: ${newTracedResult.squashList.length}`,
);

const tracedInputs: Float32Array[] = [];
for (let i = 0; i < 100; i++) {
  const input = new Float32Array(tracedCreature.input);
  for (let j = 0; j < tracedCreature.input; j++) {
    input[j] = Math.random() * 4 - 2;
  }
  tracedInputs.push(input);
}

// Warm up
for (let i = 0; i < 10; i++) {
  tracedCreature.state.makeActivation(
    tracedInputs[i % tracedInputs.length],
    false,
  );
  oldTracedResult.inlineFunction();
}
for (let i = 0; i < 10; i++) {
  tracedCreature.state.makeActivation(
    tracedInputs[i % tracedInputs.length],
    false,
  );
  newTracedResult.inlineFunction();
}

Deno.bench(
  "OLD: Spread parameters (traced.json)",
  { group: "traced-comparison", baseline: true },
  () => {
    for (let i = 0; i < 1000; i++) {
      tracedCreature.state.makeActivation(
        tracedInputs[i % tracedInputs.length],
        false,
      );
      oldTracedResult.inlineFunction();
    }
  },
);

Deno.bench(
  "NEW: Lookup table (traced.json)",
  { group: "traced-comparison" },
  () => {
    for (let i = 0; i < 1000; i++) {
      tracedCreature.state.makeActivation(
        tracedInputs[i % tracedInputs.length],
        false,
      );
      newTracedResult.inlineFunction();
    }
  },
);
