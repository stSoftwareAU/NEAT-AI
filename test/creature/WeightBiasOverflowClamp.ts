/**
 * Tests for Issue #2378: defence-in-depth clamping of weight/bias magnitudes
 * when loading creatures from JSON.
 *
 * During long-running GRQ evolve runs, synapse weights and neuron biases have
 * been observed to drift to magnitudes up to 1.15e+195. Those values are
 * then reloaded from disk in later evolve sessions, carrying the overflow
 * forward and saturating the scorer's penalty curve. Clamping to
 * `Number.MAX_SAFE_INTEGER` at load time prevents the runaway from
 * compounding and keeps score penalties meaningful.
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { MAX_SAFE_WEIGHT_BIAS } from "@utils/WeightBiasClamp.ts";

Deno.test(
  "fromJSON: synapse weight above MAX_SAFE_INTEGER is clamped",
  () => {
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "output-0",
          weight: 1.1559466326634707e+195,
        },
      ],
    };

    const creature = Creature.fromJSON(json);

    assertEquals(creature.synapses.length, 1);
    const w = creature.synapses[0].weight;
    assert(
      Math.abs(w) <= MAX_SAFE_WEIGHT_BIAS,
      `Weight ${w} should be clamped to <= ${MAX_SAFE_WEIGHT_BIAS}`,
    );
    assertEquals(w, MAX_SAFE_WEIGHT_BIAS);
  },
);

Deno.test(
  "fromJSON: negative synapse weight below -MAX_SAFE_INTEGER is clamped",
  () => {
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "output-0",
          weight: -2.6680832284972457e+28,
        },
      ],
    };

    const creature = Creature.fromJSON(json);

    const w = creature.synapses[0].weight;
    assertEquals(w, -MAX_SAFE_WEIGHT_BIAS);
  },
);

Deno.test(
  "fromJSON: neuron bias above MAX_SAFE_INTEGER is clamped",
  () => {
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "output",
          uuid: "output-0",
          squash: "IDENTITY",
          bias: 1.1559466326634707e+195,
        },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "output-0",
          weight: 0.5,
        },
      ],
    };

    const creature = Creature.fromJSON(json);

    const b = creature.neurons[creature.input].bias;
    assert(
      Math.abs(b) <= MAX_SAFE_WEIGHT_BIAS,
      `Bias ${b} should be clamped to <= ${MAX_SAFE_WEIGHT_BIAS}`,
    );
    assertEquals(b, MAX_SAFE_WEIGHT_BIAS);
  },
);

Deno.test(
  "fromJSON: in-range weights and biases are preserved exactly",
  () => {
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          type: "output",
          uuid: "output-0",
          squash: "IDENTITY",
          bias: 1.5,
        },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "output-0",
          weight: -0.75,
        },
      ],
    };

    const creature = Creature.fromJSON(json);

    assertEquals(creature.neurons[creature.input].bias, 1.5);
    assertEquals(creature.synapses[0].weight, -0.75);
  },
);
