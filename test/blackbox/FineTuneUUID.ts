import { assertAlmostEquals, assertEquals, fail } from "@std/assert";
import { Creature } from "@creature";
import { fineTuneImprovement } from "@blackbox/FineTune.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Both parents share the same output-neuron bias below. Fine-tuning blends the
// current fittest towards the previous fittest, so when the two parents already
// agree on a value the blend has nothing to move towards and must conserve it.
// Deriving the expectation from this single constant (rather than pasting the
// algorithm's emitted number) keeps the assertion a WHAT-test: it verifies the
// preservation contract, not an opaque intermediate of today's blend.
const SHARED_OUTPUT_BIAS = -0.49135010426905;

Deno.test("tune", () => {
  const previousFittest: Creature = Creature.fromJSON({
    neurons: [
      {
        type: "hidden",
        uuid: "previous-0001",
        bias: -0.5,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        bias: 0.1,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        bias: 0.2,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
        bias: 0.3,
        squash: "LOGISTIC",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: SHARED_OUTPUT_BIAS,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    synapses: [
      {
        weight: -0.67556172986067,
        fromUUID: "input-0",
        toUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
      },
      {
        weight: -0.29860676755617,
        fromUUID: "input-1",
        toUUID: "previous-0001",
      },

      {
        weight: -0.06729866176755,
        fromUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        toUUID: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
      },
      {
        weight: -0.012398765,
        fromUUID: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        toUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
      },

      {
        weight: -0.00000012,
        fromUUID: "previous-0001",
        toUUID: "output-0",
      },
      {
        weight: 0.9867556172986067,
        fromUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        toUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
      },
      {
        weight: 0.96764643541,
        fromUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
        toUUID: "output-0",
      },
    ],
    input: 2,
    output: 1,
  });

  previousFittest.validate();

  const fittest: Creature = Creature.fromJSON({
    neurons: [
      {
        type: "hidden",
        uuid: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        bias: 0.1,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        bias: 0.2,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        uuid: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
        bias: 0.32,
        squash: "LOGISTIC",
      },
      {
        type: "hidden",
        uuid: "fittest-0001",
        bias: -0.3,
        squash: "IDENTITY",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: SHARED_OUTPUT_BIAS,
        squash: "BIPOLAR_SIGMOID",
      },
    ],
    synapses: [
      {
        weight: -0.67556172986067,
        fromUUID: "input-0",
        toUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
      },
      {
        weight: -0.67556172986067,
        fromUUID: "input-1",
        toUUID: "fittest-0001",
      },
      {
        weight: 0.9967556172986067,
        fromUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        toUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
      },
      {
        weight: -0.06729866176755,
        fromUUID: "41a4f3dd-f253-491e-b04f-c9651b72eaaa",
        toUUID: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
      },
      {
        weight: -0.012398765,
        fromUUID: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
        toUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
      },

      {
        weight: -0.00000067,
        fromUUID: "fittest-0001",
        toUUID: "output-0",
      },
      {
        weight: 0.96864643541,
        fromUUID: "0a858bc2-3bdc-417c-85b0-e9c513828d29",
        toUUID: "output-0",
      },
    ],
    input: 2,
    output: 1,
  });

  fittest.validate();

  fittest.score = -0.4;

  previousFittest.score = -0.5;

  const fineTuned = fineTuneImprovement(fittest, previousFittest, false);

  fineTuned.forEach((n) => {
    const en = n.exportJSON();

    en.neurons.forEach((node) => {
      if (node.id === 1555827657) {
        assertAlmostEquals(node.bias, 0.1, 0.0000001, n.uuid);
      }

      if (node.id === -1) {
        // Preservation: both parents agreed on this output bias, so the
        // fine-tune blend must conserve it. Derived from the shared fixture
        // constant rather than the algorithm's emitted value.
        assertAlmostEquals(
          node.bias,
          SHARED_OUTPUT_BIAS,
          0.0000001,
          n.uuid,
        );
      }
      if (node.id === 1400382452) {
        if (Math.abs(node.bias - 0.32) < 0.000001) {
          fail("Should have changed bias from 0.32");
        }
      }
    });

    en.synapses.forEach((c) => {
      if (
        c.fromId === 885884352 &&
        c.toId === 1400382452
      ) {
        assertAlmostEquals(c.weight, -0.012398765, 0.000001, JSON.stringify(c));
      }

      if (
        c.fromId === 1555827657 &&
        c.toId === 885884352
      ) {
        assertAlmostEquals(
          c.weight,
          -0.06729866176755,
          0.000001,
          JSON.stringify(c),
        );
      }
    });
  });

  assertEquals(
    fineTuned.length,
    10,
    "We should have made changes, was: " + fineTuned.length,
  );
});
