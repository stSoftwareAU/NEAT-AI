import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { ValidationError } from "../../src/errors/ValidationError.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import {
  evolveDir,
  evolveEnv,
  evolveRL,
} from "../../src/creature/CreatureTraining.ts";
import { assertEvolveCallerUsable } from "../../src/creature/EvolveTeardown.ts";
import type { LegacyEpisodeAdapter } from "../../src/creature/EpisodicFitnessTypes.ts";
import {
  EpisodeAdapter,
  type StepResult,
} from "../../src/creature/EpisodeAdapter.ts";
import { Neat } from "../../src/NEAT/Neat.ts";

// Issue #4078: each `evolve*` entry point must reject an unusable caller
// creature before any signal listener, worker or population exists, so the
// caller's original genome is never altered. The populate stub counts calls
// and fails loudly, so a missing check cannot quietly run a real evolution.

const INPUT = 2;
const OUTPUT = 1;

/** A valid 2-input, 1-output creature with a small hidden layer. */
function validCreature(): Creature {
  return new Creature(INPUT, OUTPUT, { layers: [{ count: 3 }] });
}

/** Fewer neurons than `input + output`. */
function tooFewNeuronsCreature(): Creature {
  const creature = validCreature();
  creature.neurons.length = 1;
  assert(
    creature.neurons.length < creature.input + creature.output,
    "precondition: the fixture must have too few neurons",
  );
  return creature;
}

/** Enough neurons, but a synapse names a neuron that does not exist. */
function failsValidateCreature(): Creature {
  const creature = validCreature();
  creature.synapses[0].to = 999;
  assertThrows(
    () => creature.validate(),
    Error,
    "does not name a neuron",
    "precondition: validate() must reject the fixture",
  );
  return creature;
}

/** Pre-call copy of everything the entry point could alter. */
interface CallerState {
  uuids: (string | undefined)[];
  synapses: {
    from: number;
    to: number;
    weight: number;
    type: string | undefined;
  }[];
  input: number;
  output: number;
}

function captureState(creature: Creature): CallerState {
  return {
    uuids: creature.neurons.map((neuron) => neuron.uuid),
    synapses: creature.synapses.map((synapse) => ({
      from: synapse.from,
      to: synapse.to,
      weight: synapse.weight,
      type: synapse.type,
    })),
    input: creature.input,
    output: creature.output,
  };
}

/** Dataset matching the creature's 2-input, 1-output shape. */
function tinyDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

/** Single-tick 2-input, 1-output episodic adapter that is never run. */
function buildEnvAdapter(): LegacyEpisodeAdapter<null, number> {
  return {
    inputCount: INPUT,
    outputCount: OUTPUT,
    maxSteps: 1,
    reset(_seed?: number): null {
      return null;
    },
    observe(_state: null): Float32Array {
      return new Float32Array([1.0, 1.0]);
    },
    decode(output: Float32Array): number {
      return output[0];
    },
    step(_state: null, action: number) {
      return { state: null, reward: -Math.abs(action - 99), done: true };
    },
  };
}

/** Single-tick 2-observation RL adapter that is never run. */
class TwoObservationAdapter extends EpisodeAdapter<null, number> {
  override reset(_seed: number): { observation: Float32Array; state: null } {
    return { observation: new Float32Array([1.0, 1.0]), state: null };
  }
  override step(
    _state: null,
    action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0, 0]),
      reward: -Math.abs(action - 99),
      terminated: true,
      truncated: false,
      state: null,
    };
  }
  override get observationLength(): number {
    return 2;
  }
  override decodeAction(creatureOutput: Float32Array): number {
    return creatureOutput[0];
  }
  override maxSteps(): number {
    return 1;
  }
}

const OPTIONS = {
  populationSize: 6,
  iterations: 500,
  timeoutMinutes: 5,
  threads: 1,
};

/**
 * Run one entry point against one unusable fixture and assert it is refused
 * with the named reason, the caller is untouched, and population was never built.
 */
