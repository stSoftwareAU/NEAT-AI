import { assertEquals } from "@std/assert";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { submitDiscoveryRecordBatch } from "../../src/architecture/ErrorGuidedStructuralEvolution/SubmitDiscoveryRecordBatch.ts";

Deno.test(
  "submitDiscoveryRecordBatch: preserves buffers when record() returns false (avoids splice data loss)",
  () => {
    const data: DataRecordInterface = {
      input: new Float32Array([1]),
      output: new Float32Array([2]),
    };

    const params = {
      dataSet: [data],
      neuronPromisesMap: new Map<string, Promise<void>>(),
      selectedIndices: [123],
    };

    const calls: Array<{
      options?: Readonly<{ allowGraceAfterTimeout?: boolean }>;
      trainingDataLen: number;
      indicesLen: number;
    }> = [];

    const discoverStructure = {
      record: (
        trainingData: DataRecordInterface[],
        _neuronPromisesMap: Map<string, Promise<void>>,
        _binaryFilePath?: string,
        recordIndices?: number[],
        options?: Readonly<{ allowGraceAfterTimeout?: boolean }>,
      ) => {
        calls.push({
          options,
          trainingDataLen: trainingData.length,
          indicesLen: recordIndices?.length ?? 0,
        });
        return false;
      },
    } as const;

    const recorded = submitDiscoveryRecordBatch(
      discoverStructure,
      params,
      "/tmp/fake.bin",
      { allowGraceAfterTimeout: true },
    );

    assertEquals(recorded, false);

    // Critical regression assertion: buffers must not be cleared when record() is
    // rejected (eg. due to a timeout race).
    assertEquals(params.dataSet.length, 1);
    assertEquals(params.selectedIndices.length, 1);

    // Sanity: call shapes are correct.
    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.trainingDataLen, 1);
    assertEquals(calls[0]?.indicesLen, 1);
    assertEquals(calls[0]?.options?.allowGraceAfterTimeout, true);
  },
);

Deno.test("submitDiscoveryRecordBatch: clears buffers when record() returns true", () => {
  const data: DataRecordInterface = {
    input: new Float32Array([1]),
    output: new Float32Array([2]),
  };

  const params = {
    dataSet: [data],
    neuronPromisesMap: new Map<string, Promise<void>>(),
    selectedIndices: [123],
  };

  const discoverStructure = {
    record: () => true,
  } as const;

  const recorded = submitDiscoveryRecordBatch(
    discoverStructure,
    params,
    "/tmp/fake.bin",
    { allowGraceAfterTimeout: true },
  );

  assertEquals(recorded, true);
  assertEquals(params.dataSet.length, 0);
  assertEquals(params.selectedIndices.length, 0);
});
