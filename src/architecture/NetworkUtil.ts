import { NetworkInterface } from "./NetworkInterface.ts";
import { Network } from "./network.js";
import { DataRecordInterface } from "./DataSet.ts";
import { NeatConfigInterface } from "../config.ts";
import { yellow } from "https://deno.land/std@0.126.0/fmt/colors.ts";
import { WorkerHandle } from "../multithreading/workers/WorkerHandle.ts";
import Neat from "../neat.js";
import { addTag, addTags, getTag } from "../tags/TagsInterface.ts";
import { makeDataDir } from "../architecture/DataSet.ts";

/**
 * Evolves the network to reach a lower error on a dataset
 */
export async function evolveDir(
  network: NetworkInterface,
  dataSetDir: string,
  options: NeatConfigInterface,
) {
  // Read the options
  options = options || {};
  let targetError = typeof options.error !== "undefined" ? options.error : 0.05;
  const growth = typeof options.growth !== "undefined"
    ? options.growth
    : 0.0001;

  const costName = options.costName || "MSE";

  /** At least 1 and whole numbers only */
  const threads = Math.round(
    Math.max(
      options.threads ? options.threads : navigator.hardwareConcurrency,
      1,
    ),
  );

  const start = Date.now();

  const endTimeMS = options.timeoutMinutes
    ? start + Math.max(1, options.timeoutMinutes) * 60_000
    : 0;

  if (
    typeof options.iterations === "undefined" &&
    typeof options.error === "undefined"
  ) {
    throw new Error(
      "At least one of the following options must be specified: error, iterations",
    );
  } else if (typeof options.error === "undefined") {
    targetError = -1; // run until iterations
  } else if (typeof options.iterations === "undefined") {
    options.iterations = 0; // run until target error
  }

  const workers: WorkerHandle[] = [];

  for (let i = threads; i--;) {
    workers.push(new WorkerHandle(dataSetDir, costName, threads == 1));
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
              ) * growth;

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

  options.fitnessPopulation = true;

  // Intialise the NEAT instance
  options.network = network;
  const neat = new Neat(
    network.input,
    network.output,
    fitnessFunction,
    options,
  );

  let error = -Infinity;
  let bestScore = -Infinity;
  let bestCreature = null;

  let iterationStartMS = new Date().getTime();

  while (
    error < -targetError &&
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
    network.nodes = bestCreature.nodes;
    network.connections = bestCreature.connections;
    network.selfconns = bestCreature.selfconns;
    network.gates = bestCreature.gates;
    addTags(network, bestCreature);

    if (options.clear && network.clear) network.clear();
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
export async function evolveDataSet(
  network: NetworkInterface,
  dataSet: DataRecordInterface[],
  options: NeatConfigInterface,
) {
  if (
    dataSet[0].input.length !== network.input ||
    dataSet[0].output.length !== network.output
  ) {
    throw new Error(
      "Dataset input(" + dataSet[0].input.length + ")/output(" +
        dataSet[0].output.length + ") size should be same as network input(" +
        network.input + ")/output(" + network.output + ") size!",
    );
  }

  const dataSetDir = makeDataDir(dataSet);

  const result = await evolveDir(network, dataSetDir, options);

  await Deno.remove(dataSetDir, { recursive: true });

  return result;
}

export function testDir(
  network: NetworkInterface,
  dataDir: string,
  // deno-lint-ignore ban-types
  cost: Function,
) {
  // Check if dropout is enabled, set correct mask

  if (network.dropout) {
    for (let i = network.nodes.length; i--;) {
      const node = network.nodes[i];
      if (
        node.type === "hidden" || node.type === "constant"
      ) {
        node.mask = 1 - network.dropout;
      }
    }
  }

  let error = 0;
  let counter = 0;

  //const promises = [];
  for (const dirEntry of Deno.readDirSync(dataDir)) {
    if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
      const fn = dataDir + "/" + dirEntry.name;

      // const p = Deno.readTextFile(fn).then((txt) => {
      const json = JSON.parse(Deno.readTextFileSync(fn));

      const len = json.length;

      for (let i = len; i--;) {
        const data = json[i];
        const input = data.input;
        const target = data.output;
        if (!network.noTraceActivate) throw "no trace function";
        const output = network.noTraceActivate(input);
        error += cost(target, output);
      }
      counter += len;
    }
  }

  // await Promise.all(promises);
  const avgError = error / counter;
  const results = {
    error: avgError,
  };

  return results;
}
