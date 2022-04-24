import { NetworkInterface } from "./NetworkInterface.ts";
import { Network } from "./network.js";
import { DataRecordInterface } from "./DataSet.ts";
import { make as makeConfig, NeatOptions } from "../config.ts";
import { yellow } from "https://deno.land/std@0.126.0/fmt/colors.ts";
import { WorkerHandle } from "../multithreading/workers/WorkerHandler.ts";
import { Neat } from "../neat.js";
import { addTag, addTags, getTag } from "../tags/TagsInterface.ts";
import { makeDataDir } from "../architecture/DataSet.ts";
// import { crypto } from "https://deno.land/std@0.136.0/crypto/mod.ts";
// import { encode } from "https://deno.land/std@0.136.0/encoding/base64.ts";
import { ensureDirSync } from "https://deno.land/std@0.136.0/fs/ensure_dir.ts";
import { TrainOptions } from "../TrainOptions.ts";
import { findCost, findRatePolicy } from "../config.ts";

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
      this.network.nodes[i].propagate(
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
      this.network.nodes[i].propagate(rate, momentum, update);
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

    const workers: WorkerHandle[] = [];

    for (let i = config.threads; i--;) {
      workers.push(
        new WorkerHandle(dataSetDir, config.costName, config.threads == 1),
      );
    }

    const fitnessFunction = function (population: NetworkInterface[]) {
      return new Promise((resolve, reject) => {
        // Create a queue
        const queue = population.slice();

        // Start worker function
        const startWorker = async function (worker: WorkerHandle) {
          while (queue.length) {
            const creature = queue.shift();
            if (!creature) continue;
            // const creatureID=population.length - queue.length;
            const result = await worker.evaluate(creature) as number;

            addTag(creature, "error", (-result).toString());
            creature.score = -result - (
                  creature.nodes.length -
                  creature.input -
                  creature.output +
                  creature.connections.length +
                  (creature.gates ? creature.gates.length : 0)
                ) * config.growth;

            creature.score = isNaN(creature.score) ? -Infinity : creature.score;
            // console.info( "Creature", creatureID, "result", result, "score", creature.score);
          }
        };
        const promises = new Array(workers.length);
        for (let i = workers.length; i--;) {
          promises[i] = startWorker(workers[i]);
        }

        Promise.all(promises).then((r) => resolve(r)).catch((reason) =>
          reject(reason)
        );
      });
    };

    // Intialise the NEAT instance
    options.network = this.network;
    const neat = new Neat(
      this.network.input,
      this.network.output,
      fitnessFunction,
      options,
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
      writeCreatures(neat, config.creatureStore);
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

  // /**
  //  * Performs one training epoch and returns the error
  //  * private function used in this.train
  //  */
  // private _trainSet(
  //   dataSet: DataRecordInterface[],
  //   batchSize: number,
  //   currentRate: number,
  //   momentum: number,
  //   // deno-lint-ignore ban-types
  //   costFunction: Function,
  // ): number {
  //   if (dataSet.length == 0) {
  //     throw "Set size must be positive";
  //   }
  //   const activate = this.network.activate;
  //   if (!activate) throw "no activate funtion";

  //   let errorSum = 0;
  //   for (let i = 0; i < dataSet.length; i++) {
  //     const input = dataSet[i].input;
  //     const target = dataSet[i].output;

  //     const update =
  //       !!((i + 1) % batchSize === 0 || (i + 1) === dataSet.length);

  //     const output = activate(input, true);
  //     this.propagate(currentRate, momentum, update, target);

  //     const cost = costFunction(target, output);
  //     if (!isFinite(cost)) {
  //       throw "Invalid cost: " + cost + " of target: " + target + " output: " +
  //         output + " function: " + costFunction;
  //     }
  //     errorSum += cost;
  //   }
  //   const error = errorSum / dataSet.length;
  //   if (!isFinite(error)) {
  //     throw "Invalid error: " + error + ", len: " + dataSet.length;
  //   }
  //   return error;
  // }

  /**
   * Train the given set to this network
   */
  trainDir(
    dataSetDir: string,
    options: TrainOptions,
  ) {
    const start = Date.now();
    options = options || {};
    // Warning messages
    if (typeof options.rate === "undefined") {
      console.warn("Using default learning rate, please define a rate!");
    }
    if (typeof options.iterations === "undefined") {
      console.warn(
        "No target iterations given, running until error is reached!",
      );
    }

    // Read the options
    const targetError = options.error || 0.05;
    const costFunction = findCost(options.cost ? options.cost : "MSE");
    const baseRate = options.rate || 0.3;
    const dropout = options.dropout || 0;
    const momentum = options.momentum || 0;
    const batchSize = options.batchSize || 1; // online learning
    const ratePolicy = findRatePolicy(
      options.ratePolicy ? options.ratePolicy : "FIXED",
    );

    const iterations = options.iterations ? options.iterations : 0;
    // const activate = this.network.activate;
    // if (!this.network.activate) throw "no activate funtion";

    // activate.bind( this);

    // Loops the training process
    let currentRate = 0.3;
    let iteration = 0;
    let error = 1;

    while (
      error > targetError &&
      (iterations === 0 || iteration < iterations)
    ) {
      // if (options.crossValidate && error <= options.crossValidate.testError) break;

      iteration++;

      // Update the rate
      currentRate = ratePolicy(baseRate, iteration);

      if (!isFinite(currentRate)) throw "not a valid rate: " + currentRate;
      // Checks if cross validation is enabled
      // if (options.crossValidate) {
      //   this._trainSet(trainSet, batchSize, currentRate, momentum, cost);
      //   if (options.clear) this.clear();
      //   error = this.test(testSet, cost).error;
      //   if (options.clear) this.clear();
      // } else {
      const files: string[] = [];

      for (const dirEntry of Deno.readDirSync(dataSetDir)) {
        if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
          files.push(dirEntry.name);
        }
      }

      files.sort();
      let counter = 0;

      let errorSum = 0;

      files.forEach((name) => {
        const fn = dataSetDir + "/" + name;

        const dataSet = JSON.parse(Deno.readTextFileSync(fn));

        if (dataSet.length == 0) {
          throw "Set size must be positive";
        }

        for (let i = 0; i < dataSet.length; i++) {
          const input = dataSet[i].input;
          const target = dataSet[i].output;

          const update =
            !!((i + 1) % batchSize === 0 || (i + 1) === dataSet.length);

          if (!this.network.activate) throw "no activate funtion";
          const output = this.network.activate(input, true);
          this.propagate(currentRate, momentum, update, target);

          const cost = costFunction(target, output);
          if (!isFinite(cost)) {
            throw "Invalid cost: " + cost + " of target: " + target +
              " output: " +
              output + " function: " + options.cost;
          }
          errorSum += cost;
        }
        counter += dataSet.length;
      });

      error = errorSum / counter;
      if (!isFinite(error)) {
        throw "Invalid error: " + error + ", len: " + counter;
      }

      if (options.clear && this.network.clear) this.network.clear();
      // }

      // Checks for options such as scheduled logs and shuffling
      // if (options.shuffle) {
      //   for (
      //     let j, x, i = dataSet.length;
      //     i;
      //     j = Math.floor(Math.random() * i),
      //       x = dataSet[--i],
      //       dataSet[i] = dataSet[j],
      //       dataSet[j] = x
      //   );
      // }

      if (options.log && iteration % options.log === 0) {
        console.log(
          "iteration",
          iteration,
          "error",
          error,
          "rate",
          currentRate,
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
      iterations: iteration,
      time: Date.now() - start,
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
}

function writeCreatures(neat: Neat, dir: string) {
  let counter = 1;
  ensureDirSync(dir + "/store");

  neat.population.forEach((creature: NetworkInterface) => {
    const json = creature.toJSON();

    const txt = JSON.stringify(json, null, 1);

    // const b64=encode(new Uint8Array(
    //   await crypto.subtle.digest(
    //     "SHA-256",
    //     new TextEncoder().encode(txt),
    //   ),
    // ) );
    // const name=b64.replaceAll("/", "_").replaceAll("=", "").replaceAll( "+", "-") +".json";

    const filePath = dir + "/" + counter + ".json";
    Deno.writeTextFileSync(filePath, txt);
    // const symPath=dir + "/" +counter +".json";
    // Deno.symlinkSync( filePath, "store/" + name);
    counter++;
  });
}
