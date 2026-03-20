/**
 * Tests for Predictive Coding trace tags.
 *
 * Issue #1913: Verifies that PC training adds trace tags (approach,
 * pc-energy, pc-inference-steps, pc-changed) to the trained creature,
 * and that standard backprop does NOT add PC-specific tags.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import { trainDir } from "../../src/architecture/Training.ts";
import { Costs } from "../../src/Costs.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "../../src/config/PredictiveCodingConfig.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";

/** Helper: creates a simple creature and data directory for XOR-like data. */
function makeTestFixture() {
  const creature = new Creature(2, 1, {
    layers: [{ count: 3 }],
  });

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  return { creature, dataSetDir };
}

Deno.test("PC training adds approach tag to trace", () => {
  const { creature, dataSetDir } = makeTestFixture();

  try {
    const options: TrainOptions = {
      iterations: 3,
      targetError: 0.001,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
      },
    };

    const result = trainDir(creature, dataSetDir, options, Costs.find("MSE"));
    const approach = getTag(result.trace, "approach");
    assertEquals(
      approach,
      "predictive-coding",
      "Trace should have PC approach tag",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("PC training adds energy tag to trace", () => {
  const { creature, dataSetDir } = makeTestFixture();

  try {
    const options: TrainOptions = {
      iterations: 3,
      targetError: 0.001,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
      },
    };

    const result = trainDir(creature, dataSetDir, options, Costs.find("MSE"));
    const energy = getTag(result.trace, "pc-energy");
    assertNotEquals(energy, null, "Trace should have pc-energy tag");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("PC training adds inference steps tag to trace", () => {
  const { creature, dataSetDir } = makeTestFixture();

  try {
    const options: TrainOptions = {
      iterations: 3,
      targetError: 0.001,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
      },
    };

    const result = trainDir(creature, dataSetDir, options, Costs.find("MSE"));
    const steps = getTag(result.trace, "pc-inference-steps");
    assertNotEquals(steps, null, "Trace should have pc-inference-steps tag");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("PC training adds changed tag to trace", () => {
  const { creature, dataSetDir } = makeTestFixture();

  try {
    const options: TrainOptions = {
      iterations: 3,
      targetError: 0.001,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
      },
    };

    const result = trainDir(creature, dataSetDir, options, Costs.find("MSE"));
    const changed = getTag(result.trace, "pc-changed");
    assertNotEquals(changed, null, "Trace should have pc-changed tag");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("PC tags survive JSON export/import round-trip", () => {
  const { creature, dataSetDir } = makeTestFixture();

  try {
    const options: TrainOptions = {
      iterations: 3,
      targetError: 0.001,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
      },
    };

    const result = trainDir(creature, dataSetDir, options, Costs.find("MSE"));

    // Round-trip through JSON serialisation
    const jsonString = JSON.stringify(result.trace);
    const restored = JSON.parse(jsonString);
    const restoredCreature = Creature.fromJSON(restored);

    assertEquals(
      getTag(restoredCreature, "approach"),
      "predictive-coding",
      "Approach tag should survive round-trip",
    );
    assertNotEquals(
      getTag(restoredCreature, "pc-energy"),
      null,
      "Energy tag should survive round-trip",
    );
    assertNotEquals(
      getTag(restoredCreature, "pc-inference-steps"),
      null,
      "Inference steps tag should survive round-trip",
    );
    assertNotEquals(
      getTag(restoredCreature, "pc-changed"),
      null,
      "Changed tag should survive round-trip",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("PC tags are added to compact output when available", () => {
  const { creature, dataSetDir } = makeTestFixture();

  try {
    const options: TrainOptions = {
      iterations: 3,
      targetError: 0.001,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
      },
    };

    const result = trainDir(creature, dataSetDir, options, Costs.find("MSE"));

    if (result.compact) {
      const approach = getTag(result.compact, "approach");
      assertEquals(
        approach,
        "predictive-coding",
        "Compact should have PC approach tag",
      );
    }
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

Deno.test("Standard backprop does NOT add PC-specific tags", () => {
  const { creature, dataSetDir } = makeTestFixture();

  try {
    const options: TrainOptions = {
      iterations: 2,
      disableRandomSamples: true,
    };

    const result = trainDir(creature, dataSetDir, options, Costs.find("MSE"));

    assertEquals(
      getTag(result.trace, "approach"),
      null,
      "Standard backprop should NOT have approach tag",
    );
    assertEquals(
      getTag(result.trace, "pc-energy"),
      null,
      "Standard backprop should NOT have pc-energy tag",
    );
    assertEquals(
      getTag(result.trace, "pc-inference-steps"),
      null,
      "Standard backprop should NOT have pc-inference-steps tag",
    );
    assertEquals(
      getTag(result.trace, "pc-changed"),
      null,
      "Standard backprop should NOT have pc-changed tag",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});
