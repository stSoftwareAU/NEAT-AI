import { assert } from "@std/assert/assert";
import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { Creature } from "../../Creature.ts";
import type { NeatOptions } from "../../config/NeatOptions.ts";
import { CreatureUtil } from "../CreatureUtils.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import type { DiscoverResult } from "./DiscoverResult.ts";
import { DiscoverStructure } from "./DiscoverStructure.ts";

function dataFiles(dataDir: string) {
  const binaryFiles: string[] = [];

  for (const dirEntry of Deno.readDirSync(dataDir)) {
    if (dirEntry.isFile) {
      const fn = dirEntry.name;
      if (fn.endsWith(".bin")) {
        binaryFiles.push(`${dataDir}/${fn}`);
      }
    }
  }

  const files = binaryFiles;

  for (let i = files.length; i--;) {
    const j = Math.round(Math.random() * i);
    [files[i], files[j]] = [files[j], files[i]];
  }

  return {
    files: binaryFiles,
  };
}

/**
 * Train the given set to this network
 */
export async function recordDirectory(
  creature: Creature,
  dataDir: string,
  options: NeatOptions,
) {
  const dataResult = dataFiles(dataDir);

  assert(
    dataResult.files.length > 0,
    "No binary files found in the data directory",
  );

  return await recordFiles(creature, dataResult.files, options);
}

function fp(percentage: number) {
  if (Math.abs(1 - percentage) < Number.EPSILON) {
    return yellow("100%");
  }

  return yellow((percentage * 100).toFixed(1) + "%");
}

