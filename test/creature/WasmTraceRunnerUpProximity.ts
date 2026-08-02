/**
 * Issue #3640: the runner-up proximity rule (Issue #1874) must be applied on
 * the **production** trace path.
 *
 * `Creature.activateAndTrace()` always goes through WASM, so the TypeScript
 * `MAXIMUM.activateAndTrace` / `MINIMUM.activateAndTrace` bodies — which mark
 * close runner-ups as `used` — are never reached in production. Backpropagation
 * is still TypeScript and does leak a fraction of the gradient to those close
 * runner-ups, so a WASM trace that marked only the winner would leave a
 * connection with gradient but `used === false`, and `applyLearnings` would
 * disconnect a connection that is still learning.
 *
 * These tests exercise the creature-level path and assert on the resulting
 * synapse state, so they keep passing through any rewrite of how the trace data
 * gets back from WASM.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "@methods/activations/aggregate/MINIMUM.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import type { SynapseState } from "@propagate/SynapseState.ts";

const WINNER_INDEX = 0;
const RUNNER_UP_INDEX = 1;
const OUTPUT_INDEX = 2;

function twoInputExtremum(squashName: string): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: squashName, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
    ],
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/**
 * Trace one sample through the production path — `creature.activateAndTrace()`,
 * which is WASM — and return both synapse states.
 */
function traceViaCreature(
  squashName: string,
  input: number[],
): { winner: SynapseState; runnerUp: SynapseState; creature: Creature } {
  const creature = twoInputExtremum(squashName);
  const config = createBackPropagationConfig({
    generations: 1,
    disableRandomSamples: true,
    batchSize: 1000,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  creature.activateAndTrace(new Float32Array(input), false, sparseConfig);

  return {
    winner: creature.state.connection(WINNER_INDEX, OUTPUT_INDEX),
    runnerUp: creature.state.connection(RUNNER_UP_INDEX, OUTPUT_INDEX),
    creature,
  };
}

/**
 * The hazard the rule exists to prevent: a synapse that received leaked
 * gradient but was never marked `used` gets disconnected by `applyLearnings`.
 */
function assertNoGradientToUnusedSynapse(cs: SynapseState, label: string) {
  assert(
    cs.count === 0 || cs.used === true,
    `${label}: runner-up received gradient (count=${cs.count}) but was not marked used (used=${cs.used})`,
  );
}

Deno.test("MAXIMUM: WASM trace marks a close runner-up as used (#3640)", () => {
  // Winner 1e-9 floors to a 2e-8 window; the runner-up sits 1e-10 away.
  const { winner, runnerUp } = traceViaCreature("MAXIMUM", [1e-9, 9e-10]);

  assertEquals(winner.used, true, "winning synapse must be used");
  assertEquals(runnerUp.used, true, "close runner-up must be marked used");
});

Deno.test("MINIMUM: WASM trace marks a close runner-up as used (#3640)", () => {
  const { winner, runnerUp } = traceViaCreature("MINIMUM", [-1e-9, -9e-10]);

  assertEquals(winner.used, true, "winning synapse must be used");
  assertEquals(runnerUp.used, true, "close runner-up must be marked used");
});

Deno.test("MAXIMUM: WASM trace leaves a distant runner-up unused (#3640)", () => {
  // Winner 1.0 gives a 0.2-wide window; a runner-up 0.5 away sits outside it.
  const { winner, runnerUp } = traceViaCreature("MAXIMUM", [1, 0.5]);

  assertEquals(winner.used, true, "winning synapse must be used");
  assertEquals(
    runnerUp.used ?? false,
    false,
    "distant runner-up must not be marked used",
  );
});

Deno.test("MINIMUM: WASM trace leaves a distant runner-up unused (#3640)", () => {
  const { winner, runnerUp } = traceViaCreature("MINIMUM", [-1, -0.5]);

  assertEquals(winner.used, true, "winning synapse must be used");
  assertEquals(
    runnerUp.used ?? false,
    false,
    "distant runner-up must not be marked used",
  );
});

Deno.test("WASM trace agrees with the TypeScript trace on close runner-ups (#3640)", () => {
  for (
    const { squash, input } of [
      { squash: new MAXIMUM(), input: [1e-9, 9e-10] },
      { squash: new MINIMUM(), input: [-1e-9, -9e-10] },
      { squash: new MAXIMUM(), input: [1, 0.5] },
      { squash: new MINIMUM(), input: [-1, -0.5] },
    ]
  ) {
    const name = squash.getName();

    const viaWasm = traceViaCreature(name, input).runnerUp.used ?? false;

    const creature = twoInputExtremum(name);
    creature.state.makeActivation(new Float32Array(input), false);
    squash.activateAndTrace(creature.neurons[OUTPUT_INDEX]);
    const viaTypeScript =
      creature.state.connection(RUNNER_UP_INDEX, OUTPUT_INDEX).used ?? false;

    assertEquals(
      viaWasm,
      viaTypeScript,
      `${name} ${
        JSON.stringify(input)
      }: WASM trace and TypeScript trace must agree on the runner-up`,
    );
  }
});

Deno.test("MAXIMUM: no gradient reaches an unused synapse after a WASM trace (#3640)", () => {
  const creature = twoInputExtremum("MAXIMUM");
  const config = createBackPropagationConfig({
    generations: 1,
    disableRandomSamples: true,
    batchSize: 1000,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  creature.activateAndTrace(
    new Float32Array([1e-9, 9e-10]),
    false,
    sparseConfig,
  );
  creature.propagate(new Float32Array([0.5]), config, sparseConfig);

  const runnerUp = creature.state.connection(RUNNER_UP_INDEX, OUTPUT_INDEX);
  assertNoGradientToUnusedSynapse(runnerUp, "MAXIMUM");
  assert(runnerUp.count > 0, "close runner-up must receive leaked gradient");
});

Deno.test("MINIMUM: no gradient reaches an unused synapse after a WASM trace (#3640)", () => {
  const creature = twoInputExtremum("MINIMUM");
  const config = createBackPropagationConfig({
    generations: 1,
    disableRandomSamples: true,
    batchSize: 1000,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  creature.activateAndTrace(
    new Float32Array([-1e-9, -9e-10]),
    false,
    sparseConfig,
  );
  creature.propagate(new Float32Array([-0.5]), config, sparseConfig);

  const runnerUp = creature.state.connection(RUNNER_UP_INDEX, OUTPUT_INDEX);
  assertNoGradientToUnusedSynapse(runnerUp, "MINIMUM");
  assert(runnerUp.count > 0, "close runner-up must receive leaked gradient");
});
