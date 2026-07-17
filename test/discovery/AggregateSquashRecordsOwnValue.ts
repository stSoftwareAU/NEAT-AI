import { assert, assertAlmostEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IF } from "@methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "@methods/activations/aggregate/MINIMUM.ts";
import { ReLU } from "@methods/activations/types/ReLU.ts";
import { toValue } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";

/**
 * Issue #3389: aggregate-squash neurons (MAXIMUM/MINIMUM/IF) — including an
 * `output-0` that uses an aggregate squash — must record their own
 * pre-activation `value` and attributed `error`, not just delegate to the
 * selected input path.
 */

/** Build a creature whose output-0 uses the given aggregate squash. */
function buildAggregateOutput(squash: string): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-a", type: "hidden", squash: ReLU.NAME, bias: 0.25 },
      { uuid: "hidden-b", type: "hidden", squash: ReLU.NAME, bias: -0.1 },
      { uuid: "output-0", type: "output", squash, bias: 0.5 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.8 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 1.2 },
      // Condition (only used by IF, harmless for MAXIMUM/MINIMUM).
      { fromUUID: "input-0", toUUID: "output-0", weight: 1, type: "condition" },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 1, type: "positive" },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 1, type: "positive" },
    ],
  };
}

function recordOutput(squash: string) {
  const creature = Creature.fromJSON(buildAggregateOutput(squash));
  const config = createBackPropagationConfig({
    sparseRatio: 1,
    disableRandomSamples: true,
    generations: 0,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  creature.activateAndTrace(new Float32Array([0.7, 0.4]), false, sparseConfig);

  const output = creature.neurons[creature.neurons.length - 1];
  const currentActivation = creature.state.activations[output.index];
  // Request a target well away from the current activation to force an error.
  const target = currentActivation + 0.75;

  const discoverMap = creature.record(new Float32Array([target]));
  return { output, currentActivation, target, discoverMap };
}

for (const squash of [MAXIMUM.NAME, MINIMUM.NAME, IF.NAME]) {
  Deno.test(`record(${squash}): output aggregate records its own value and error`, () => {
    const { output, currentActivation, target, discoverMap } = recordOutput(
      squash,
    );

    const rec = discoverMap.get(output.id);
    assertExists(rec, `Expected a record entry for output-0 (${squash})`);

    // Own pre-activation value must be recorded (previously fully null).
    assertExists(rec.value, `Expected output value to be recorded (${squash})`);
    assert(
      Number.isFinite(rec.value!),
      `Expected finite output value (${squash}), got ${rec.value}`,
    );
    assertAlmostEquals(
      rec.value!,
      toValue(output, currentActivation),
      1e-6,
      `value should equal toValue(neuron, activation) (${squash})`,
    );

    // Own attributed error must be recorded (previously no errors at all).
    assert(
      rec.errors.length > 0,
      `Expected at least one recorded error (${squash})`,
    );
    const expectedError = toValue(output, target) -
      toValue(output, currentActivation);
    assertAlmostEquals(
      rec.errors[0],
      expectedError,
      1e-6,
      `first error should equal toValue(target) - toValue(current) (${squash})`,
    );
  });
}

Deno.test("record(aggregate): matching target records a zero own error", () => {
  const creature = Creature.fromJSON(buildAggregateOutput(MINIMUM.NAME));
  const config = createBackPropagationConfig({
    sparseRatio: 1,
    disableRandomSamples: true,
    generations: 0,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  creature.activateAndTrace(new Float32Array([0.7, 0.4]), false, sparseConfig);

  const output = creature.neurons[creature.neurons.length - 1];
  const currentActivation = creature.state.activations[output.index];

  // Target == activation → own error is zero, but value is still recorded.
  const discoverMap = creature.record(new Float32Array([currentActivation]));
  const rec = discoverMap.get(output.id);
  assertExists(rec);
  assertExists(rec.value);
  assert(rec.errors.length > 0, "Expected an error entry even when target met");
  assertAlmostEquals(rec.errors[0], 0, 1e-6);
});

Deno.test("record(aggregate): own error recorded once per neuron (single visit)", () => {
  // A hidden aggregate feeding two output neurons is visited twice by the
  // record walk; its own error must be recorded exactly once (first visit).
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 2,
    neurons: [
      { uuid: "hidden-max", type: "hidden", squash: MAXIMUM.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: ReLU.NAME, bias: 0 },
      { uuid: "output-1", type: "output", squash: ReLU.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-max", weight: 0.9 },
      { fromUUID: "input-1", toUUID: "hidden-max", weight: 0.6 },
      { fromUUID: "hidden-max", toUUID: "output-0", weight: 1.1 },
      { fromUUID: "hidden-max", toUUID: "output-1", weight: 0.7 },
    ],
  };
  const creature = Creature.fromJSON(creatureJSON);
  const config = createBackPropagationConfig({
    sparseRatio: 1,
    disableRandomSamples: true,
    generations: 0,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  creature.activateAndTrace(new Float32Array([0.5, 0.3]), false, sparseConfig);

  const hidden = creature.neurons.find((n) => n.uuid === "hidden-max");
  assertExists(hidden);

  const discoverMap = creature.record(new Float32Array([0.9, 0.2]));
  const rec = discoverMap.get(hidden!.id);
  assertExists(rec, "Expected a record entry for the hidden aggregate neuron");
  assertExists(rec.value, "Expected the hidden aggregate to record a value");
  assert(
    rec.errors.length > 0,
    "Expected the hidden aggregate to record its own error",
  );
});
