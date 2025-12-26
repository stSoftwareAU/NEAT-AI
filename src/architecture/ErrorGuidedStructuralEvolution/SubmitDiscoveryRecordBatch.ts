import type { DataRecordInterface } from "../DataSet.ts";

/**
 * Submits a buffered discovery recording batch in a non-destructive way.
 *
 * Why:The directory recorder buffers samples and then
 * submits them to `DiscoverStructure.record()`. Under tight deadlines, a timeout
 * race can cause `record()` to return false even after the caller has decided to
 * flush. If we clear buffers before knowing `record()` accepted the data, we can
 * lose samples and end up with zero Parquet artefacts.
 *
 * This helper only clears `params.dataSet` / `params.selectedIndices` if the
 * recorder returns true.
 */
export function submitDiscoveryRecordBatch(
  discoverStructure: Readonly<{
    record: (
      trainingData: DataRecordInterface[],
      neuronPromisesMap: Map<string, Promise<void>>,
      binaryFilePath?: string,
      recordIndices?: number[],
      options?: Readonly<{ allowGraceAfterTimeout?: boolean }>,
    ) => boolean;
  }>,
  params: Readonly<{
    dataSet: DataRecordInterface[];
    neuronPromisesMap: Map<string, Promise<void>>;
    selectedIndices: number[];
  }>,
  filePath: string,
  options?: Readonly<{ allowGraceAfterTimeout?: boolean }>,
): boolean {
  if (params.dataSet.length === 0) return true;

  // Pass the live arrays; `DiscoverStructure.record()` does not mutate them.
  const recorded = discoverStructure.record(
    params.dataSet,
    params.neuronPromisesMap,
    filePath,
    params.selectedIndices,
    options,
  );

  if (recorded) {
    params.dataSet.splice(0);
    params.selectedIndices.splice(0);
  }

  return recorded;
}
