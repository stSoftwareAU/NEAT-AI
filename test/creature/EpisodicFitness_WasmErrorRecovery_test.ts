/**
 * Regression test for Issue #2669 — legacy `EpisodicFitness` scorer
 * counterpart.
 *
 * When `creature.activate` throws a {@link WasmError} (the cached WASM
 * compile returned `null` because the topology trapped the WASM loader),
 * the legacy episodic scorer MUST drop the creature with `-Infinity`
 * reward instead of crashing the surrounding evolve loop. The WASM
 * compile cache already logged the offending uuid and asked callers to
 * "drop the creature or repair its topology before retrying"; this test
 * verifies the legacy scorer honours that contract.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { EpisodicFitness } from "@creature/EpisodicFitness.ts";
import type { LegacyEpisodeAdapter } from "@creature/EpisodicFitnessTypes.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import { WasmError } from "@errors/WasmError.ts";
import { initWasmForTests } from "../_initWasm.ts";

const trivialAdapter: LegacyEpisodeAdapter<{ step: number }, number> = {
  inputCount: 1,
  outputCount: 1,
  maxSteps: 5,
  reset(_seed?: number) {
    return { step: 0 };
  },
  observe(_state) {
    return new Float32Array([0]);
  },
  decode(_output) {
    return 0;
  },
  step(state, _action) {
    const next = { step: state.step + 1 };
    return { state: next, reward: 1, done: next.step >= 3 };
  },
};

function makeCreature(): Creature {
  return new Creature(1, 1, { layers: [{ count: 2 }] });
}

function patchActivateToThrow(creature: Creature, error: Error): void {
  creature.activate = ((_input: Float32Array, _feedbackLoop?: boolean) => {
    throw error;
  }) as Creature["activate"];
}

Deno.test(
  "EpisodicFitness.calculate: WasmError from activate drops the creature",
  async () => {
    await initWasmForTests();

    const creature = makeCreature();
    patchActivateToThrow(
      creature,
      new WasmError(
        "WASM activation was selected but failed to instantiate CompiledNetwork",
        "ACTIVATION_FAILED",
      ),
    );

    const fitness = new EpisodicFitness({
      adapter: trivialAdapter,
      growth: 0,
      trialsPerScore: 2,
      initialPerturbation: 0,
      baseSeed: 1,
      rewardToError: (reward) => Math.max(0, -reward),
    });

    // Before #2669 this propagated the WasmError out of `calculate()` and
    // crashed the surrounding `evolve` loop. After the fix it must drop
    // the creature with a non-finite score and return normally.
    await fitness.calculate([creature]);

    assertEquals(typeof creature.score, "number");
    assertEquals(Number.isFinite(creature.score!), false);
  },
);

Deno.test(
  "EpisodicFitness.calculate: ActivationError from activate still drops the creature",
  async () => {
    await initWasmForTests();

    const creature = makeCreature();
    patchActivateToThrow(
      creature,
      new ActivationError(
        "non-finite result from RELU",
        "NON_FINITE_RESULT",
        "RELU",
        Number.NaN,
      ),
    );

    const fitness = new EpisodicFitness({
      adapter: trivialAdapter,
      growth: 0,
      trialsPerScore: 1,
      initialPerturbation: 0,
      baseSeed: 1,
      rewardToError: (reward) => Math.max(0, -reward),
    });

    await fitness.calculate([creature]);

    assertEquals(typeof creature.score, "number");
    assertEquals(Number.isFinite(creature.score!), false);
  },
);
