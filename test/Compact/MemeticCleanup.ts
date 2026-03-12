import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  cleanupMemeticForRemovedNeuron,
  cleanupMemeticForRemovedSynapse,
} from "../../src/compact/MemeticCleanup.ts";

Deno.test("MemeticCleanup - direct import cleanupMemeticForRemovedSynapse deletes memetic", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        "input-0": [{ toUUID: "output-0", weight: 0.1 }],
      },
    },
  };

  cleanupMemeticForRemovedSynapse(exported, "input-0", "output-0");
  assertEquals(exported.memetic, undefined);
});

Deno.test("MemeticCleanup - direct import cleanupMemeticForRemovedSynapse preserves memetic when not referenced", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        "input-0": [{ toUUID: "output-0", weight: 0.1 }],
      },
    },
  };

  cleanupMemeticForRemovedSynapse(exported, "other-uuid", "output-0");
  assert(exported.memetic !== undefined);
});

Deno.test("MemeticCleanup - direct import cleanupMemeticForRemovedNeuron deletes memetic", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    memetic: {
      generation: 1,
      score: 0,
      biases: {},
      weights: {
        "hidden-1": [{ toUUID: "output-0", weight: 0.1 }],
      },
    },
  };

  cleanupMemeticForRemovedNeuron(exported, "hidden-1");
  assertEquals(exported.memetic, undefined);
});

Deno.test("MemeticCleanup - direct import handles missing memetic gracefully", () => {
  const exported: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
  };

  // Should not throw
  cleanupMemeticForRemovedSynapse(exported, "input-0", "output-0");
  cleanupMemeticForRemovedNeuron(exported, "hidden-1");
});
