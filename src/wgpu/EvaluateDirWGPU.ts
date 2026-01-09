import { assert } from "@std/assert";
import type { CostInterface } from "../costs/CostInterface.ts";
import type { Creature } from "../Creature.ts";
import { dataFiles } from "../architecture/Training.ts";
import {
  hasUsableWebGPUAdapterOnce,
  hasWebGPU,
  isWGPUActivationEnabled,
  isWGPUActivationStrict,
} from "./WGPUEnv.ts";
import { MSE } from "../costs/MSE.ts";

const gpuSuitabilityCache = new Map<string, boolean>();

/**
 * Fast tolerance-based preflight for the *production* acceptance criteria.
 *
 * We accept WebGPU for scoring when the mean error delta on a small sample from
 * the real dataset is below the configured tolerance.
 *
 * Note (9-Jan-2026): This intentionally checks end-to-end MSE, not per-neuron
 * exact output equality, because GPU uses float32 and CPU uses float64.
 */
async function canUseWGPUForDatasetToleranceMSE(
  creature: Creature,
  dataDir: string,
  cost: CostInterface,
  _wgpuBrokerPort: MessagePort,
  evaluateMSE: (
    interleaved: Float32Array,
    recordCount: number,
    valuesCount: number,
  ) => Promise<Float32Array>,
  tolerance: number,
): Promise<boolean> {
  if (!hasWebGPU()) return false;
  if (cost.getName() !== MSE.NAME) return false;

  const dataResult = dataFiles(dataDir, { disableRandomSamples: true });
  if (dataResult.files.length === 0) return false;

  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4;
  const SAMPLE_RECORDS = 256;
  const sampleBytes = SAMPLE_RECORDS * BYTES_PER_RECORD;

  const buf = new Uint8Array(sampleBytes);
  const f32 = new Float32Array(buf.buffer);

  const file = await Deno.open(dataResult.files[0], { read: true });
  try {
    const bytesRead = await file.read(buf);
    if (!bytesRead || bytesRead < BYTES_PER_RECORD) return false;
    const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
    if (recordsRead <= 0) return false;

    // CPU MSE on sample
    let cpuSum = 0;
    for (let r = 0; r < recordsRead; r++) {
      const base = r * valuesCount;
      const input = new Float32Array(f32.subarray(base, base + creature.input));
      const target = new Float32Array(
        f32.subarray(base + creature.input, base + valuesCount),
      );
      creature.clearState();
      const out = creature.activate(input, false);
      cpuSum += cost.calculate(target, out);
    }
    const cpuAvg = cpuSum / recordsRead;

    // GPU MSE on sample
    const per = await evaluateMSE(f32, recordsRead, valuesCount);
    let gpuSum = 0;
    for (let i = 0; i < per.length; i++) gpuSum += per[i];
    const gpuAvg = gpuSum / recordsRead;

    return Math.abs(gpuAvg - cpuAvg) <= tolerance;
  } finally {
    file.close();
  }
}

/**
 * Evaluate a directory dataset using WebGPU batched activation when enabled.
 *
 * This is intended for worker evaluation (high throughput). It does not change
 * `Creature.activate()` and falls back to the existing CPU evaluation when GPU
 * is not available or exact equivalence cannot be guaranteed.
 */
