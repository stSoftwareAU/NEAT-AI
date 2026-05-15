/**
 * Regression test for Issue #2669: when `creature.activate` throws a
 * {@link WasmError} mid-episode (the cached WASM compile cache returned
 * `null` because the topology trapped the WASM loader), the RL fitness
 * scorer MUST drop the creature with `-Infinity` reward instead of
 * crashing the surrounding evolve loop.
 *
 * The compile cache already logged the offending uuid and asked callers to
 * "drop the creature or repair its topology before retrying"; this test
 * verifies the RL scorer honours that contract.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { RLEpisodeFitness } from "@creature/RLEpisodeFitness.ts";
import { WasmError } from "@errors/WasmError.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import { initWasmForTests } from "../_initWasm.ts";

// ---------------------------------------------------------------------------
// Minimal adapter — single input, single output, one step then terminate.
// The body never runs because the creature traps on the very first activate.
// ---------------------------------------------------------------------------

class TrivialAdapter extends EpisodeAdapter<{ step: number }, number> {
  override reset(
    _rngSeed: number,
  ): { observation: Float32Array; state: { step: number } } {
    return { observation: new Float32Array([0]), state: { step: 0 } };
  }

  override step(
    state: { step: number },
    _action: number,
  ): StepResult<Float32Array> & { state: { step: number } } {
    const next = { step: state.step + 1 };
    return {
      observation: new Float32Array([next.step]),
      reward: 1,
      terminated: next.step >= 3,
      truncated: false,
      state: next,
    };
  }

  override get observationLength(): number {
    return 1;
  }

  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }
}

function makeCreature(): Creature {
  return new Creature(1, 1, { layers: [{ count: 2 }] });
}

/**
 * Replace `creature.activate` with a stub that throws the supplied error on
 * every call. Simulates the "WASM compile cache returned null" trap path
 * observed in Issue #2669 without requiring an actually-malformed creature.
 */
function patchActivateToThrow(creature: Creature, error: Error): void {
  // The runtime only requires `(input, feedbackLoop) => Float32Array`; throw
  // synchronously to mirror `activateWasm`'s behaviour when the cached WASM
  // module fails to instantiate.
  creature.activate = ((_input: Float32Array, _feedbackLoop?: boolean) => {
    throw error;
  }) as Creature["activate"];
}

Deno.test(
  "RLEpisodeFitness.calculate: WasmError from activate drops the creature (inline path)",
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

    const fitness = new RLEpisodeFitness({
      adapter: new TrivialAdapter(),
      growth: 0,
    });
    fitness.setSeedSet([1, 2, 3]);

    // The whole point of #2669: this must not throw. Before the fix the
    // WasmError propagated out of `collectTrialsInline` and crashed the
    // worker with an uncaught promise rejection.
    await fitness.calculate([creature]);

    // The creature was scored and dropped (score < 0 because reward is
    // -Infinity for every seed → error is +Infinity → score is heavily
    // penalised). Specifically: not `undefined` and not `+Infinity`.
    assertEquals(typeof creature.score, "number");
    assertEquals(Number.isFinite(creature.score!), false);
  },
);

Deno.test(
  "RLEpisodeFitness.calculate: ActivationError from activate still drops the creature (inline path)",
  async () => {
    // Regression guard: the existing ActivationError branch must keep
    // working after the #2669 fix folded both error types into one catch.
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

    const fitness = new RLEpisodeFitness({
      adapter: new TrivialAdapter(),
      growth: 0,
    });
    fitness.setSeedSet([42]);

    await fitness.calculate([creature]);

    assertEquals(typeof creature.score, "number");
    assertEquals(Number.isFinite(creature.score!), false);
  },
);

Deno.test(
  "RLEpisodeFitness.calculate: non-typed errors still propagate",
  async () => {
    // Generic errors (programming bugs) must keep crashing the run so they
    // surface in CI instead of being silently swallowed.
    await initWasmForTests();

    const creature = makeCreature();
    patchActivateToThrow(creature, new TypeError("unexpected bug"));

    const fitness = new RLEpisodeFitness({
      adapter: new TrivialAdapter(),
      growth: 0,
    });
    fitness.setSeedSet([1]);

    let caught: Error | undefined;
    try {
      await fitness.calculate([creature]);
    } catch (err) {
      caught = err as Error;
    }

    assertEquals(caught instanceof TypeError, true);
    assertEquals(caught?.message, "unexpected bug");
  },
);
