/**
 * Benchmark for Score.ts scan index-finding optimisation.
 *
 * Issue #2122: Measures the performance improvement from replacing
 * .slice().findIndex() and .findIndex() with direct for loops in the
 * scan functions. These patterns are used to find the index of the old
 * weight/bias value before passing to WASM.
 *
 * The benchmark isolates the index-finding patterns to demonstrate
 * the allocation and closure overhead savings.
 */

import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "@architecture/Score.ts";
import { Creature } from "../mod.ts";

// --- Pattern isolation benchmarks ---
// These demonstrate the raw overhead of .slice().findIndex() vs direct for loop

function makeNeuronLikeArray(size: number): { bias: number }[] {
  const arr: { bias: number }[] = [];
  for (let i = 0; i < size; i++) {
    arr.push({ bias: i === size - 1 ? 99.0 : 0.1 + i * 0.01 });
  }
  return arr;
}

function makeSynapseLikeArray(size: number): { weight: number }[] {
  const arr: { weight: number }[] = [];
  for (let i = 0; i < size; i++) {
    arr.push({ weight: i === size - 1 ? 99.0 : 0.1 + i * 0.01 });
  }
  return arr;
}

// Small arrays (105 elements)
const smallNeurons = makeNeuronLikeArray(105);
const smallSynapses = makeSynapseLikeArray(105);
const smallInputCount = 3;

Deno.bench({
  name: "BEFORE: slice().findIndex() - small (105)",
  fn() {
    smallNeurons.slice(smallInputCount).findIndex((n) => n.bias === 99.0);
  },
});

Deno.bench({
  name: "AFTER: direct for loop - small (105)",
  fn() {
    for (let i = smallInputCount; i < smallNeurons.length; i++) {
      if (smallNeurons[i].bias === 99.0) {
        break;
      }
    }
  },
});

Deno.bench({
  name: "BEFORE: findIndex() - small (105)",
  fn() {
    smallSynapses.findIndex((s) => s.weight === 99.0);
  },
});

Deno.bench({
  name: "AFTER: direct for loop (weight) - small (105)",
  fn() {
    for (let i = 0; i < smallSynapses.length; i++) {
      if (smallSynapses[i].weight === 99.0) {
        break;
      }
    }
  },
});

// Medium arrays (255 elements)
const medNeurons = makeNeuronLikeArray(255);
const medSynapses = makeSynapseLikeArray(255);

Deno.bench({
  name: "BEFORE: slice().findIndex() - medium (255)",
  fn() {
    medNeurons.slice(smallInputCount).findIndex((n) => n.bias === 99.0);
  },
});

Deno.bench({
  name: "AFTER: direct for loop - medium (255)",
  fn() {
    let _offset = -1;
    for (let i = smallInputCount; i < medNeurons.length; i++) {
      if (medNeurons[i].bias === 99.0) {
        _offset = i - smallInputCount;
        break;
      }
    }
  },
});

Deno.bench({
  name: "BEFORE: findIndex() - medium (255)",
  fn() {
    medSynapses.findIndex((s) => s.weight === 99.0);
  },
});

Deno.bench({
  name: "AFTER: direct for loop (weight) - medium (255)",
  fn() {
    let _idx = -1;
    for (let i = 0; i < medSynapses.length; i++) {
      if (medSynapses[i].weight === 99.0) {
        _idx = i;
        break;
      }
    }
  },
});

// Large arrays (555 elements)
const lgNeurons = makeNeuronLikeArray(555);
const lgSynapses = makeSynapseLikeArray(555);

Deno.bench({
  name: "BEFORE: slice().findIndex() - large (555)",
  fn() {
    lgNeurons.slice(smallInputCount).findIndex((n) => n.bias === 99.0);
  },
});

Deno.bench({
  name: "AFTER: direct for loop - large (555)",
  fn() {
    let _offset = -1;
    for (let i = smallInputCount; i < lgNeurons.length; i++) {
      if (lgNeurons[i].bias === 99.0) {
        _offset = i - smallInputCount;
        break;
      }
    }
  },
});

Deno.bench({
  name: "BEFORE: findIndex() - large (555)",
  fn() {
    lgSynapses.findIndex((s) => s.weight === 99.0);
  },
});

Deno.bench({
  name: "AFTER: direct for loop (weight) - large (555)",
  fn() {
    let _idx = -1;
    for (let i = 0; i < lgSynapses.length; i++) {
      if (lgSynapses[i].weight === 99.0) {
        _idx = i;
        break;
      }
    }
  },
});

// --- End-to-end integration benchmarks ---
// These measure the full updateScore path including the scan

function makeCreature(hiddenCount: number): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: hiddenCount, squash: "IDENTITY" }],
  });
  for (let i = 0; i < creature.synapses.length; i++) {
    creature.synapses[i].weight = (i === 0) ? 10.0 : 0.1 + i * 0.01;
  }
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = (i === creature.input) ? 10.0 : 0.1 + i * 0.01;
  }
  delete creature.cachedScoreComponents;
  return creature;
}

function saveState(creature: Creature): {
  weights: Float64Array;
  biases: Float64Array;
} {
  const weights = new Float64Array(creature.synapses.length);
  for (let i = 0; i < creature.synapses.length; i++) {
    weights[i] = creature.synapses[i].weight;
  }
  const biases = new Float64Array(creature.neurons.length - creature.input);
  for (let i = 0; i < biases.length; i++) {
    biases[i] = creature.neurons[creature.input + i].bias;
  }
  return { weights, biases };
}

function restoreState(
  creature: Creature,
  state: { weights: Float64Array; biases: Float64Array },
): void {
  for (let i = 0; i < state.weights.length; i++) {
    creature.synapses[i].weight = state.weights[i];
  }
  for (let i = 0; i < state.biases.length; i++) {
    creature.neurons[creature.input + i].bias = state.biases[i];
  }
  delete creature.cachedScoreComponents;
}

const sizes = [
  { name: "small", hidden: 102, total: 105 },
  { name: "medium", hidden: 252, total: 255 },
  { name: "large", hidden: 552, total: 555 },
];

for (const size of sizes) {
  const creature = makeCreature(size.hidden);
  const state = saveState(creature);

  Deno.bench({
    name: `E2E Weight scan - ${size.name} (${size.total} neurons)`,
    fn() {
      restoreState(creature, state);
      calculate(creature, 0.1, 0.001);
      creature.synapses[0].weight = 5.0;
      updateScoreForWeightChange(creature, 0.1, 0.001, 10.0, 5.0);
      creature.synapses[0].weight = 0.01;
      updateScoreForWeightChange(creature, 0.1, 0.001, 5.0, 0.01);
    },
  });

  Deno.bench({
    name: `E2E Bias scan - ${size.name} (${size.total} neurons)`,
    fn() {
      restoreState(creature, state);
      calculate(creature, 0.1, 0.001);
      const biasIdx = creature.input;
      creature.neurons[biasIdx].bias = 5.0;
      updateScoreForBiasChange(creature, 0.1, 0.001, 10.0, 5.0);
      creature.neurons[biasIdx].bias = 0.01;
      updateScoreForBiasChange(creature, 0.1, 0.001, 5.0, 0.01);
    },
  });
}