export async function evaluateDirMaybeWGPU(
  creature: Creature,
  dataDir: string,
  cost: CostInterface,
  feedbackLoop: boolean,
  wgpuBrokerPort?: MessagePort,
): Promise<{ error: number }> {
  if (!isWGPUActivationEnabled() || feedbackLoop) {
    return creature.evaluateDir(dataDir, cost, feedbackLoop);
  }

  if (!hasWebGPU() || !(await hasUsableWebGPUAdapterOnce())) {
    if (isWGPUActivationStrict()) {
      throw new Error(
        "NEAT_WGPU_ACTIVATION is enabled but WebGPU is not available. " +
          "Ensure Deno is run with --unstable-webgpu and a GPU is present.",
      );
    }
    return creature.evaluateDir(dataDir, cost, feedbackLoop);
  }

  if (!wgpuBrokerPort) {
    if (isWGPUActivationStrict()) {
      throw new Error("WebGPU broker port not available in this runtime");
    }
    return creature.evaluateDir(dataDir, cost, feedbackLoop);
  }

  const dataResult = dataFiles(dataDir, { disableRandomSamples: true });
  assert(dataResult.files.length > 0, "No data files found");

  const valuesCount = creature.input + creature.output;
  const bytesPerRecord = valuesCount * 4;
  const cpuOptimalReadSize = 128 * 1024;
  // For GPU scoring we prefer fewer, larger dispatches. We cap by the broker's
  // internal maxRecords limit.
  const gpuOptimalReadSize = 4 * 1024 * 1024;
  const maxGPURecordsPerBatch = 32_768;

  const batchSize = Math.max(
    1,
    Math.floor(
      (cost.getName() === MSE.NAME ? gpuOptimalReadSize : cpuOptimalReadSize) /
        bytesPerRecord,
    ),
  );
  const cappedBatchSize = cost.getName() === MSE.NAME
    ? Math.min(batchSize, maxGPURecordsPerBatch)
    : batchSize;
  const bytesPerBatch = bytesPerRecord * cappedBatchSize;

  // Shared buffers for batch processing (read)
  const batchBuffer = new Uint8Array(bytesPerBatch);
  const batchArray = new Float32Array(batchBuffer.buffer);

  if (!wgpuBrokerPort) {
    if (isWGPUActivationStrict()) {
      throw new Error("WebGPU broker port not available in this worker");
    }
    return creature.evaluateDir(dataDir, cost, feedbackLoop);
  }

  // Broker protocol helpers.
  type BrokerResponse =
    | { type: "ok"; requestId: number }
    | { type: "activate-result"; requestId: number; outputs: ArrayBuffer }
    | {
      type: "evaluate-mse-result";
      requestId: number;
      perRecordMSE: ArrayBuffer;
    }
    | { type: "error"; requestId: number; message: string };

  let requestId = 1;
  const creatureKey = creature.uuid ?? crypto.randomUUID();
  const request = async <T>(
    payload: Record<string, unknown>,
    timeoutMS: number,
    map: (msg: BrokerResponse) => T,
  ): Promise<T> => {
    const id = requestId++;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebGPU broker timeout")),
        timeoutMS,
      );
      const onMessage = (ev: MessageEvent) => {
        const m = ev.data as BrokerResponse;
        if (!m || m.requestId !== id) return;
        wgpuBrokerPort.removeEventListener("message", onMessage);
        clearTimeout(timer);
        if (m.type === "error") {
          reject(new Error(m.message));
          return;
        }
        resolve(map(m));
      };
      wgpuBrokerPort.addEventListener("message", onMessage);
      wgpuBrokerPort.postMessage({ ...payload, requestId: id });
    });
  };

  // Initialise creature in broker cache.
  try {
    await request(
      { type: "init", creatureKey, creatureJSON: creature.exportJSON() },
      2_000,
      () => true,
    );
  } catch (e) {
    if (isWGPUActivationStrict()) throw e;
    return creature.evaluateDir(dataDir, cost, feedbackLoop);
  }

  const activate = async (inputs: Float32Array): Promise<Float32Array> => {
    const buf = inputs.slice().buffer;
    return await request(
      { type: "activate", creatureKey, inputs: buf },
      2_000,
      (m) => {
        if (m.type !== "activate-result") {
          throw new Error(`Unexpected broker response: ${m.type}`);
        }
        return new Float32Array(m.outputs);
      },
    );
  };

  const evaluateMSE = async (
    interleaved: Float32Array,
    recordCount: number,
    valuesCount: number,
  ): Promise<Float32Array> => {
    const bytes = recordCount * valuesCount * 4;
    const buf = interleaved.buffer.slice(
      interleaved.byteOffset,
      interleaved.byteOffset + bytes,
    ) as ArrayBuffer;
    return await request(
      {
        type: "evaluate-mse",
        creatureKey,
        records: buf,
        recordCount,
        valuesCount,
      },
      30_000,
      (m) => {
        if (m.type !== "evaluate-mse-result") {
          throw new Error(`Unexpected broker response: ${m.type}`);
        }
        return new Float32Array(m.perRecordMSE);
      },
    );
  };

  // Tolerance-based preflight for production suitability.
  // Accept if the mean error delta on a small sample is within 1e-6.
  const tolerance = 1e-6;
  const cacheKey = `${creature.uuid ?? "no-uuid"}|${dataDir}|${cost.getName()}`;
  let ok = gpuSuitabilityCache.get(cacheKey);
  if (ok === undefined) {
    ok = false;
    try {
      ok = await canUseWGPUForDatasetToleranceMSE(
        creature,
        dataDir,
        cost,
        wgpuBrokerPort,
        evaluateMSE,
        tolerance,
      );
    } catch (e) {
      if (isWGPUActivationStrict()) throw e;
      ok = false;
    }
    gpuSuitabilityCache.set(cacheKey, ok);
  }
  if (!ok) {
    if (isWGPUActivationStrict()) {
      throw new Error(
        `NEAT_WGPU_ACTIVATION_STRICT is enabled but GPU MSE preflight exceeded tolerance ${tolerance}`,
      );
    }
    return creature.evaluateDir(dataDir, cost, feedbackLoop);
  }

  try {
    let totalError = 0;
    let count = 0;

    for (let fileIndx = dataResult.files.length; fileIndx--;) {
      const filePath = dataResult.files[fileIndx];
      // deno-lint-ignore no-await-in-loop -- Sequential file processing keeps memory bounded.
      const file = await Deno.open(filePath, { read: true });
      try {
        while (true) {
          // deno-lint-ignore no-await-in-loop -- Sequential reads are intentional; we stream a single buffer.
          const bytesRead = await file.read(batchBuffer);
          if (bytesRead === null) break;
          assert(bytesRead > 0, "Invalid number of bytes read");
          assert(
            bytesRead % bytesPerRecord === 0,
            "Invalid number of bytes read",
          );

          const recordsRead = Math.floor(bytesRead / bytesPerRecord);
          if (recordsRead === 0) break;

          let batchErr = 0;

          // Fast path: MSE directly on GPU using the interleaved record buffer.
          if (cost.getName() === MSE.NAME) {
            // deno-lint-ignore no-await-in-loop -- GPU batches must be processed sequentially.
            const perRecord = await evaluateMSE(
              batchArray,
              recordsRead,
              valuesCount,
            );
            for (let i = 0; i < perRecord.length; i++) {
              batchErr += perRecord[i];
            }
          } else {
            // Fallback: GPU activation + CPU cost.
            const batchInputs = new Float32Array(recordsRead * creature.input);
            const batchTargets = new Float32Array(
              recordsRead * creature.output,
            );

            for (
              let recordIndex = 0;
              recordIndex < recordsRead;
              recordIndex++
            ) {
              const srcOffset = recordIndex * valuesCount;
              const inputOffset = recordIndex * creature.input;
              const targetOffset = recordIndex * creature.output;

              for (let i = 0; i < creature.input; i++) {
                batchInputs[inputOffset + i] = batchArray[srcOffset + i];
              }
              for (let o = 0; o < creature.output; o++) {
                batchTargets[targetOffset + o] =
                  batchArray[srcOffset + creature.input + o];
              }
            }

            // deno-lint-ignore no-await-in-loop -- GPU batches must be processed sequentially.
            const gpuOutputs = await activate(batchInputs);

            for (let r = 0; r < recordsRead; r++) {
              const out = gpuOutputs.subarray(
                r * creature.output,
                (r + 1) * creature.output,
              );
              const tgt = batchTargets.subarray(
                r * creature.output,
                (r + 1) * creature.output,
              );
              batchErr += cost.calculate(tgt, out);
            }
          }

          totalError += batchErr;
          count += recordsRead;
        }
      } finally {
        file.close();
      }
    }

    if (count === 0) return { error: 0 };
    const averageError = totalError / count;
    if (Number.isFinite(averageError)) {
      return { error: averageError };
    }
    return { error: Number.MAX_SAFE_INTEGER };
  } catch (e) {
    // Production safety: if WebGPU fails mid-run (timeouts, driver issues, etc),
    // fall back to the original CPU evaluation path unless strict mode is enabled.
    if (isWGPUActivationStrict()) throw e;
    return creature.evaluateDir(dataDir, cost, feedbackLoop);
  } finally {
    // Broker lifecycle is owned by the parent process.
  }
}
