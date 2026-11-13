/**
 * `trainDirAsync` is the worker's training path (Issue #4126): it must give
 * the same result as `trainDir` while awaiting the native trainer through the
 * non-blocking symbol instead of calling the blocking one.
 *
 * The native trainer is a double installed through
 * `__installNativeBackpropLibraryForTests`, answering with committed captures
 * from the real engines (test/fixtures/native-backprop/README.md).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import type { TrainOptions } from "@config/TrainOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir, trainDirAsync } from "@architecture/Training.ts";
import { __setRustTrainDirEnabledForTests } from "@architecture/training/RustTrainDirBridge.ts";
import {
  __installNativeBackpropLibraryForTests,
  closeNativeBackpropLibrary,
  type NativeBackpropHandle,
} from "@architecture/training/NativeBackpropLibrary.ts";

const FIXTURE_DIR = new URL("../../fixtures/native-backprop/", import.meta.url);

function readFixture(name: string): string {
  return Deno.readTextFileSync(new URL(name, FIXTURE_DIR));
}

const CAPABILITIES = readFixture("capabilities-new.json");
const COMPLETED_RESPONSE = readFixture("ffi-response-new-completed.json");
const EXPIRED_RESPONSE = readFixture("ffi-response-new-timed-out-expired.json");
const INPUT_CREATURE_JSON = (JSON.parse(EXPIRED_RESPONSE) as {
  bestCreatureJson: string;
}).bestCreatureJson;

/** A fixed far-future instant (2100-01-01T00:00:00Z). No clock is read. */
const HARD_DEADLINE_TS = 4_102_444_800_000;

// Keeps every buffer handed to the native side reachable while a double reads it.
const keepAlive: Uint8Array[] = [];

function payloadAddress(bytes: Uint8Array): bigint {
  keepAlive.push(bytes);
  return Deno.UnsafePointer.value(Deno.UnsafePointer.of(bytes));
}

function writeBuffer(view: DataView, bytes: Uint8Array): void {
  view.setBigUint64(0, payloadAddress(bytes), true);
  view.setBigUint64(8, BigInt(bytes.byteLength), true);
  view.setBigUint64(16, BigInt(bytes.byteLength), true);
}

function makeDouble(): NativeBackpropHandle {
  const capabilityBytes = new TextEncoder().encode(`${CAPABILITIES}\0`);
  keepAlive.push(capabilityBytes);
  const payloadBytes = new TextEncoder().encode(COMPLETED_RESPONSE);
  const handle = {
    symbols: {
      neat_backprop_abi_version: () => 1,
      neat_backprop_version: () => null,
      neat_backprop_capabilities: () => Deno.UnsafePointer.of(capabilityBytes),
      neat_backprop_train: (
        _request: Uint8Array,
        _len: bigint,
        out: Uint8Array,
      ) => {
        writeBuffer(
          new DataView(out.buffer, out.byteOffset, out.byteLength),
          payloadBytes,
        );
        return 0;
      },
      neat_backprop_train_nonblocking: (
        reqPtr: Deno.PointerObject,
        len: bigint,
        outPtr: Deno.PointerObject,
      ) => {
        const request = new Uint8Array(Number(len));
        new Deno.UnsafePointerView(reqPtr).copyInto(request);
        JSON.parse(new TextDecoder().decode(request));
        writeBuffer(
          new DataView(Deno.UnsafePointerView.getArrayBuffer(outPtr, 24)),
          payloadBytes,
        );
        return Promise.resolve(0);
      },
      neat_backprop_buffer_free: () => {},
    },
    close: () => {},
  };
  // The double mirrors the C ABI shape only.
  return handle as unknown as NativeBackpropHandle;
}

function makeSingleDataDir(creature: Creature): string {
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0.5]), output: new Float32Array([1]) },
    { input: new Float32Array([1]), output: new Float32Array([2]) },
  ];
  return makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
}

const OPTIONS: TrainOptions = {
  iterations: 1,
  disableRandomSamples: true,
  hardDeadlineTS: HARD_DEADLINE_TS,
};

Deno.test("trainDirAsync preserves trainDir error metrics and deadline outcome", async () => {
  const syncCreature = Creature.fromJSON(JSON.parse(INPUT_CREATURE_JSON));
  const asyncCreature = Creature.fromJSON(JSON.parse(INPUT_CREATURE_JSON));
  const dataDir = makeSingleDataDir(syncCreature);
  closeNativeBackpropLibrary();
  __setRustTrainDirEnabledForTests(true);
  try {
    assert(__installNativeBackpropLibraryForTests(makeDouble()));

    const syncResult = trainDir(
      syncCreature,
      dataDir,
      OPTIONS,
      Costs.find("MSE"),
    );

    const asyncResult = await trainDirAsync(
      asyncCreature,
      dataDir,
      OPTIONS,
      Costs.find("MSE"),
    );

    assertEquals(asyncResult.error, syncResult.error);
    assertEquals(asyncResult.timedOut, syncResult.timedOut);
    assertEquals(asyncResult.bestMeasure, syncResult.bestMeasure);
    assertEquals(
      Object.keys(asyncResult).sort(),
      Object.keys(syncResult).sort(),
    );
  } finally {
    closeNativeBackpropLibrary();
    __setRustTrainDirEnabledForTests(undefined);
    await Deno.remove(dataDir, { recursive: true });
  }
});
