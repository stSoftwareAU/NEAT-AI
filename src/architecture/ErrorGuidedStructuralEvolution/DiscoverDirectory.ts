import { assert } from "@std/assert/assert";
import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { Creature } from "../../Creature.ts";
import type { NeatOptions } from "../../config/NeatOptions.ts";
import { CreatureUtil } from "../CreatureUtils.ts";
import type { DataRecordInterface } from "../DataSet.ts";
import type { DiscoverResult } from "./DiscoverResult.ts";
import { DiscoverStructure } from "./DiscoverStructure.ts";

export async function recordDirectory(
  creature: Creature,
  dataDir: string,
  options: NeatOptions,
) {
  const recorder = new DataRecorder(creature, options);
  return await recorder.recordDirectory(dataDir);
}

class DataRecorder {
  private BYTES_PER_RECORD: number;
  private BATCH_SIZE: number;
  private sampleRate: number;
  private discoveryBatchSize: number;
  private ID: string;
  private timeoutTS: number;
  private discoveryMaxNeurons: number;
  constructor(
    private creature: Creature,
    private options: NeatOptions,
  ) {
    this.BYTES_PER_RECORD = (creature.input + creature.output) * 4;
    const discoveryBufferSize = options.discoveryBufferSize || 128 * 1024;
    this.BATCH_SIZE = Math.max(
      1,
      Math.floor(discoveryBufferSize / this.BYTES_PER_RECORD),
    );

    this.sampleRate = Math.min(
      1,
      Math.max(0.0001, options.discoverySampleRate!),
    );
    this.discoveryBatchSize = options.discoveryBatchSize || 512;

    this.ID = CreatureUtil.makeUUID(creature).slice(-8);

    this.timeoutTS = options.discoveryTimeOutMinutes
      ? Date.now() + options.discoveryTimeOutMinutes * 60 * 1000
      : 0;

    this.discoveryMaxNeurons = Math.max(
      1,
      options.discoveryMaxNeurons || 6,
    );
  }

  private shuffleFiles(files: string[]): string[] {
    for (let i = files.length; i--;) {
      const j = Math.floor(Math.random() * (i + 1));
      [files[i], files[j]] = [files[j], files[i]];
    }
    return files;
  }

