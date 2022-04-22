import { NetworkInterface } from "./NetworkInterface.ts";
import { Network } from "./network.js";
import { DataRecordInterface } from "./DataSet.ts";
import { make as makeConfig, NeatOptions } from "../config.ts";
import { yellow } from "https://deno.land/std@0.126.0/fmt/colors.ts";
import { WorkerHandle } from "../multithreading/workers/WorkerHandle.ts";
import { Neat } from "../neat.js";
import { addTag, addTags, getTag } from "../tags/TagsInterface.ts";
import { makeDataDir } from "../architecture/DataSet.ts";
// import { crypto } from "https://deno.land/std@0.136.0/crypto/mod.ts";
// import { encode } from "https://deno.land/std@0.136.0/encoding/base64.ts";
import { ensureDirSync } from "https://deno.land/std@0.136.0/fs/ensure_dir.ts";
/**
 * Evolves the network to reach a lower error on a dataset
 */
export async function evolveDir(
  network: NetworkInterface,
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
    network.nodes = bestCreature.nodes;
    network.connections = bestCreature.connections;
    network.selfconns = bestCreature.selfconns;
    network.gates = bestCreature.gates;
    addTags(network, bestCreature);

    if (options.clear && network.clear) network.clear();
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

/**
 * Evolves the network to reach a lower error on a dataset
 */
export async function evolveDataSet(
  network: NetworkInterface,
  dataSet: DataRecordInterface[],
  options: NeatOptions,
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
      if (!network.noTraceActivate) throw "no trace function";
      const output = network.noTraceActivate(input);
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
