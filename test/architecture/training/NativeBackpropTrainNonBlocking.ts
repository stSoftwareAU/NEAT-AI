/** Async ABI validation and responses; process cancellation is covered through evolveDir. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  __installNativeBackpropLibraryForTests,
  closeNativeBackpropLibrary,
  type NativeBackpropHandle,
  nativeBackpropTrainAsync,
  type NativeBackpropTrainRequest,
} from "@architecture/training/NativeBackpropLibrary.ts";

const CAPABILITIES = JSON.stringify({
  abiVersion: 1,
  version: "0.1.50",
  capabilities: {
    deadline: {
      version: 1,
      requestField: "deadlineEpochMs",
      cliFlag: "--deadline-epoch-ms",
      unit: "epochMilliseconds",
      resultFile: "result.json",
    },
  },
});

const COMPLETED_RESPONSE = JSON.stringify({
  abiVersion: 1,
  version: "0.1.50",
  bestCreatureJson: "{}",
  baselineMse: 0.5,
  bestMse: 0.25,
  acceptedEpochs: 1,
  epochs: 1,
  bestPath: "best.json",
  journalPath: "journal.json",
  timedOut: false,
  timeout: null,
  completedEpochs: 1,
  baselineMeasure: { kind: "full", mse: 0.5, records: 10 },
  bestMeasure: { kind: "full", mse: 0.25, records: 10 },
});

// Keeps payloads reachable while a double's "native" side points at them.
const keepAlive: Uint8Array[] = [];

function trainRequest(
  extra: Partial<NativeBackpropTrainRequest> = {},
): NativeBackpropTrainRequest {
  return {
    creatureJson: "{}",
    trainingData: "/nonexistent/training",
    outputDir: "/nonexistent/output",
    epochs: 1,
    seed: 1,
    disableRandomSamples: true,
    learningRate: 0.01,
    learningRateStrategy: "fixed",
    learningRateDecay: 0,
    normaliseGradients: false,
    maximumBiasAdjustmentScale: 1,
    maximumWeightAdjustmentScale: 1,
    stepScale: 0.01,
    ...extra,
  };
}

/** `capabilities` omitted means a legacy library. */
function makeDouble(options: {
  capabilities?: string;
  status: number;
  payload: string;
  completion?: Promise<void>;
}): {
  handle: NativeBackpropHandle;
  received: Record<string, unknown>[];
} {
  const received: Record<string, unknown>[] = [];
  let closed = false;
  const capabilityBytes = options.capabilities === undefined
    ? null
    : new TextEncoder().encode(`${options.capabilities}\0`);
  if (capabilityBytes !== null) keepAlive.push(capabilityBytes);

  const symbols: Record<string, unknown> = {
    "neat_backprop_abi_version": () => 1,
    "neat_backprop_version": () => null,
    "neat_backprop_capabilities": capabilityBytes === null
      ? null
      : () => Deno.UnsafePointer.of(capabilityBytes),
    "neat_backprop_train": () => {
      throw new Error("Synchronous entry is not used by this ABI double");
    },
    "neat_backprop_buffer_free": () => {},
  };
  symbols["neat_backprop_train_nonblocking"] = (
    reqPtr: Deno.PointerObject,
    len: bigint,
    outPtr: Deno.PointerObject,
  ): Promise<number> => {
    const bytes = new Uint8Array(Number(len));
    new Deno.UnsafePointerView(reqPtr).copyInto(bytes);
    received.push(JSON.parse(new TextDecoder().decode(bytes)));
    const payload = new TextEncoder().encode(options.payload);
    keepAlive.push(payload);
    const view = new DataView(
      Deno.UnsafePointerView.getArrayBuffer(outPtr, 24),
    );
    view.setBigUint64(
      0,
      Deno.UnsafePointer.value(Deno.UnsafePointer.of(payload)),
      true,
    );
    view.setBigUint64(8, BigInt(payload.byteLength), true);
    view.setBigUint64(16, BigInt(payload.byteLength), true);
    return (options.completion ?? Promise.resolve()).then(() => {
      if (closed) {
        throw new Error("Native code was unloaded before training returned");
      }
      return options.status;
    });
  };
  return {
    handle: {
      symbols,
      close: () => {
        closed = true;
      },
    } as unknown as NativeBackpropHandle,
    received,
  };
}

Deno.test("nativeBackpropTrainAsync awaits the non-blocking call and forwards the deadline", async () => {
  const deadline = 1_800_000_000_000;
  const { handle, received } = makeDouble({
    capabilities: CAPABILITIES,
    status: 0,
    payload: COMPLETED_RESPONSE,
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const response = await nativeBackpropTrainAsync(
      trainRequest({ deadlineEpochMs: deadline }),
    );
    assertEquals(response.bestMse, 0.25);
    assertEquals(response.timedOut, false);
    assertEquals(received.length, 1);
    assertEquals(received[0].deadlineEpochMs, deadline);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrainAsync rejects with the native error on a non-OK status", async () => {
  const { handle } = makeDouble({
    capabilities: CAPABILITIES,
    status: 2,
    payload: "boom: trainer failed",
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = await nativeBackpropTrainAsync(trainRequest()).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    assert(error !== undefined, "expected a rejection");
    assertStringIncludes(
      error.message,
      "neat_backprop_train failed (status 2)",
    );
    assertStringIncludes(error.message, "boom: trainer failed");
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrainAsync refuses a deadline on a legacy library before any native call", async () => {
  const { handle, received } = makeDouble({
    status: 0,
    payload: COMPLETED_RESPONSE,
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = await nativeBackpropTrainAsync(
      trainRequest({ deadlineEpochMs: 1_800_000_000_000 }),
    ).then(() => undefined, (e: unknown) => e as Error);
    assert(error !== undefined, "expected a rejection");
    assertStringIncludes(error.message, "no deadline capability");
    assertEquals(received.length, 0);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("closing the library during concurrent native training preserves both results", async () => {
  const completed = Promise.withResolvers<void>();
  const { handle } = makeDouble({
    capabilities: CAPABILITIES,
    status: 0,
    payload: COMPLETED_RESPONSE,
    completion: completed.promise,
  });
  assert(__installNativeBackpropLibraryForTests(handle));
  const first = nativeBackpropTrainAsync(trainRequest());
  const second = nativeBackpropTrainAsync(trainRequest());
  closeNativeBackpropLibrary();
  completed.resolve();
  try {
    const results = await Promise.all([first, second]);
    assertEquals(results.map((result) => result.bestMse), [0.25, 0.25]);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("async native training rejects invalid absolute deadlines and accepts a valid one", async () => {
  const { handle } = makeDouble({
    capabilities: CAPABILITIES,
    status: 0,
    payload: COMPLETED_RESPONSE,
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    for (const value of [-1, 0.5, NaN, Infinity, null]) {
      await assertRejects(
        () =>
          nativeBackpropTrainAsync(
            trainRequest({ deadlineEpochMs: value as number }),
          ),
        Error,
        "deadlineEpochMs must be a non-negative safe integer",
      );
    }
    const result = await nativeBackpropTrainAsync(
      trainRequest({ deadlineEpochMs: 1_800_000_000_000 }),
    );
    assertEquals(result.bestMse, 0.25);
  } finally {
    closeNativeBackpropLibrary();
  }
});
