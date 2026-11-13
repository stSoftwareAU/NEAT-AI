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
  nativeBackpropTrainAsync,
  type NativeBackpropTrainRequest,
} from "@architecture/training/NativeBackpropLibrary.ts";

import { nativeBackpropDouble } from "./_nativeBackpropDouble.ts";

const FIXTURES = new URL("../../fixtures/native-backprop/", import.meta.url);
const CAPABILITIES = Deno.readTextFileSync(
  new URL("capabilities-new.json", FIXTURES),
);
const COMPLETED_RESPONSE = Deno.readTextFileSync(
  new URL("ffi-response-new-completed.json", FIXTURES),
);

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

Deno.test("nativeBackpropTrainAsync awaits the non-blocking call and forwards the deadline", async () => {
  const deadline = 1_800_000_000_000;
  const { handle, received } = nativeBackpropDouble({
    capabilities: CAPABILITIES,
    status: 0,
    payload: COMPLETED_RESPONSE,
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const response = await nativeBackpropTrainAsync(
      trainRequest({ deadlineEpochMs: deadline }),
    );
    assertEquals(response.bestMse, 0.3845915356043993);
    assertEquals(response.timedOut, false);
    assertEquals(received.length, 1);
    assertEquals(received[0].deadlineEpochMs, deadline);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrainAsync rejects with the native error on a non-OK status", async () => {
  const { handle } = nativeBackpropDouble({
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
  const { handle, received } = nativeBackpropDouble({
    status: 0,
    payload: await Deno.readTextFile(
      new URL("ffi-response-legacy.json", FIXTURES),
    ),
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = await nativeBackpropTrainAsync(
      trainRequest({ deadlineEpochMs: 1_800_000_000_000 }),
    ).then(() => undefined, (e: unknown) => e as Error);
    assert(error !== undefined, "expected a rejection");
    assertStringIncludes(error.message, "no deadline capability");
    assertEquals(received.length, 0);
    const allowed = await nativeBackpropTrainAsync(trainRequest());
    assertEquals(allowed.bestMse, 0.3845915356043993);
    assertEquals(allowed.timedOut, undefined);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("closing the library during concurrent native training preserves both results", async () => {
  const completed = Promise.withResolvers<void>();
  const { handle } = nativeBackpropDouble({
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
    assertEquals(results.map((result) => result.bestMse), [
      0.3845915356043993,
      0.3845915356043993,
    ]);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("async native training rejects invalid absolute deadlines and accepts a valid one", async () => {
  const { handle } = nativeBackpropDouble({
    capabilities: CAPABILITIES,
    status: 0,
    payload: COMPLETED_RESPONSE,
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    await Promise.all(
      [-1, 0.5, NaN, Infinity, null].map((value) =>
        assertRejects(
          () =>
            nativeBackpropTrainAsync(
              trainRequest({ deadlineEpochMs: value as number }),
            ),
          Error,
          "deadlineEpochMs must be a non-negative safe integer",
        )
      ),
    );
    const result = await nativeBackpropTrainAsync(
      trainRequest({ deadlineEpochMs: 1_800_000_000_000 }),
    );
    assertEquals(result.bestMse, 0.3845915356043993);
  } finally {
    closeNativeBackpropLibrary();
  }
});
