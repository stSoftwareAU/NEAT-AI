import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  cleanupFoldSplits,
  createKFoldSplits,
} from "../../src/architecture/KFoldSplitter.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";

/**
 * Helper: creates a simple dataset with the given number of records.
 */
function createTestDataDir(recordCount: number, inputs = 2, outputs = 1) {
  const dataSet = [];
  for (let i = 0; i < recordCount; i++) {
    const input = new Float32Array(inputs);
    const output = new Float32Array(outputs);
    // Use index as a marker so we can verify record distribution
    input[0] = i;
    output[0] = i % 2;
    dataSet.push({ input, output });
  }
  return makeDataDir(dataSet, 2000, { input: inputs, output: outputs });
}

/**
 * Count total records across all .bin files in a directory.
 */
function countRecords(dir: string, bytesPerRecord: number): number {
  let total = 0;
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.isFile && entry.name.endsWith(".bin")) {
      const stat = Deno.statSync(`${dir}/${entry.name}`);
      total += stat.size / bytesPerRecord;
    }
  }
  return total;
}

Deno.test("KFoldSplitter - k=1 returns original directory", () => {
  const dataDir = createTestDataDir(20);
  try {
    const splits = createKFoldSplits(dataDir, 2, 1, 1);
    assertEquals(splits.length, 1);
    assertEquals(splits[0].trainDir, dataDir);
    assertEquals(splits[0].validationDir, dataDir);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("KFoldSplitter - k=5 creates 5 folds", () => {
  const dataDir = createTestDataDir(50);
  const bytesPerRecord = (2 + 1) * 4;
  try {
    const splits = createKFoldSplits(dataDir, 2, 1, 5);
    assertEquals(splits.length, 5);

    for (const split of splits) {
      const trainCount = countRecords(split.trainDir, bytesPerRecord);
      const valCount = countRecords(split.validationDir, bytesPerRecord);
      // Each fold: 40 training + 10 validation = 50 total
      assertEquals(trainCount + valCount, 50);
      assertEquals(valCount, 10);
      assertEquals(trainCount, 40);
    }

    cleanupFoldSplits(splits, dataDir);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("KFoldSplitter - handles uneven record distribution", () => {
  const dataDir = createTestDataDir(13);
  const bytesPerRecord = (2 + 1) * 4;
  try {
    const splits = createKFoldSplits(dataDir, 2, 1, 3);
    assertEquals(splits.length, 3);

    // 13 records / 3 folds: folds have 5, 4, 4 records
    for (const split of splits) {
      const trainCount = countRecords(split.trainDir, bytesPerRecord);
      const valCount = countRecords(split.validationDir, bytesPerRecord);
      assertEquals(trainCount + valCount, 13);
      assert(
        valCount >= 4 && valCount <= 5,
        `Validation fold size: ${valCount}`,
      );
    }

    cleanupFoldSplits(splits, dataDir);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("KFoldSplitter - rejects folds < 1", () => {
  const dataDir = createTestDataDir(10);
  try {
    assertThrows(
      () => createKFoldSplits(dataDir, 2, 1, 0),
      Error,
      "between 1 and 20",
    );
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("KFoldSplitter - rejects folds > 20", () => {
  const dataDir = createTestDataDir(30);
  try {
    assertThrows(
      () => createKFoldSplits(dataDir, 2, 1, 21),
      Error,
      "between 1 and 20",
    );
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("KFoldSplitter - rejects more folds than records", () => {
  const dataDir = createTestDataDir(3);
  try {
    assertThrows(
      () => createKFoldSplits(dataDir, 2, 1, 5),
      Error,
      "Not enough records",
    );
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("KFoldSplitter - k=2 creates two complementary folds", () => {
  const dataDir = createTestDataDir(20);
  const bytesPerRecord = (2 + 1) * 4;
  try {
    const splits = createKFoldSplits(dataDir, 2, 1, 2);
    assertEquals(splits.length, 2);

    // Each fold should have 10 training + 10 validation
    for (const split of splits) {
      const trainCount = countRecords(split.trainDir, bytesPerRecord);
      const valCount = countRecords(split.validationDir, bytesPerRecord);
      assertEquals(trainCount, 10);
      assertEquals(valCount, 10);
    }

    cleanupFoldSplits(splits, dataDir);
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("KFoldSplitter - cleanup removes temporary directories", () => {
  const dataDir = createTestDataDir(20);
  try {
    const splits = createKFoldSplits(dataDir, 2, 1, 3);

    // Verify directories exist
    for (const split of splits) {
      const trainStat = Deno.statSync(split.trainDir);
      assert(trainStat.isDirectory);
      const valStat = Deno.statSync(split.validationDir);
      assert(valStat.isDirectory);
    }

    const dirs = splits.map((s) => [s.trainDir, s.validationDir]).flat();
    cleanupFoldSplits(splits, dataDir);

    // Verify temporary directories are removed
    for (const dir of dirs) {
      if (dir === dataDir) continue;
      assertThrows(() => Deno.statSync(dir), Deno.errors.NotFound);
    }
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});
