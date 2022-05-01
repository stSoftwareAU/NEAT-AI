import { NetworkInterface } from "./NetworkInterface.ts";
import { Network } from "./network.js";
import { DataRecordInterface } from "./DataSet.ts";
import { make as makeConfig } from "../config/NeatConfig.ts";
import { NeatOptions } from "../config/NeatOptions.ts";

import { yellow } from "https://deno.land/std@0.137.0/fmt/colors.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { Neat } from "../neat.js";
import { addTags, getTag } from "../tags/TagsInterface.ts";
import { makeDataDir } from "../architecture/DataSet.ts";

import { TrainOptions } from "../config/TrainOptions.ts";
import { findCost, findRatePolicy } from "../config.ts";
import { emptyDirSync } from "https://deno.land/std@0.137.0/fs/empty_dir.ts";

export class NetworkUtil {
  private network;
  constructor(
    network: NetworkInterface,
  ) {
    this.network = network;
  }

  /**
   * Backpropagate the network
   */
  propagate(rate: number, momentum: number, update: boolean, target: number[]) {
    if (
      typeof target === "undefined" || target.length !== this.network.output
    ) {
      throw new Error(
        "Output target length should match network output length",
      );
    }

    let targetIndex = target.length;

    // Propagate output nodes
    for (
      let i = this.network.nodes.length - 1;
      i >= this.network.nodes.length - this.network.output;
      i--
    ) {
      const n = this.network.nodes[i];
      n.propagate(
        rate,
        momentum,
        update,
        target[--targetIndex],
      );
    }

    // Propagate hidden and input nodes
    for (
      let i = this.network.nodes.length - this.network.output - 1;
      i >= this.network.input;
      i--
    ) {
      const n = this.network.nodes[i];
      n.propagate(rate, momentum, update);
    }
  }

  /**
   * Evolves the network to reach a lower error on a dataset
   */
  async evolveDir(
    dataSetDir: string,
    options: NeatOptions,
  ) {
    const config = makeConfig(options);
    // Read the options

    const start = Date.now();

    const endTimeMS = config.timeoutMinutes
      ? start + Math.max(1, config.timeoutMinutes) * 60_000
      : 0;

    const workers: WorkerHandler[] = [];

    for (let i = config.threads; i--;) {
      workers.push(
        new WorkerHandler(dataSetDir, config.costName, config.threads == 1),
      );
    }

    // Intialise the NEAT instance
    options.network = this.network;
    const neat = new Neat(
      this.network.input,
      this.network.output,
      options,
      workers,
    );

    let error = -Infinity;
    let bestScore = -Infinity;
    let bestCreature = null;

    let iterationStartMS = new Date().getTime();

    while (
      error < config.targetError &&
      (!options.iterations || neat.generation < options.iterations)
    ) {
      const fittest = await neat.evolve(bestCreature);

      if (fittest.score > bestScore) {
        const errorTmp = getTag(fittest, "error");
        if (errorTmp) {
          error = Number.parseFloat(errorTmp);
        } else {
          throw "No error: " + errorTmp;
        }

        bestScore = fittest.score;
        bestCreature = Network.fromJSON(fittest.toJSON());
      } else if (fittest.score < bestScore) {
        throw "fitness decreased over generations";
      }
      const timedOut = endTimeMS ? Date.now() > endTimeMS : false;

      if (options.log && (neat.generation % options.log === 0 || timedOut)) {
        const now = new Date().getTime();
        console.log(
          "iteration",
          neat.generation,
          "score",
          fittest.score,
          "error",
          -error,
          "avg time",
          yellow(
            new Intl.NumberFormat().format(
              Math.round((now - iterationStartMS) / options.log),
            ) + " ms",
          ),
        );

        iterationStartMS = new Date().getTime();
      }

      if (
        options.schedule && neat.generation % options.schedule.iterations === 0
      ) {
        options.schedule.function({
          score: fittest.score,
          error: -error,
          iteration: neat.generation,
        });
      }
      if (timedOut) break;
    }

    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      w.terminate();
    }
    workers.length = 0; // Release the memory.

    if (bestCreature) {
      this.network.nodes = bestCreature.nodes;
      this.network.connections = bestCreature.connections;
      this.network.selfconns = bestCreature.selfconns;
      this.network.gates = bestCreature.gates;
      addTags(this.network, bestCreature);

      if (options.clear && this.network.clear) this.network.clear();
    }

