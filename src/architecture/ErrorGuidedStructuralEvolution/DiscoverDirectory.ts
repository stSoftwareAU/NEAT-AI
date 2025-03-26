import { assert } from "@std/assert/assert";
import { blue, yellow } from "@std/fmt/colors";
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

  constructor(
    private creature: Creature,
    private options: NeatOptions,
  ) {
    this.BYTES_PER_RECORD = (creature.input + creature.output) * 4;
    this.BATCH_SIZE = Math.max(
      1,
      Math.floor((128 * 1024) / this.BYTES_PER_RECORD),
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
    for await (const dirEntry of Deno.readDir(dataDir)) {
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

  private async readBatch(
    file: Deno.FsFile,
    batchBuffer: Uint8Array,
    batchSize: number,
  ): Promise<number | null> {
    return await file.read(
      batchBuffer.subarray(0, batchSize * this.BYTES_PER_RECORD),
    );
  }

  private async processFile(
    filePath: string,
    discoverStructure: DiscoverStructure,
    params: {
      counter: { count: number };
      dataSet: DataRecordInterface[];
      promises: Promise<void>[];
    },
  ) {
    const { creature } = this;
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
        // deno-lint-ignore no-await-in-loop
        const bytesRead = await this.readBatch(file, batchBuffer, batchSize);
        if (!bytesRead) break;

        const recordsRead = Math.floor(bytesRead / this.BYTES_PER_RECORD);

        for (let j = 0; j < recordsRead && recordSet.size; j++) {
          const recordIndex = batchStart + j;
          if (!recordSet.delete(recordIndex)) continue;
          params.counter.count++;

          const offset = j * (creature.input + creature.output);
          const data: DataRecordInterface = {
            input: Array.from(
              batchArray.subarray(offset, offset + creature.input),
            ),
            output: Array.from(
              batchArray.subarray(
                offset + creature.input,
                offset + creature.input + creature.output,
              ),
            ),
          };
          params.dataSet.push(data);

          if (params.dataSet.length >= this.discoveryBatchSize) {
            params.promises.push(
              discoverStructure.record(params.dataSet.splice(0)),
            );
          }
        }
        batchStart += batchSize;
      }
    } finally {
      file.close();
    }
  }

  private async recordFiles(binaryFiles: string[]): Promise<DiscoverResult> {
    const { creature, options } = this;

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
    await discoverStructure.initialize();

    const counter = { count: 0 };
    const promises: Promise<void>[] = [];
    const dataSet: DataRecordInterface[] = [];

    await Promise.all(
      binaryFiles.map((filePath) =>
        this.processFile(filePath, discoverStructure, {
          counter,
          dataSet,
          promises,
        })
      ),
    );

    if (dataSet.length > 0) {
      promises.push(discoverStructure.record(dataSet));
    }

    await Promise.all(promises);

    const focusUUID = creature.neurons[
      creature.neurons.length - 1 - Math.floor(creature.output * Math.random())
    ].uuid;

    const enhanced = await discoverStructure.analyze(focusUUID);

    await discoverStructure.cleanUp();

    return {
      ID: this.ID,
      enhanced: enhanced ? enhanced.exportJSON() : undefined,
    };
  }
}