async function assertRefusedUntouched(
  label: string,
  build: () => Creature,
  reasonPart: string,
  invoke: (
    creature: Creature,
    dataSetDir: string,
    creatureStore: string,
  ) => Promise<unknown>,
): Promise<void> {
  const creature = build();
  const before = captureState(creature);
  const dataSetDir = makeDataDir(tinyDataSet(), 2000);
  const creatureStore = await Deno.makeTempDir({ prefix: "neat-4078-" });
  const originalPopulate = Neat.prototype.populatePopulation;
  let populateCalls = 0;
  Neat.prototype.populatePopulation = ((_creature: Creature) => {
    populateCalls++;
    return Promise.reject(new Error("populatePopulation reached"));
  }) as Neat["populatePopulation"];

  try {
    const error = await assertRejects(
      () => invoke(creature, dataSetDir, creatureStore),
      ValidationError,
      `${label}: caller creature is unusable (`,
    );
    assertStringIncludes(error.message, reasonPart);
    assertEquals(error.reason, "OTHER");
    assertEquals(
      captureState(creature),
      before,
      "the caller must keep its original neurons, synapses, input and output",
    );
    assertEquals(
      populateCalls,
      0,
      "no population may be built for an unusable caller",
    );
  } finally {
    Neat.prototype.populatePopulation = originalPopulate;
    await Deno.remove(dataSetDir, { recursive: true });
    await Deno.remove(creatureStore, { recursive: true });
  }
}

const invokeDir = (
  creature: Creature,
  dataSetDir: string,
  creatureStore: string,
) => evolveDir(creature, dataSetDir, { ...OPTIONS, creatureStore });

const invokeEnv = (
  creature: Creature,
  _dataSetDir: string,
  creatureStore: string,
) =>
  evolveEnv(creature, buildEnvAdapter(), { ...OPTIONS, creatureStore });

const invokeRL = (
  creature: Creature,
  _dataSetDir: string,
  creatureStore: string,
) =>
  evolveRL(creature, new TwoObservationAdapter(), {
    ...OPTIONS,
    creatureStore,
  });

Deno.test({
  name:
    "evolveDir: a caller with too few neurons is refused untouched (Issue #4078)",
  fn: () =>
    assertRefusedUntouched(
      "evolveDir",
      tooFewNeuronsCreature,
      "neurons.length",
      invokeDir,
    ),
});

Deno.test({
  name:
    "evolveDir: a caller failing validate() is refused untouched (Issue #4078)",
  fn: () =>
    assertRefusedUntouched(
      "evolveDir",
      failsValidateCreature,
      "validate() failed",
      invokeDir,
    ),
});

Deno.test({
  name:
    "evolveEnv: a caller with too few neurons is refused untouched (Issue #4078)",
  fn: () =>
    assertRefusedUntouched(
      "evolveEnv",
      tooFewNeuronsCreature,
      "neurons.length",
      invokeEnv,
    ),
});

Deno.test({
  name:
    "evolveEnv: a caller failing validate() is refused untouched (Issue #4078)",
  fn: () =>
    assertRefusedUntouched(
      "evolveEnv",
      failsValidateCreature,
      "validate() failed",
      invokeEnv,
    ),
});

Deno.test({
  name:
    "evolveRL: a caller with too few neurons is refused untouched (Issue #4078)",
  fn: () =>
    assertRefusedUntouched(
      "evolveRL",
      tooFewNeuronsCreature,
      "neurons.length",
      invokeRL,
    ),
});

Deno.test({
  name:
    "evolveRL: a caller failing validate() is refused untouched (Issue #4078)",
  fn: () =>
    assertRefusedUntouched(
      "evolveRL",
      failsValidateCreature,
      "validate() failed",
      invokeRL,
    ),
});

Deno.test("assertEvolveCallerUsable accepts a valid caller (Issue #4078)", () => {
  assertEvolveCallerUsable(validCreature(), "evolveDir");
});

Deno.test("assertEvolveCallerUsable throws ValidationError naming too few neurons (Issue #4078)", () => {
  const error = assertThrows(
    () => assertEvolveCallerUsable(tooFewNeuronsCreature(), "evolveEnv"),
    ValidationError,
    "evolveEnv: caller creature is unusable (neurons.length",
  );
  assertEquals(error.reason, "OTHER");
});

Deno.test("assertEvolveCallerUsable throws ValidationError naming validate() (Issue #4078)", () => {
  const error = assertThrows(
    () => assertEvolveCallerUsable(failsValidateCreature(), "evolveRL"),
    ValidationError,
    "evolveRL: caller creature is unusable (validate() failed",
  );
  assertEquals(error.reason, "OTHER");
});
