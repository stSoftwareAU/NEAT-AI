/**
 * Issue #1366: Tests for compactUnused bias adjustment finite guard.
 *
 * When removing unused neurons in the non-constant path, the bias
 * adjustment must produce finite values. If the adjustment would
 * produce Infinity or NaN, removeNeuron must return false and leave
 * the creature unchanged.
 */

import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { removeNeuron } from "../../src/compact/CompactUnused.ts";

Deno.test("removeNeuron - normal bias adjustment succeeds", () => {
  // IDENTITY squash has no propagate method, so removeNeuron uses the
  // non-constant path (bias adjustment).
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.5 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.3 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const result = removeNeuron("hidden-0", creature, 0.5);
  assertEquals(result, true, "Normal removal should succeed");

  // Output neuron's bias should be adjusted: 0.5 + (0.3 * 0.5) = 0.65
  const outputNeuron = creature.neurons.find((n) => n.uuid === "output-0");
  assertEquals(outputNeuron !== undefined, true);
  assertEquals(
    Number.isFinite(outputNeuron!.bias),
    true,
    `Output bias should be finite, got ${outputNeuron!.bias}`,
  );
});

Deno.test("removeNeuron - returns false when bias addition overflows to Infinity", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      {
        type: "output",
        uuid: "output-0",
        squash: "IDENTITY",
        bias: Number.MAX_VALUE / 2,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: Number.MAX_VALUE },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // activation=1 means adjustedBias = MAX_VALUE * 1 = MAX_VALUE
  // newBias = MAX_VALUE/2 + MAX_VALUE = Infinity
  const result = removeNeuron("hidden-0", creature, 1);
  assertEquals(result, false, "Removal should be rejected when bias overflows");
});

Deno.test("removeNeuron - returns false when activation is NaN", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  // NaN activation means adjustedBias = 0.5 * NaN = NaN
  // newBias = 0 + NaN = NaN (not finite)
  const result = removeNeuron("hidden-0", creature, NaN);
  assertEquals(
    result,
    false,
    "Removal should be rejected when activation is NaN",
  );
});

Deno.test("removeNeuron - multiple synapses: no partial bias corruption on failure", () => {
  // hidden-0 connects to TWO output neurons. The first adjustment
  // should succeed, but the second should fail. The function must
  // leave both biases unchanged.
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1.0 },
      // First outward: small weight, will produce finite adjustment
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
      // Second outward: extreme weight, will produce Infinity
      { fromUUID: "hidden-0", toUUID: "output-1", weight: Number.MAX_VALUE },
    ],
    input: 2,
    output: 2,
  };
  const creature = Creature.fromJSON(json);

  const output0Before =
    creature.neurons.find((n) => n.uuid === "output-0")!.bias;
  const output1Before =
    creature.neurons.find((n) => n.uuid === "output-1")!.bias;

  // activation=Number.MAX_VALUE means:
  //   output-0: 0.5 * MAX_VALUE = finite (large but finite)
  //   output-1: MAX_VALUE * MAX_VALUE = Infinity
  const result = removeNeuron("hidden-0", creature, Number.MAX_VALUE);
  assertEquals(result, false, "Removal should be rejected");

  // Both output biases must remain unchanged (no partial corruption)
  const output0After =
    creature.neurons.find((n) => n.uuid === "output-0")!.bias;
  const output1After =
    creature.neurons.find((n) => n.uuid === "output-1")!.bias;

  assertEquals(
    output0After,
    output0Before,
    "output-0 bias must not be partially modified on failure",
  );
  assertEquals(
    output1After,
    output1Before,
    "output-1 bias must not be partially modified on failure",
  );
});
