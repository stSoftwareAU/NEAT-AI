import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import {
  RUNNER_UP_PROXIMITY_FLOOR,
  RUNNER_UP_PROXIMITY_WINDOW,
  runnerUpProximity,
} from "@methods/activations/aggregate/RunnerUpProximity.ts";

/**
 * Issue #3635: the runner-up proximity rule shared by MAXIMUM and MINIMUM.
 *
 * The rule is: a runner-up counts as "close" when
 * `0 <= distance <= max(|winner|, floor) * 0.2`, with distance measured
 * towards the losing side of the extremum.
 */
Deno.test("runnerUpProximity: winner itself scores 1", () => {
  assertEquals(runnerUpProximity(1, 0), 1);
  assertEquals(runnerUpProximity(-5, 0), 1);
  assertEquals(runnerUpProximity(0, 0), 1);
});

Deno.test("runnerUpProximity: window edge scores 0, beyond scores -1", () => {
  const winner = 1;
  const edge = winner * RUNNER_UP_PROXIMITY_WINDOW;

  assertAlmostEquals(runnerUpProximity(winner, edge), 0, 1e-12);
  assertEquals(runnerUpProximity(winner, edge * 1.000_001), -1);
});

Deno.test("runnerUpProximity: decays linearly across the window", () => {
  const winner = -2; // magnitude drives the window, not the sign
  const edge = Math.abs(winner) * RUNNER_UP_PROXIMITY_WINDOW;

  assertAlmostEquals(runnerUpProximity(winner, edge / 2), 0.5, 1e-12);
  assertAlmostEquals(runnerUpProximity(winner, edge / 4), 0.75, 1e-12);
});

Deno.test("runnerUpProximity: distance on the winning side is not a runner-up", () => {
  assertEquals(runnerUpProximity(1, -0.01), -1);
  assertEquals(runnerUpProximity(1, Number.NaN), -1);
});

Deno.test("runnerUpProximity: floor bounds the window for tiny winners", () => {
  const tinyWinner = 1e-9;
  // Without the floor the window would be 2e-10; with it, 2e-8.
  const distance = 1e-8;

  assert(
    runnerUpProximity(tinyWinner, distance) >= 0,
    "distance inside the floored window must count as close",
  );
  assertEquals(
    runnerUpProximity(tinyWinner, distance, 1e-12),
    -1,
    "an explicit tiny floor shrinks the window",
  );
  assertAlmostEquals(
    RUNNER_UP_PROXIMITY_FLOOR,
    createBackPropagationConfig({}).plankConstant,
    1e-15,
    "the shared floor must match the default plank constant",
  );
});

Deno.test("runnerUpProximity: a zero window only admits an exact tie", () => {
  assertEquals(runnerUpProximity(0, 0, 0), 1);
  assertEquals(runnerUpProximity(0, 1e-30, 0), -1);
});

/**
 * Issue #3635 regression: `activateAndTrace` and `propagate` used different
 * floors (1e-12 vs config.plankConstant), so when the winner's magnitude fell
 * between them a runner-up could receive leaked gradient in `propagate` while
 * never being marked `used` — and `applyLearnings` then disconnected it.
 *
 * The winner's value here is 1e-9 (below the plank constant), the runner-up
 * sits 1e-8 towards the losing side — inside the floored window (2e-8) but
 * outside an unfloored one (2e-10) — and the third connection is far outside
 * any window.
 */
function buildExtremum(squash: "MAXIMUM" | "MINIMUM"): Creature {
  const sign = squash === "MAXIMUM" ? 1 : -1;
  const creature = Creature.fromJSON({
    input: 3,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: sign * 1e-9 },
      { fromUUID: "input-1", toUUID: "output-0", weight: sign * -9e-9 },
      { fromUUID: "input-2", toUUID: "output-0", weight: sign * -1 },
    ],
  });
  creature.validate();

  const state = creature.state;
  state.activations = new Float32Array(creature.neurons.length);
  state.activations[0] = 1;
  state.activations[1] = 1;
  state.activations[2] = 1;

  return creature;
}

for (const squash of ["MAXIMUM", "MINIMUM"] as const) {
  Deno.test(`${squash}: a runner-up in the window survives applyLearnings`, () => {
    const creature = buildExtremum(squash);
    const neuron = creature.neurons[creature.neurons.length - 1];
    neuron.prepare();
    neuron.activateAndTraceNeuron();

    const sparseConfig = new SparseConfig(
      exportJSONWithRuntimeIds(creature),
      createBackPropagationConfig({ sparseRatio: 1 }),
    );
    const changed = creature.applyLearnings(
      createBackPropagationConfig({ trainingMutationRate: 1 }),
      sparseConfig,
    );
    assert(changed, "the connection outside the window should be disconnected");

    const survivors = new Set(
      creature.exportJSON().synapses.map((s) => s.fromUUID),
    );

    assert(survivors.has("input-0"), "the winner must survive");
    assert(
      survivors.has("input-1"),
      "a runner-up inside the shared proximity window must survive",
    );
    assert(
      !survivors.has("input-2"),
      "a connection outside the window must be disconnected",
    );
  });

  Deno.test(`${squash}: the same runner-up receives leaked gradient`, () => {
    const creature = buildExtremum(squash);
    const neuron = creature.neurons[creature.neurons.length - 1];
    neuron.prepare();
    const activation = neuron.activateAndTraceNeuron().activation;

    const config = createBackPropagationConfig({});
    const sparseConfig = new SparseConfig(
      exportJSONWithRuntimeIds(creature),
      createBackPropagationConfig({ sparseRatio: 1 }),
    );
    neuron.propagate(activation + 1, config, sparseConfig);

    const state = creature.state;
    const inward = creature.inwardConnections(neuron.index);
    const countFor = (from: number) =>
      state.connectionFor(inward.find((c) => c.from === from)!).count;

    assert(countFor(1) > 0, "the runner-up must receive leaked gradient");
    assertEquals(
      countFor(2),
      0,
      "a connection outside the window must not receive gradient",
    );
  });
}