async function recordFiles(
  creature: Creature,
  binaryFiles: string[],
  options: NeatOptions,
): Promise<DiscoverResult> {
  const sampleRate = Math.min(
    1,
    Math.max(0.0001, options.discoverySampleRate || 0),
  );
  const uuid = CreatureUtil.makeUUID(creature);

  const ID = uuid.substring(Math.max(0, uuid.length - 8));
  if (options.log) {
    console.info(
      `Discovery ${blue(ID)} with ${binaryFiles.length} binary file${
        binaryFiles.length > 1 ? "s" : ""
      }, sample rate: ${fp(sampleRate)}`,
    );
  }

  let timeoutTS = 0;
  const startTime = Date.now();
  const discoveryTimeOutMinutes = options.discoveryTimeOutMinutes ?? 0;
  if (discoveryTimeOutMinutes > 0) {
    timeoutTS = startTime + discoveryTimeOutMinutes * 60 * 1000;
  }

  const discoverStructure = new DiscoverStructure(creature);
  await discoverStructure.initialize();
  try {
    const promises: Promise<void>[] = [];
    const valuesCount = creature.input + creature.output;
    const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes
    const SSD_OPTIMAL_READ_SIZE = 128 * 1024; // 128 KB
    const BATCH_SIZE = Math.max(
      1,
      Math.floor(SSD_OPTIMAL_READ_SIZE / BYTES_PER_RECORD),
    );
    const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

    // Shared buffers for batch processing
    const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
    const batchArray = new Float32Array(batchBuffer.buffer);

    const indxMap = new Map<string, Set<number>>();

    let knownSampleCount = -1;
    let counter = 0;
    const startTS = Date.now();
    let lastTS = startTS;

    const dataSet: DataRecordInterface[] = [];
    let totalRecords = 0;
    let recordingStopped = false;
    for (let fileIndx = binaryFiles.length; !recordingStopped && fileIndx--;) {
      const fn = binaryFiles[fileIndx];

      // deno-lint-ignore no-sync-fn-in-async-fn
      const file = Deno.openSync(fn, { read: true });

      try {
        let recordSet = indxMap.get(fn);
        const stat = file.statSync();
        const fileRecords = stat.size / BYTES_PER_RECORD;

        if (!recordSet) {
          totalRecords += fileRecords;
          if (fileIndx === 0) {
            knownSampleCount = totalRecords;
          }
          const len = Math.ceil(fileRecords * sampleRate);
          const tmpIndexes = Int32Array.from(
            { length: fileRecords },
            (_, i) => i,
          ); // Create an array of indices

          CreatureUtil.shuffle(tmpIndexes);
          const indices = tmpIndexes.slice(0, len);

          recordSet = new Set(indices);
          indxMap.set(fn, recordSet);
        }

        let batchStart = 0;

        while (true) {
          counter++;
          const remainingRecords = fileRecords - batchStart;
          if (remainingRecords <= 0) break;

          const batchSize = Math.min(BATCH_SIZE, remainingRecords);
          const bytesRead = file.readSync(
            batchBuffer.subarray(0, batchSize * BYTES_PER_RECORD),
          );
          if (bytesRead === null || bytesRead === 0) break;

          const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);

          for (let j = 0; j < recordsRead; j++) {
            const recordIndex = batchStart + j;
            if (!recordSet.has(recordIndex)) continue;

            const offset = j * valuesCount;
            const observations = batchArray.subarray(
              offset,
              offset + creature.input,
            );

            const data: DataRecordInterface = {
              input: Array.from(observations),
              output: Array.from(
                batchArray.subarray(
                  offset + creature.input,
                  offset + valuesCount,
                ),
              ),
            };
            dataSet.push(data);
            if (dataSet.length >= 512) {
              const p = discoverStructure.record(dataSet.slice());
              dataSet.length = 0;
              promises.push(p);
            }
            const now = Date.now();
            const diff = now - lastTS;

            if (diff > 60_000) {
              lastTS = now;
              const totalTime = now - startTS;
              console.log(
                `Discover ${blue(ID)} samples`,
                yellow(counter.toLocaleString("en-AU")),
                `${
                  knownSampleCount > 0
                    ? "of " + yellow(knownSampleCount.toLocaleString("en-AU")) +
                      " " +
                      yellow(
                        (counter / knownSampleCount * 100).toFixed(1) + "%",
                      )
                    : ""
                }${
                  sampleRate < 1
                    ? "( rate " +
                      yellow((sampleRate * 100).toFixed(1) + "% )")
                    : ""
                }`,
                "time average:",
                yellow(
                  format(totalTime / counter, { ignoreZero: true }),
                ),
                "total:",
                yellow(
                  format(totalTime, { ignoreZero: true }),
                ),
              );
              if (timeoutTS && now > timeoutTS) {
                console.log(
                  `Discover ${blue(ID)} timed out after ${
                    yellow(format(totalTime, { ignoreZero: true }))
                  }`,
                );
                recordingStopped = true;
                break;
              }
            }
          }
          if (recordingStopped) break;
          batchStart += batchSize;
        }
      } finally {
        file.close();
      }
    }
    if (dataSet.length > 0) {
      const p = discoverStructure.record(dataSet.slice());
      dataSet.length = 0;
      promises.push(p);
    }
    await Promise.all(promises);
    if (options.log) {
      const recordTime = Date.now() - startTime;
      console.log(
        `Discover ${blue(ID)} recorded time ${
          yellow(format(recordTime, { ignoreZero: true }))
        }`,
      );
    }
    const focusUUID = creature
      .neurons[
        creature.neurons.length - 1 -
        Math.floor(creature.output * Math.random())
      ].uuid;
    const analyzeStartTime = Date.now();
    const enhanced = await discoverStructure.analyze(focusUUID);
    if (options.log) {
      const analyzeTime = Date.now() - analyzeStartTime;
      console.log(
        `Discover ${blue(ID)} analyze time ${
          yellow(format(analyzeTime, { ignoreZero: true }))
        }`,
      );
    }
    return {
      ID: ID,
      enhanced: enhanced ? enhanced.exportJSON() : undefined,
    };
  } finally {
    await discoverStructure.cleanUp();
  }
}