    if (config.creatureStore) {
      this.writeCreatures(neat, config.creatureStore);
    }
    return {
      error: -error,
      score: bestScore,
      iterations: neat.generation,
      time: Date.now() - start,
    };
  }

  /**
   * Evolves the network to reach a lower error on a dataset
   */
  async evolveDataSet(
    dataSet: DataRecordInterface[],
    options: NeatOptions,
  ) {
    if (
      dataSet[0].input.length !== this.network.input ||
      dataSet[0].output.length !== this.network.output
    ) {
      throw new Error(
        "Dataset input(" + dataSet[0].input.length + ")/output(" +
          dataSet[0].output.length + ") size should be same as network input(" +
          this.network.input + ")/output(" + this.network.output + ") size!",
      );
    }

    const dataSetDir = makeDataDir(dataSet);

    const result = await this.evolveDir(dataSetDir, options);

    await Deno.remove(dataSetDir, { recursive: true });

    return result;
  }

  /**
   * Tests a set and returns the error and elapsed time
   */
  testDir(
    dataDir: string,
    // deno-lint-ignore ban-types
    cost: Function,
  ) {
    // Check if dropout is enabled, set correct mask

    if (this.network.dropout) {
      for (let i = this.network.nodes.length; i--;) {
        const node = this.network.nodes[i];
        if (
          node.type === "hidden" || node.type === "constant"
        ) {
          node.mask = 1 - this.network.dropout;
        }
      }
    }

    let error = 0;
    let counter = 0;

    const files: string[] = [];

    for (const dirEntry of Deno.readDirSync(dataDir)) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
        files.push(dirEntry.name);
      }
    }

    files.sort();

    files.forEach((name) => {
      const fn = dataDir + "/" + name;

      const json = JSON.parse(Deno.readTextFileSync(fn));
      if (json.length == 0) {
        throw "Set size must be positive";
      }
      const len = json.length;

      for (let i = len; i--;) {
        const data = json[i];
        const input = data.input;
        const target = data.output;
        if (!this.network.noTraceActivate) throw "no trace function";
        const output = this.network.noTraceActivate(input);
        error += cost(target, output);
      }
      counter += len;
    });

    const avgError = error / counter;
    const results = {
      error: avgError,
    };

    return results;
  }

  /**
   * Train the given set to this network
   */
  trainDir(
    dataDir: string,
    options: TrainOptions,
  ) {
    options = options || {};
    // Warning messages
    if (typeof options.iterations === "undefined") {
      console.warn(
        "No target iterations given, running until error is reached!",
      );
    }

    // Read the options
    const targetError = options.error || 0.05;
    const cost = findCost(options.cost ? options.cost : "MSE");
    const baseRate = options.rate || 0.3;
    const dropout = options.dropout || 0;
    const momentum = options.momentum || 0;
    const batchSize = options.batchSize || 1; // online learning
    const ratePolicyName = options.ratePolicy ? options.ratePolicy : "FIXED";
    const ratePolicy = findRatePolicy(ratePolicyName);

    const iterations = options.iterations ? options.iterations : 0;

    const files: string[] = [];

    for (const dirEntry of Deno.readDirSync(dataDir)) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
        files.push(dirEntry.name);
      }
    }

    files.sort();
    // Loops the training process
    let currentRate = 0.3;
    let iteration = 0;
    let error = 1;

    while (
      isFinite(error) &&
      error > targetError &&
      (iterations === 0 || iteration < iterations)
    ) {
      // if (options.crossValidate && error <= options.crossValidate.testError) break;

      iteration++;

      // Update the rate
      currentRate = ratePolicy(baseRate, iteration);

      if (!isFinite(currentRate)) throw "not a valid rate: " + currentRate;

      let counter = 0;
      let errorSum = 0;

      files.forEach((name) => {
        if (!isFinite(errorSum)) return;
        const fn = dataDir + "/" + name;

        const json = JSON.parse(Deno.readTextFileSync(fn));
        if (json.length == 0) {
          throw "Set size must be positive";
        }
        const len = json.length;

        for (let i = len; i--;) {
          const data = json[i];
          const input = data.input;
          const target = data.output;
          const update = !!((i + 1) % batchSize === 0 || i === 0);

          if (!this.network.activate) throw "no activate funtion";
          const output = this.network.activate(input, true);

          errorSum += cost(target, output);
          if (!isFinite(errorSum)) break;

          this.propagate(currentRate, momentum, update, target);
        }

        counter += len;
      });

      error = errorSum / counter;

      if (
        options.log && (
          iteration % options.log === 0 ||
          iteration === iterations
        )
      ) {
        console.log(
          "iteration",
          iteration,
          "error",
          error,
          "rate",
          currentRate,
          "clear",
          options.clear ? true : false,
          "policy",
          yellow(ratePolicyName),
          "momentum",
          momentum,
        );
      }
    }

    if (options.clear && this.network.clear) this.network.clear();

    if (dropout) {
      for (let i = 0; i < this.network.nodes.length; i++) {
        if (
          this.network.nodes[i].type === "hidden" ||
          this.network.nodes[i].type === "constant"
        ) {
          this.network.nodes[i].mask = 1 - this.network.dropout;
        }
      }
    }

    return {
      error: error,
    };
  }

  /**
   * Train the given set to this network
   */
  train(
    dataSet: DataRecordInterface[],
    options: TrainOptions,
  ) {
    if (
      dataSet[0].input.length !== this.network.input ||
      dataSet[0].output.length !== this.network.output
    ) {
      throw new Error(
        "Dataset input/output size should be same as network input/output size!",
      );
    }

    const dataSetDir = makeDataDir(dataSet);

    const result = this.trainDir(dataSetDir, options);

    Deno.removeSync(dataSetDir, { recursive: true });

    return result;
  }

  private writeCreatures(neat: Neat, dir: string) {
    let counter = 1;
    emptyDirSync(dir);
    neat.population.forEach((creature: NetworkInterface) => {
      const json = creature.toJSON();

      const txt = JSON.stringify(json, null, 1);

      const filePath = dir + "/" + counter + ".json";
      Deno.writeTextFileSync(filePath, txt);

      counter++;
    });
  }
}
