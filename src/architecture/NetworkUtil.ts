import { NetworkInterface } from "./NetworkInterface.ts";
import { Network } from "./network.js";
import { DataRecordInterface } from "./DataSet.ts";
import { NeatConfigInterface } from "../config.ts";
import { yellow } from "https://deno.land/std@0.126.0/fmt/colors.ts";
import { WorkerHandle } from "../multithreading/workers/WorkerHandle.ts";
import Neat from "../neat.js";
import { addTags } from "../tags/TagsInterface.ts";
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
          const genome = queue.shift();
          if (!genome) continue;
          const result = await worker.evaluate(genome) as number;
          genome.score = -result;
          genome.score -= (
            genome.nodes.length -
            genome.input -
            genome.output +
            genome.connections.length +
            (genome.gates ? genome.gates.length : 0)
          ) * growth;

          genome.score = isNaN(genome.score) ? -Infinity : genome.score;
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
  let bestFitness = -Infinity;
  let bestGenome = null;

  let iterationStartMS = new Date().getTime();
  while (
    error < -targetError &&
    (!options.iterations || neat.generation < options.iterations)
  ) {
    const fittest = await neat.evolve(bestGenome);

    const fitness = fittest.score;
    error = fitness +
      (fittest.nodes.length - fittest.input - fittest.output +
          fittest.connections.length + (fittest.gates
            ? fittest.gates.length
            : 0)) * growth;

    if (fitness > bestFitness) {
      bestFitness = fitness;
      bestGenome = Network.fromJSON(fittest.toJSON());
    }

    if (options.log && neat.generation % options.log === 0) {
      const now = new Date().getTime();
      console.log(
        "iteration",
        neat.generation,
        "fitness",
        fitness,
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
        fitness: fitness,
        error: -error,
        iteration: neat.generation,
      });
    }
  }

  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    w.terminate();
  }
  workers.length = 0; // Release the memory.

  if (bestGenome) {
    network.nodes = bestGenome.nodes;
    network.connections = bestGenome.connections;
    network.selfconns = bestGenome.selfconns;
    network.gates = bestGenome.gates;
    addTags(network, bestGenome);

    if (options.clear && network.clear) network.clear();
  }

  return {
    error: -error,
    score: bestFitness,
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

export async function testDir(
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
  //   if (!network ||!network.noTraceActivate) throw "no trace function";

  //   const noTraceActivate = network.noTraceActivate;

  let error = 0;
  let counter = 0;

  const promises = [];
  for (const dirEntry of Deno.readDirSync(dataDir)) {
    if (dirEntry.isFile) {
      const fn = dataDir + "/" + dirEntry.name;

      const p = Deno.readTextFile(fn).then((txt) => {
        const json = JSON.parse(txt);
        const len = json.length;
        let partionError = 0;
        for (let i = 0; i < len; i++) { // Order matters for some reason.
          const data = json[i];
          const input = data.input;
          const target = data.output;
          if (!network.noTraceActivate) throw "no trace function";
          const output = network.noTraceActivate(input);
          partionError += cost(target, output);
        }

        return {
          error: partionError,
          counter: len,
        };
      });

      promises.push(p);
    }
  }

  const pResults = await Promise.all(promises);

  pResults.forEach((r) => {
    error += r.error;
    counter += r.counter;
  });

  const avgError = error / counter;
  const results = {
    error: avgError,
  };

  return results;
}
