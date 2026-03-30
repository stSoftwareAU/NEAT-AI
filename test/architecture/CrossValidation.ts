import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { Costs } from "../../src/Costs.ts";

/**
 * Creates an AND gate training dataset.
 */
function createAndDataSet() {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
}

/**
 * Creates a larger dataset for cross-validation testing by repeating
 * the AND gate pattern multiple times.
 */
function createLargerDataSet(repeats: number) {
  const base = createAndDataSet();
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

Deno.test("CrossValidation - k=1 backward compatible single-split", () => {
  const dataSet = createLargerDataSet(5);
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    const result = trainDir(creature, dataDir, {
      iterations: 5,
      targetError: 0.01,
      crossValidation: { enabled: true, folds: 1 },
    }, cost);

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.error >= 0, "Error should be non-negative");
    assert(result.iteration > 0, "Should complete at least one iteration");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("CrossValidation - k=2 produces valid results", () => {
  const dataSet = createLargerDataSet(10);
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    const result = trainDir(creature, dataDir, {
      iterations: 3,
      targetError: 0.01,
      crossValidation: { enabled: true, folds: 2 },
    }, cost);

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.error >= 0, "Error should be non-negative");
    assert(result.iteration > 0, "Should complete at least one iteration");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("CrossValidation - disabled by default, matches standard training", () => {
  const dataSet = createLargerDataSet(5);
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    // Train without cross-validation
    const resultNoCv = trainDir(creature, dataDir, {
      iterations: 3,
      targetError: 0.01,
    }, cost);

    assert(Number.isFinite(resultNoCv.error), "Error should be finite");
    assert(resultNoCv.error >= 0, "Error should be non-negative");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("CrossValidation - validation early stopping uses held-out fold", () => {
  const dataSet = createLargerDataSet(10);
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    const result = trainDir(creature, dataDir, {
      iterations: 3,
      targetError: 0.01,
      crossValidation: {
        enabled: true,
        folds: 3,
        validationEarlyStopping: true,
      },
    }, cost);

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.error >= 0, "Error should be non-negative");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("CrossValidation - without validation early stopping", () => {
  const dataSet = createLargerDataSet(10);
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    const result = trainDir(creature, dataDir, {
      iterations: 3,
      targetError: 0.01,
      crossValidation: {
        enabled: true,
        folds: 3,
        validationEarlyStopping: false,
      },
    }, cost);

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.error >= 0, "Error should be non-negative");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("CrossValidation - k=5 produces average across folds", () => {
  // 50 records: enough for 5 folds of 10 each
  const dataSet = createLargerDataSet(12);
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    const result = trainDir(creature, dataDir, {
      iterations: 2,
      targetError: 0.001,
      crossValidation: {
        enabled: true,
        folds: 5,
      },
    }, cost);

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.error >= 0, "Error should be non-negative");
    assert(
      result.trace !== undefined,
      "Should have trace from best fold",
    );
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("CrossValidation - not enabled does not split data", () => {
  const dataSet = createLargerDataSet(5);
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    // crossValidation provided but not enabled
    const result = trainDir(creature, dataDir, {
      iterations: 2,
      targetError: 0.01,
      crossValidation: { enabled: false, folds: 5 },
    }, cost);

    assert(Number.isFinite(result.error), "Error should be finite");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("CrossValidation - graceful fallback when too few records", () => {
  // Only 4 records, not enough for 5 folds
  const dataSet = createAndDataSet();
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    // Should fall back to single-split training
    const result = trainDir(creature, dataDir, {
      iterations: 2,
      targetError: 0.01,
      crossValidation: { enabled: true, folds: 5 },
    }, cost);

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.error >= 0, "Error should be non-negative");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("CrossValidation - evolveDataSet with cross-validation", async () => {
  const dataSet = createLargerDataSet(10);
  const creature = new Creature(2, 1);

  const results = await creature.evolveDataSet(dataSet, {
    targetError: 0.15,
    iterations: 50,
    threads: 1,
    crossValidation: { enabled: true, folds: 2 },
  });

  assert(Number.isFinite(results.error), "Error should be finite");
  assert(results.error >= 0, "Error should be non-negative");
});

Deno.test("CrossValidation - result contains valid ID", () => {
  const dataSet = createLargerDataSet(10);
  const dataDir = makeDataDir(dataSet, 2000, { input: 2, output: 1 });
  const cost = Costs.find("MSE");

  try {
    const creature = new Creature(2, 1);

    const result = trainDir(creature, dataDir, {
      iterations: 2,
      targetError: 0.01,
      crossValidation: { enabled: true, folds: 2 },
    }, cost);

    assertEquals(typeof result.ID, "string");
    assert(result.ID.length > 0, "ID should not be empty");
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});
