import {
  binaryFilePath,
  numObservations,
  numOutputs,
  numRecords,
} from "./Constants.ts";

// Function to generate and write the binary dataset
async function generateBinaryDataset(
  filePath: string,
  numRecords: number,
  numObservations: number,
  numOutputs: number,
) {
  const file = await Deno.open(filePath, {
    write: true,
    create: true,
    truncate: true,
  });
  const observationBuffer = new Float32Array(numObservations);
  const outputBuffer = new Float32Array(numOutputs);

  for (let i = 0; i < numRecords; i++) {
    for (let j = 0; j < numObservations; j++) {
      observationBuffer[j] = i + j / 1000; // Math.random() * 2 - 1; // Generate random float between -1 and 1
    }
    for (let j = 0; j < numOutputs; j++) {
      outputBuffer[j] = (i + j / 1000) * -1; //Math.random() * 2 - 1; // Generate random float between -1 and 1
    }
    await file.write(new Uint8Array(observationBuffer.buffer));
    await file.write(new Uint8Array(outputBuffer.buffer));
  }

  file.close();
  console.log(
    `Binary dataset with ${numRecords} records generated. Each record has ${numObservations} observations and ${numOutputs} outputs.`,
  );
}

await generateBinaryDataset(
  binaryFilePath,
  numRecords,
  numObservations,
  numOutputs,
);
