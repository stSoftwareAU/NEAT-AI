import { fail } from "@std/assert";
import type { NeatOptions } from "../mod.ts";
import { createNeatConfig } from "../src/config/NeatConfig.ts";

Deno.test("ConfigValidate: Validate config", () => {
  const invalid: NeatOptions[] = [
    {
      sparseRatio: 2,
    },
    {
      sparseRatio: -0.5,
    },
    {
      feedbackLoop: true,
      disableRandomSamples: false,
    },
    {
      threads: -1,
    },
    {
      log: -1,
    },
    {
      trainPerGen: -1,
    },
    {
      timeoutMinutes: -1,
    },
    {
      dataSetPartitionBreak: -1,
    },
    {
      populationSize: -1,
    },
    {
      elitism: -1,
    },
    {
      maxConns: -1,
    },
    {
      maximumNumberOfNodes: -1,
    },
    {
      mutationRate: -1,
    },
    {
      mutationAmount: -1,
    },
    {
      iterations: -1,
    },
    {
      trainingBatchSize: -1,
    },
    {
      trainingSampleRate: -1,
    },
    {
      targetError: -0.5,
    },
    {
      maximumBiasAdjustmentScale: -0.1,
    },
    {
      maximumWeightAdjustmentScale: -0.1,
    },
    {
      geneticCompatibilityThreshold: 2,
    },
  ];

  const wrongType = {
    dataSetPartitionBreak: "abc",
  };
  invalid.push((wrongType as unknown) as NeatOptions);

  invalid.forEach((config) => {
    let valid = false;
    try {
      createNeatConfig(config);
      valid = true;
    } catch (_e) {
      // Expected
    }
    if (valid) {
      fail(`Config ${JSON.stringify(config)} should be invalid`);
    }
  });
});
