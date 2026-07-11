/**
 * Tests for the per-generation squash histogram telemetry (Issue #3263).
 */

import { assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { computeSquashHistogram } from "@neat/SquashHistogram.ts";

function makeCreature(squashes: {
  hidden: string[];
  output: string[];
}): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  squashes.hidden.forEach((squash, i) => {
    neurons.push({ type: "hidden", uuid: `hidden-${i}`, squash, bias: 0 });
    synapses.push({ fromUUID: "input-0", toUUID: `hidden-${i}`, weight: 0.5 });
  });
  squashes.output.forEach((squash, i) => {
    neurons.push({ type: "output", uuid: `output-${i}`, squash, bias: 0 });
    synapses.push({ fromUUID: "input-0", toUUID: `output-${i}`, weight: 0.5 });
  });

  const json: CreatureExport = {
    input: 1,
    output: squashes.output.length,
    neurons,
    synapses,
  };
  return Creature.fromJSON(json);
}

Deno.test("computeSquashHistogram: counts hidden and output neurons by squash", () => {
  const creature = makeCreature({
    hidden: ["TANH", "TANH", "LOGISTIC"],
    output: ["IDENTITY"],
  });
  const histogram = computeSquashHistogram([creature]);
  assertEquals(histogram, { TANH: 2, LOGISTIC: 1, IDENTITY: 1 });
});

Deno.test("computeSquashHistogram: canonicalises aliases (RELU -> ReLU)", () => {
  const creature = makeCreature({ hidden: ["RELU"], output: ["ReLU"] });
  const histogram = computeSquashHistogram([creature]);
  assertEquals(histogram, { ReLU: 2 });
});

Deno.test("computeSquashHistogram: aggregates across a population", () => {
  const a = makeCreature({ hidden: ["TANH"], output: ["IDENTITY"] });
  const b = makeCreature({ hidden: ["TANH"], output: ["LOGISTIC"] });
  const histogram = computeSquashHistogram([a, b]);
  assertEquals(histogram, { TANH: 2, IDENTITY: 1, LOGISTIC: 1 });
});

Deno.test("computeSquashHistogram: empty population yields an empty histogram", () => {
  assertEquals(computeSquashHistogram([]), {});
});

Deno.test("computeSquashHistogram: input neurons carry no squash and are excluded", () => {
  // A minimal creature: 2 inputs, 1 output. Only the output squash is counted.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [{ type: "output", uuid: "output-0", squash: "TANH", bias: 0 }],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  assertEquals(computeSquashHistogram([creature]), { TANH: 1 });
});
