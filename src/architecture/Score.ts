import { assert } from "@std/assert/assert";
import type { CreatureInternal } from "./CreatureInterfaces.ts";
import { Activations } from "../methods/activations/Activations.ts";

export function calculate(
  creature: CreatureInternal,
  error: number,
  growthCost: number,
): number {
  assert(!Number.isNaN(error), `Error is NaN`);
  assert(Number.isFinite(error), `Error is not finite`);
  assert(error >= 0, `Error: ${error} is negative`);
  const { max, avg } = calculateMaxOutOfBounds(creature);
  assert(Number.isFinite(max), `Max: ${max} is not finite`);
  assert(Number.isFinite(avg), `Avg: ${avg} is not finite`);
  const penalty = calculatePenalty(max, avg);
  assert(Number.isFinite(penalty), `Penalty: ${penalty} is not finite`);
  const score = calculateScore(error, creature, penalty, growthCost);

  assert(Number.isFinite(score), `Score: ${score} is not finite`);
  return score;
}

function calculateMaxOutOfBounds(
  creature: CreatureInternal,
): { max: number; avg: number } {
  let max = 0;
  let total = 0;
  let count = 0;

  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Weight: ${synapse.weight} is not finite`,
    );
    const w = Math.abs(synapse.weight);
    max = Math.max(max, w);
    total += w;
    count++;
  }

  for (const node of creature.neurons) {
    if (
      node.type !== "input"
    ) {
      assert(Number.isFinite(node.bias), `Bias: ${node.bias} is not finite`);
      const b = Math.abs(node.bias!);
      max = Math.max(max, b);
      total += b;
      count++;
    }
  }

  assert(count > 0, "Count is 0");

  if (max > Number.MAX_SAFE_INTEGER) {
    console.log("Max is too large", max);
  }
  if (total > Number.MAX_SAFE_INTEGER) {
    console.log("Total is too large", total);
  }
  if (max > Number.MAX_SAFE_INTEGER) max = Number.MAX_SAFE_INTEGER;
  if (total > Number.MAX_SAFE_INTEGER) total = Number.MAX_SAFE_INTEGER;

  assert(max >= 0, `Max: ${max} is negative`);
  assert(total >= 0, `Total: ${total} is negative`);

  const avg = count > 0 ? total / count : 0;

  return { max, avg };
}

export function valuePenalty(value: number): number {
  assert(value >= 0, `Value: ${value} is negative`);
  if (value <= 1) return 0;

  assert(Number.isFinite(value), `Value: ${value} is not finite`);
  assert(value <= Number.MAX_SAFE_INTEGER, `Value: ${value} is too large`);

  const primaryPenalty = 1 / (1 + 1 / value); // Simplified from Math.exp(-Math.log(value))

  if (primaryPenalty > 0.999) {
    const compressPenalty = 0.999 + valuePenalty(Math.log(value)) / 1000;
    assert(
      compressPenalty < 1,
      `Compressed Penalty: ${compressPenalty} is greater than or equal to 1`,
    );
    return compressPenalty;
  }

  assert(
    primaryPenalty < 1,
    `Primary Penalty: ${primaryPenalty} is greater than or equal to 1`,
  );
  return primaryPenalty;
}

function calculatePenalty(max: number, avg: number): number {
  const penalty = (valuePenalty(max) + valuePenalty(avg)) / 2;

  assert(
    Number.isFinite(penalty),
    `Penalty: ${penalty} is not finite`,
  );
  assert(penalty >= 0, `Penalty: ${penalty} is negative`);
  assert(
    penalty < 1,
    `Penalty: ${penalty} is greater than or equal to 1`,
  );

  return penalty;
}

function calculateScore(
  error: number,
  creature: CreatureInternal,
  penalty: number,
  growthCost: number,
): number {
  const endIndex = creature.neurons.length;
  for (let indx = creature.input; indx < endIndex; indx++) {
    const neuron = creature.neurons[indx];
    if (neuron.squash) {
      const squashFunction = Activations.find(
        neuron.squash,
      );
      if (squashFunction.complexityPenalty) {
        penalty += squashFunction.complexityPenalty;
      }
    }
  }

  const hiddenNeuronCount = creature.neurons.length - creature.input -
    creature.output;

  const complexityPenalty = hiddenNeuronCount * growthCost +
    creature.synapses.length * growthCost / 10 + penalty * growthCost / 100;
  const score = 1 - error - complexityPenalty;
  assert(score <= 1, `Score: ${score} is greater than 1`);

  return score;
}
