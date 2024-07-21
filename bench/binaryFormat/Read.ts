import { binaryFilePath, numObservations, numOutputs } from "./Constants.ts";
import { assert, assertAlmostEquals } from "@std/assert";

// Function to read and process the binary dataset asynchronously
async function readAndProcessBinaryDataset(
  filePath: string,
  numObservations: number,
  numOutputs: number,
) {
  const file = await Deno.open(filePath, { read: true });
  const BYTES_PER_RECORD = (numObservations + numOutputs) * 4; // Each float is 4 bytes

  let totalRecords = 0;

  const array = new Float32Array(numObservations + numOutputs);
  const uint8Array = new Uint8Array(array.buffer);

  async function readNextRecord() {
    const bytesRead = await file.read(uint8Array);
    if (bytesRead === null || bytesRead === 0) {
      return null;
    }
    if (bytesRead !== BYTES_PER_RECORD) {
      throw new Error(
        `Invalid number of bytes read ${bytesRead} expected ${BYTES_PER_RECORD}`,
      );
    }

    return {
      observations: array.slice(0, numObservations),
      outputs: array.slice(numObservations),
    };
  }

  async function processRecord(
    indx: number,
    observations: Float32Array,
    outputs: Float32Array,
  ) {
    // Simulate asynchronous operation
    await Promise.resolve();

    assert(
      observations.length === numObservations,
      `Invalid number of observations ${observations.length} expected ${numObservations}`,
    );
    assert(
      outputs.length === numOutputs,
      `Invalid number of outputs ${outputs.length} expected ${numOutputs}`,
    );
    observations.forEach((value, i) => {
      assertAlmostEquals(value, indx + i / 1000);
    });
    outputs.forEach((value, i) => {
      const expected = (indx + i / 1000) * -1;
      assertAlmostEquals(
        value,
        expected,
        0.1,
        `Output ${i} mismatch ${value} != ${expected}`,
      );
    });
  }

  let readPromise = readNextRecord();
  const startTime = Date.now();

  for (let indx = 0; true; indx++) {
    const result = await readPromise;

    if (result === null) break;

    readPromise = readNextRecord(); // Start reading the next record
    await processRecord(indx, result.observations, result.outputs); // Process the current record
    totalRecords++;
  }

  const endTime = Date.now();
  console.log(
    `Reading and processing binary dataset took ${
      (endTime - startTime) / 1000
    } seconds.`,
  );
  console.log(`Total records processed: ${totalRecords}`);

  file.close();
}

await readAndProcessBinaryDataset(binaryFilePath, numObservations, numOutputs);
