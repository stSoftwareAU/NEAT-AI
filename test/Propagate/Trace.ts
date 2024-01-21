import { yellow } from "https://deno.land/std@0.212.0/fmt/colors.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Trace", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );

  const json = creature.exportJSON();

  stats(json);
  const config = new BackPropagationConfig({
    useAverageDifferenceBias: "Yes",
    learningRate: 0.02,
  });
  creature.applyLearnings(config);
  const json2 = creature.exportJSON();
  stats(json2);
  compare(json, json2);
  Deno.writeTextFileSync(
    "test/data/.learned.json",
    JSON.stringify(json2, null, 2),
  );
});

function stats(creature: CreatureExport) {
  const biases: number[] = [];
  const weights: number[] = [];

  creature.nodes.forEach((node) => {
    if (node.bias) {
      biases.push(node.bias);
    }
  });
  creature.connections.forEach((c) => {
    if (c.weight) {
      weights.push(c.weight);
    }
  });

  const sortedBiases = [...biases].sort((a, b) => a - b);
  const sortedWeights = [...weights].sort((a, b) => a - b);

  const biasRange = [
    quantile(sortedBiases, 0.025),
    quantile(sortedBiases, 0.975),
  ];

  console.info(
    `Bias Min ${yellow(sortedBiases[0].toFixed(3))}, Max: ${
      yellow(sortedBiases[sortedBiases.length - 1].toFixed(3))
    }`,
  );
  console.info(`Bias range for 95% of data: ${biasRange}`);

  const weightRange = [
    quantile(sortedWeights, 0.025),
    quantile(sortedWeights, 0.975),
  ];
  console.info(
    `Weight Min ${yellow(sortedWeights[0].toFixed(3))}, Max: ${
      yellow(sortedWeights[sortedWeights.length - 1].toFixed(3))
    }`,
  );
  console.info(`Weight range for 95% of data: ${weightRange}`);

  const biasMean = mean(biases);
  const weightMean = mean(weights);

  const biasMedian = median(sortedBiases);
  const weightMedian = median(sortedWeights);

  const biasStdDev = stdDev(biases);
  const weightStdDev = stdDev(weights);

  console.info(`Bias mean: ${biasMean}`);
  console.info(`Weight mean: ${weightMean}`);

  console.info(`Bias median: ${biasMedian}`);
  console.info(`Weight median: ${weightMedian}`);

  console.info(`Bias standard deviation: ${biasStdDev}`);
  console.info(`Weight standard deviation: ${weightStdDev}`);
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr: number[]): number {
  const mid = Math.floor(arr.length / 2);
  const nums = [...arr].sort((a, b) => a - b);
  return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function stdDev(arr: number[]): number {
  const arrMean = mean(arr);
  const sum = arr.reduce((a, b) => a + Math.pow(b - arrMean, 2), 0);
  return Math.sqrt(sum / (arr.length - 1));
}

function compare(creature1: CreatureExport, creature2: CreatureExport) {
  creature1.nodes.forEach((node) => {
    const node2 = creature2.nodes.find((node2) => node2.uuid == node.uuid);
    if (!node2) {
      console.info(`Node not found: ${node.uuid}`);
    } else {
      const b1 = node.bias ? node.bias : 0;
      const b2 = node2.bias ? node2.bias : 0;

      if (Math.abs(b1 - b2) > 0.0001) {
        const msg = `${node.uuid} Bias mismatch: ${b1.toFixed(4)} vs ${
          b2.toFixed(4)
        }`;
        console.info(msg);
        // throw new Error(msg);
      }
      // if (node.squash != node2.squash) {
      //   throw new Error(
      //     `${node.uuid} Squash mismatch: ${node.squash} vs ${node2.squash}`,
      //   );
      // }
    }
  });
}

function quantile(arr: number[], q: number) {
  const sorted = arr.sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  } else {
    return sorted[base];
  }
}