  private async getBinaryFiles(dataDir: string): Promise<string[]> {
    const binaryFiles: string[] = [];
    const entries = await Array.fromAsync(Deno.readDir(dataDir));

    for (const dirEntry of entries) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".bin")) {
        binaryFiles.push(`${dataDir}/${dirEntry.name}`);
      }
    }

    return this.shuffleFiles(binaryFiles);
  }

  private fp(percentage: number): string {
    return yellow(
      Math.abs(1 - percentage) < Number.EPSILON
        ? "100%"
        : (percentage * 100).toFixed(1) + "%",
    );
  }

  async recordDirectory(dataDir: string): Promise<DiscoverResult> {
    const binaryFiles = await this.getBinaryFiles(dataDir);
    assert(
      binaryFiles.length > 0,
      "No binary files found in the data directory",
    );

    return await this.recordFiles(binaryFiles);
  }

  private async processFile(
    filePath: string,
    discoverStructure: DiscoverStructure,
    params: {
      counter: { count: number };
      dataSet: DataRecordInterface[];
      neuronPromisesMap: Map<string, Promise<void>>;
    },
  ) {
    if (this.options.log) {
      console.log(`Discovery ${blue(this.ID)} processing ${filePath}`);
    }

    const { creature } = this;
    let readTime = 0;
    const file = await Deno.open(filePath, { read: true });
    try {
      const stat = await file.stat();
      const fileRecords = stat.size / this.BYTES_PER_RECORD;
      const sampleSize = Math.ceil(fileRecords * this.sampleRate);

      const tmpIndexes = Int32Array.from({ length: fileRecords }, (_, i) => i);
      CreatureUtil.shuffle(tmpIndexes);
      const recordSet = new Set(tmpIndexes.slice(0, sampleSize));

      const batchBuffer = new Uint8Array(
        this.BATCH_SIZE * this.BYTES_PER_RECORD,
      );
      const batchArray = new Float32Array(batchBuffer.buffer);

      let batchStart = 0;
      while (
        batchStart < fileRecords && recordSet.size &&
        (!this.timeoutTS || Date.now() <= this.timeoutTS)
      ) {
        const batchSize = Math.min(this.BATCH_SIZE, fileRecords - batchStart);

        const readStartTime = Date.now();
        const bytesRead = file.readSync(
          batchBuffer.subarray(0, batchSize * this.BYTES_PER_RECORD),
        );
        readTime += Date.now() - readStartTime;
        if (bytesRead === null) break;
        assert(bytesRead > 0, "Invalid number of bytes read");

        const recordsRead = Math.floor(bytesRead / this.BYTES_PER_RECORD);

        for (let j = 0; j < recordsRead && recordSet.size; j++) {
          const recordIndex = batchStart + j;
          if (!recordSet.delete(recordIndex)) continue;
          params.counter.count++;

          const offset = j * (creature.input + creature.output);
          const data: DataRecordInterface = {
            input: batchArray.subarray(offset, offset + creature.input),
            output: batchArray.subarray(
              offset + creature.input,
              offset + creature.input + creature.output,
            ),
          };
          params.dataSet.push(data);

          if (params.dataSet.length >= this.discoveryBatchSize) {
            discoverStructure.record(
              params.dataSet.splice(0),
              params.neuronPromisesMap,
            );
            assert(params.dataSet.length === 0, "Data set not empty");
            // deno-lint-ignore no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        batchStart += batchSize;
      }

      // Clear large buffers and arrays to help GC
      // @ts-ignore - clearing to help GC
      batchBuffer.fill(0);
      // @ts-ignore - clearing to help GC
      batchArray.fill(0);
      // @ts-ignore - clearing to help GC
      tmpIndexes.fill(0);
      recordSet.clear();
    } finally {
      file.close();
    }

    if (this.options.log) {
      console.log(
        `Discovery ${blue(this.ID)} read time ${
          yellow(format(readTime, { ignoreZero: true }))
        } for ${filePath} with ${params.counter.count} records`,
      );
    }
  }

  private async recordFiles(binaryFiles: string[]): Promise<DiscoverResult> {
    const { creature, options } = this;
    const startTime = Date.now();
    if (options.log) {
      console.info(
        `Discovery ${
          blue(this.ID)
        } with ${binaryFiles.length} binary files, sample rate: ${
          this.fp(this.sampleRate)
        }, batch size: ${
          yellow(this.discoveryBatchSize.toLocaleString("en-AU"))
        }`,
      );
    }

    const discoverStructure = new DiscoverStructure(creature);
    const neuronPromisesMap: Map<string, Promise<void>> = new Map();

    const initializeStartTime = Date.now();
    discoverStructure.initialize(neuronPromisesMap);
    if (options.log) {
      const initializeTime = Date.now() - initializeStartTime;
      console.log(
        `Discovery ${blue(this.ID)} initialize time ${
          yellow(format(initializeTime, { ignoreZero: true }))
        }`,
      );
    }
    try {
      const counter = { count: 0 };

      const dataSet: DataRecordInterface[] = [];

      for (const filePath of binaryFiles) {
        // deno-lint-ignore no-await-in-loop
        await this.processFile(filePath, discoverStructure, {
          counter,
          dataSet,
          neuronPromisesMap: neuronPromisesMap,
        });
      }

      if (dataSet.length > 0) {
        discoverStructure.record(dataSet, neuronPromisesMap);
      }

      // Clear large arrays to help GC
      dataSet.length = 0;

      if (options.log) {
        const scannedTime = Date.now() - startTime;
        console.log(
          `Discovery ${blue(this.ID)} scanning time ${
            yellow(format(scannedTime, { ignoreZero: true }))
          }`,
        );
      }
      await Promise.all([...neuronPromisesMap.values()]);

      // Clear the promises map to help GC
      neuronPromisesMap.clear();

      if (options.log) {
        const recordTime = Date.now() - startTime;
        console.log(
          `Discovery ${blue(this.ID)} recorded time ${
            yellow(format(recordTime, { ignoreZero: true }))
          }`,
        );
      }

      const discoverResult: DiscoverResult = {
        ID: this.ID,
        addHelpfulSynapses: undefined,
        removeHarmfulSynapse: undefined,
        candidateSquashes: undefined,
      };

      const analyzeStartTime = Date.now();

      const addHelpfulSynapse = await discoverStructure.analyze(
        this.discoveryMaxNeurons,
      );
      if (options.log) {
        const analyzeTime = Date.now() - analyzeStartTime;
        console.log(
          `Discovery ${blue(this.ID)} analyze time ${
            yellow(format(analyzeTime, { ignoreZero: true }))
          } found ${
            addHelpfulSynapse ? addHelpfulSynapse.length : 0
          } candidates`,
        );
      }

      if (addHelpfulSynapse) {
        discoverResult.addHelpfulSynapses = addHelpfulSynapse;
      }

      const harmfulStartTime = Date.now();
      const removeHarmfulSynapse = await discoverStructure
        .analyzeSynapsesForRemoval(
          this.discoveryMaxNeurons,
        );
      if (options.log) {
        const harmfulTime = Date.now() - harmfulStartTime;
        console.log(
          `Discovery ${blue(this.ID)} analyze harmful time ${
            yellow(format(harmfulTime, { ignoreZero: true }))
          } found ${removeHarmfulSynapse ? 1 : 0} candidates`,
        );
      }
      if (removeHarmfulSynapse) {
        discoverResult.removeHarmfulSynapse = removeHarmfulSynapse;
      }

      const squashStartTime = Date.now();
      const candidateSquashes = await discoverStructure
        .analyzeNeuronsSquashes(
          this.discoveryMaxNeurons,
        );
      if (options.log) {
        const squashTime = Date.now() - squashStartTime;
        const squashCount = candidateSquashes ? candidateSquashes.length : 0;
        let squashSummaryText = "";
        if (squashCount > 0) {
          assert(candidateSquashes, "No candidate squashes");
          const squashSummary = candidateSquashes.map((candidate) => {
            return `${candidate.neuronUUID} ${candidate.previousSquash} -> ${candidate.squash} improved: ${
              (candidate.expectedImprovementPercentage * 100).toFixed(1)
            }% error: ${candidate.currentError.toFixed(4)} -> ${
              candidate.improvedError.toFixed(4)
            }`;
          });
          squashSummaryText = `, Summary: ${squashSummary.join(",")}`;
        }
        console.log(
          `Discovery ${blue(this.ID)} analyze squashes time ${
            yellow(format(squashTime, { ignoreZero: true }))
          } found ${squashCount} candidate${
            squashCount === 1 ? "" : "s"
          }${squashSummaryText}`,
        );
      }
      if (candidateSquashes) {
        discoverResult.candidateSquashes = candidateSquashes;
      }

      return discoverResult;
    } finally {
      await discoverStructure.cleanUp();
    }
  }
}
