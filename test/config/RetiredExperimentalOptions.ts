/**
 * Issue #3874: `crossValidation`, `dataFuzzing` and `dataQuantisation` were
 * off-by-default experiments with no adopter. 7.0.0 retires them.
 *
 * These tests pin the post-removal behaviour: the resolved config carries no
 * such keys, and a caller that still passes them (untyped, e.g. from JSON)
 * trains exactly as if they were absent instead of silently taking a
 * different code path.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

const RETIRED_KEYS = [
  "crossValidation",
  "dataFuzzing",
  "dataQuantisation",
] as const;

/** The retired options, as an untyped caller would still supply them. */
const RETIRED_OPTIONS = {
  crossValidation: { enabled: true, folds: 2, validationEarlyStopping: true },
  dataFuzzing: { enabled: true, inputNoiseScale: 0.5, outputNoiseScale: 0.5 },
  dataQuantisation: { enabled: true, inputLevels: 2, outputLevels: 2 },
};

/** AND gate records, repeated to give the trainer something to chew on. */
function createDataSet(repeats: number) {
  const base = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataSet = [];
  for (let i = 0; i < repeats; i++) {
    for (const record of base) {
      dataSet.push({
        input: new Float32Array(record.input),
        output: new Float32Array(record.output),
      });
    }
  }
  return dataSet;
}

Deno.test("Retired options - resolved config carries no retired keys", () => {
  const config = createNeatConfig({});
  for (const key of RETIRED_KEYS) {
    assertEquals(
      Object.hasOwn(config, key),
      false,
      `${key} must not survive on the resolved config`,
    );
  }
});

Deno.test("Retired options - supplying them does not resurrect them", () => {
  const config = createNeatConfig(
    { ...RETIRED_OPTIONS } as unknown as NeatOptions,
  );
  for (const key of RETIRED_KEYS) {
    assertEquals(
      Object.hasOwn(config, key),
      false,
      `${key} must be ignored, not parsed back onto the config`,
    );
  }
});

Deno.test("Retired options - trainDir ignores them", () => {
  const dataDir = makeDataDir(createDataSet(10), 2000, {
    input: 2,
    output: 1,
  });
  const cost = Costs.find("MSE");

  try {
    const seed = new Creature(2, 1).exportJSON();
    const baseOptions: TrainOptions = {
      iterations: 3,
      targetError: 0.01,
      disableRandomSamples: true,
    };

    // The training loop draws from the global RNG, so re-seed identically
    // before each run: any difference then comes from the options alone.
    setRandomNumberGenerator(createSeededRng(3874));
    const plain = trainDir(
      Creature.fromJSON(seed),
      dataDir,
      baseOptions,
      cost,
    );

    setRandomNumberGenerator(createSeededRng(3874));
    const withRetired = trainDir(
      Creature.fromJSON(seed),
      dataDir,
      {
        ...baseOptions,
        ...(RETIRED_OPTIONS as unknown as TrainOptions),
      },
      cost,
    );

    assert(Number.isFinite(plain.error), "Baseline error should be finite");
    assertEquals(
      withRetired.error,
      plain.error,
      "Retired options must not change the training outcome",
    );
    assertEquals(
      withRetired.iteration,
      plain.iteration,
      "Retired options must not change the iteration count",
    );
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});
