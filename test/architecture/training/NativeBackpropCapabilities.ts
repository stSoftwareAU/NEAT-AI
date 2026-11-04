import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  __installNativeBackpropLibraryForTests,
  closeNativeBackpropLibrary,
  findNativeBackpropLibrary,
  nativeBackpropDeadlineCapability,
  type NativeBackpropHandle,
  nativeBackpropTrain,
  type NativeBackpropTrainRequest,
  parseNativeBackpropCapabilities,
  parseNativeBackpropTrainResponse,
} from "@architecture/training/NativeBackpropLibrary.ts";

/*
 * Fixtures are captured from the real binaries (see
 * test/fixtures/native-backprop/README.md). Doubles below implement the C ABI
 * shape, so the module's real parsing and dispatch run unchanged.
 */

const FIXTURE_DIR = new URL("../../fixtures/native-backprop/", import.meta.url);

function readFixture(name: string): string {
  return Deno.readTextFileSync(new URL(name, FIXTURE_DIR));
}

const CAPABILITIES = readFixture("capabilities-new.json");
const LEGACY_RESPONSE = readFixture("ffi-response-legacy.json");
const COMPLETED_RESPONSE = readFixture("ffi-response-new-completed.json");
const EXPIRED_RESPONSE = readFixture("ffi-response-new-timedout-expired.json");

/** Run `fn` and return the error it throws; fails the test if it does not throw. */
function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected the function to throw");
}

/** Shallow-override fields of a JSON fixture and re-serialise it. */
function withChanges(fixture: string, change: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(fixture), ...change });
}

/** Assert the refusal names the offending field (quoted, as the parser prints it). */
function assertRefusedNaming(fn: () => unknown, field: string): void {
  const error = captureError(fn);
  assertStringIncludes(error.message, `"${field}"`);
}

// Keeps every buffer handed to the native side reachable while a double reads it.
const keepAlive: Uint8Array[] = [];

function writeOwnedBuffer(out: Uint8Array, bytes: Uint8Array): void {
  keepAlive.push(bytes);
  const address = Deno.UnsafePointer.value(Deno.UnsafePointer.of(bytes));
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(0, address, true);
  view.setBigUint64(8, BigInt(bytes.byteLength), true);
  view.setBigUint64(16, BigInt(bytes.byteLength), true);
}

interface DoubleResult {
  status: number;
  payload: string;
}

/**
 * A `NativeBackpropHandle` double. `capabilities` omitted means a legacy
 * library: the `neat_backprop_capabilities` symbol is null.
 */
function makeDouble(options: {
  capabilities?: string;
  train: (request: Record<string, unknown>) => DoubleResult;
}): { handle: NativeBackpropHandle; received: Record<string, unknown>[] } {
  const received: Record<string, unknown>[] = [];
  const capabilityBytes = options.capabilities === undefined
    ? null
    : new TextEncoder().encode(`${options.capabilities}\0`);
  keepAlive.push(...(capabilityBytes === null ? [] : [capabilityBytes]));
  const handle = {
    symbols: {
      neat_backprop_abi_version: () => 1,
      neat_backprop_version: () => null,
      neat_backprop_capabilities: capabilityBytes === null
        ? null
        : () => Deno.UnsafePointer.of(capabilityBytes),
      neat_backprop_train: (
        request: Uint8Array,
        _len: bigint,
        out: Uint8Array,
      ) => {
        const decoded = JSON.parse(new TextDecoder().decode(request)) as Record<
          string,
          unknown
        >;
        received.push(decoded);
        const result = options.train(decoded);
        writeOwnedBuffer(out, new TextEncoder().encode(result.payload));
        return result.status;
      },
      neat_backprop_buffer_free: () => {},
    },
    close: () => {},
  };
  // The double mirrors the C ABI shape only; its buffer parameters are
  // typed more loosely than Deno's `buffer` ForeignFunction parameter.
  return {
    handle: handle as unknown as NativeBackpropHandle,
    received,
  };
}

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

// --- parseNativeBackpropCapabilities ---------------------------------------

Deno.test("parseNativeBackpropCapabilities accepts the real new-engine capability payload", () => {
  const parsed = parseNativeBackpropCapabilities(CAPABILITIES);
  assertEquals(parsed.abiVersion, 1);
  assertEquals(parsed.version, "0.1.50");
  assertEquals(parsed.deadline, {
    version: 1,
    requestField: "deadlineEpochMs",
    cliFlag: "--deadline-epoch-ms",
    unit: "epochMilliseconds",
    resultFile: "result.json",
  });
});

Deno.test("parseNativeBackpropCapabilities returns no deadline when capabilities.deadline is absent", () => {
  const raw = JSON.stringify({
    abiVersion: 1,
    version: "0.1.49",
    capabilities: {},
  });
  assertEquals(parseNativeBackpropCapabilities(raw).deadline, undefined);
});

Deno.test("parseNativeBackpropCapabilities returns no deadline for an unsupported contract version", () => {
  const raw = JSON.stringify({
    abiVersion: 1,
    version: "0.2.0",
    capabilities: {
      deadline: { version: 2, requestField: "somethingElse" },
    },
  });
  assertEquals(parseNativeBackpropCapabilities(raw).deadline, undefined);
});

Deno.test("parseNativeBackpropCapabilities refuses a version-1 deadline whose contract differs, naming the field", () => {
  const wrongValues: [string, string][] = [
    ["requestField", "deadlineEpochMilliseconds"],
    ["cliFlag", "--deadline-ms"],
    ["unit", "seconds"],
    ["resultFile", "out.json"],
  ];
  for (const [field, wrong] of wrongValues) {
    const deadline = {
      version: 1,
      requestField: "deadlineEpochMs",
      cliFlag: "--deadline-epoch-ms",
      unit: "epochMilliseconds",
      resultFile: "result.json",
      [field]: wrong,
    };
    const raw = JSON.stringify({
      abiVersion: 1,
      version: "0.1.50",
      capabilities: { deadline },
    });
    const error = captureError(() => parseNativeBackpropCapabilities(raw));
    assertStringIncludes(error.message, field);
  }
});

Deno.test("parseNativeBackpropCapabilities refuses non-JSON input", () => {
  const error = captureError(() =>
    parseNativeBackpropCapabilities("unrecognized subcommand 'capabilities'")
  );
  assertStringIncludes(error.message, "not valid JSON");
});

// --- parseNativeBackpropTrainResponse --------------------------------------

Deno.test("parseNativeBackpropTrainResponse accepts the legacy fixture for a legacy library", () => {
  const response = parseNativeBackpropTrainResponse(LEGACY_RESPONSE, false);
  assertEquals(typeof response.baselineMse, "number");
  assertEquals(typeof response.bestMse, "number");
  assertEquals(response.timedOut, undefined);
});

Deno.test("parseNativeBackpropTrainResponse accepts the new completed and expired fixtures for a deadline-capable library", () => {
  const completed = parseNativeBackpropTrainResponse(COMPLETED_RESPONSE, true);
  assertEquals(completed.timedOut, false);
  assertEquals(completed.timeout, null);
  assertEquals(completed.baselineMse, 0.38500000014901176);
  assertEquals(completed.baselineMeasure?.kind, "full");

  const expired = parseNativeBackpropTrainResponse(EXPIRED_RESPONSE, true);
  assertEquals(expired.timedOut, true);
  assertEquals(expired.timeout?.phase, "start");
  assertEquals(expired.timeout?.deadlineEpochMs, 1);
  assertEquals(expired.baselineMse, null);
  assertEquals(expired.bestMse, null);
});

Deno.test("parseNativeBackpropTrainResponse rejects the legacy fixture for a deadline-capable library at its first missing field", () => {
  assertRefusedNaming(
    () => parseNativeBackpropTrainResponse(LEGACY_RESPONSE, true),
    "timedOut",
  );
});

Deno.test("parseNativeBackpropTrainResponse refuses timedOut true with a null timeout, and accepts it once timeout is an object", () => {
  assertRefusedNaming(
    () =>
      parseNativeBackpropTrainResponse(
        withChanges(EXPIRED_RESPONSE, { timeout: null }),
        true,
      ),
    "timeout",
  );
  const legal = withChanges(EXPIRED_RESPONSE, {
    timeout: {
      phase: "start",
      completedEpochs: 0,
      weightsChanged: false,
      deadlineEpochMs: 1,
    },
  });
  assertEquals(
    parseNativeBackpropTrainResponse(legal, true).timedOut,
    true,
  );
});

Deno.test("parseNativeBackpropTrainResponse refuses a numeric baselineMse under a partial measure, and accepts null", () => {
  const partialMeasure = { kind: "partial", mse: 0.385, records: 10 };
  assertRefusedNaming(
    () =>
      parseNativeBackpropTrainResponse(
        withChanges(COMPLETED_RESPONSE, {
          baselineMeasure: partialMeasure,
        }),
        true,
      ),
    "baselineMse",
  );
  const legal = withChanges(COMPLETED_RESPONSE, {
    baselineMeasure: partialMeasure,
    baselineMse: null,
  });
  assertEquals(
    parseNativeBackpropTrainResponse(legal, true).baselineMse,
    null,
  );
});

Deno.test("parseNativeBackpropTrainResponse refuses a numeric bestMse under an unmeasured measure, and accepts null", () => {
  assertRefusedNaming(
    () =>
      parseNativeBackpropTrainResponse(
        withChanges(EXPIRED_RESPONSE, { bestMse: 0.5 }),
        true,
      ),
    "bestMse",
  );
  assertEquals(
    parseNativeBackpropTrainResponse(EXPIRED_RESPONSE, true).bestMse,
    null,
  );
});

Deno.test("parseNativeBackpropTrainResponse refuses a null bestMse under a full measure, and a mismatched one, and accepts the equal number", () => {
  assertRefusedNaming(
    () =>
      parseNativeBackpropTrainResponse(
        withChanges(COMPLETED_RESPONSE, { bestMse: null }),
        true,
      ),
    "bestMse",
  );
  assertRefusedNaming(
    () =>
      parseNativeBackpropTrainResponse(
        withChanges(COMPLETED_RESPONSE, { bestMse: 0.1 }),
        true,
      ),
    "bestMse",
  );
  const original = JSON.parse(COMPLETED_RESPONSE) as { bestMse: number };
  const legal = withChanges(COMPLETED_RESPONSE, {
    bestMse: original.bestMse,
  });
  assertEquals(
    parseNativeBackpropTrainResponse(legal, true).bestMse,
    original.bestMse,
  );
});

Deno.test("parseNativeBackpropTrainResponse requires bestCreatureJson to be a string", () => {
  assertRefusedNaming(
    () =>
      parseNativeBackpropTrainResponse(
        withChanges(LEGACY_RESPONSE, { bestCreatureJson: 7 }),
        false,
      ),
    "bestCreatureJson",
  );
});

// --- nativeBackpropTrain with C ABI doubles --------------------------------

Deno.test("nativeBackpropTrain refuses deadlineEpochMs on a legacy library before the native train call", () => {
  const { handle, received } = makeDouble({
    train: () => ({ status: 0, payload: LEGACY_RESPONSE }),
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = captureError(() =>
      nativeBackpropTrain(trainRequest({ deadlineEpochMs: 1_800_000_000_000 }))
    );
    assertStringIncludes(error.message, "deadlineEpochMs");
    assertStringIncludes(error.message, "capability");
    assertEquals(received.length, 0);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrain refuses a null deadlineEpochMs rather than treating it as omitted", () => {
  const { handle, received } = makeDouble({
    train: () => ({ status: 0, payload: LEGACY_RESPONSE }),
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const request = {
      ...trainRequest(),
      deadlineEpochMs: null,
    } as unknown as NativeBackpropTrainRequest;
    const error = captureError(() => nativeBackpropTrain(request));
    assertStringIncludes(error.message, "deadlineEpochMs");
    assertEquals(received.length, 0);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrain sends no deadline field to a legacy library and parses its legacy response", () => {
  const { handle, received } = makeDouble({
    train: () => ({ status: 0, payload: LEGACY_RESPONSE }),
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    assertEquals(nativeBackpropDeadlineCapability(), undefined);
    const response = nativeBackpropTrain(trainRequest());
    assertEquals(typeof response.baselineMse, "number");
    assertEquals(received.length, 1);
    assertEquals("deadlineEpochMs" in received[0], false);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrain forwards deadlineEpochMs to a deadline-capable library and parses the new response", () => {
  const deadline = 1_800_000_000_000;
  const { handle, received } = makeDouble({
    capabilities: CAPABILITIES,
    train: () => ({ status: 0, payload: COMPLETED_RESPONSE }),
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    assertEquals(nativeBackpropDeadlineCapability()?.version, 1);
    const response = nativeBackpropTrain(
      trainRequest({ deadlineEpochMs: deadline }),
    );
    assertEquals(received.length, 1);
    assertEquals(received[0].deadlineEpochMs, deadline);
    assertEquals(response.timedOut, false);
    assertEquals(response.completedEpochs, 1);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrain refuses a negative deadlineEpochMs before the native train call", () => {
  const { handle, received } = makeDouble({
    capabilities: CAPABILITIES,
    train: () => ({ status: 0, payload: COMPLETED_RESPONSE }),
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = captureError(() =>
      nativeBackpropTrain(trainRequest({ deadlineEpochMs: -1 }))
    );
    assertStringIncludes(error.message, "non-negative safe integer");
    assertEquals(received.length, 0);
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrain refuses a legacy-shaped response from a deadline-capable library", () => {
  const { handle } = makeDouble({
    capabilities: CAPABILITIES,
    train: () => ({ status: 0, payload: LEGACY_RESPONSE }),
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = captureError(() => nativeBackpropTrain(trainRequest()));
    assertStringIncludes(error.message, '"timedOut"');
  } finally {
    closeNativeBackpropLibrary();
  }
});

Deno.test("nativeBackpropTrain throws the native error message on a non-OK status", () => {
  const { handle } = makeDouble({
    capabilities: CAPABILITIES,
    train: () => ({ status: 2, payload: "boom: trainer failed" }),
  });
  try {
    assert(__installNativeBackpropLibraryForTests(handle));
    const error = captureError(() => nativeBackpropTrain(trainRequest()));
    assertStringIncludes(error.message, "status 2");
    assertStringIncludes(error.message, "boom: trainer failed");
  } finally {
    closeNativeBackpropLibrary();
  }
});

// --- real library (optional) -----------------------------------------------

const REQUIRE_FFI = Deno.env.get("NEAT_AI_BACKPROP_REQUIRE_FFI") === "1";
const realLibPath = findNativeBackpropLibrary();

Deno.test({
  name:
    "real libneat_ai_backpropagation deadline capability matches what the binary advertises (requires native libneat_ai_backpropagation)",
  ignore: realLibPath === null && !REQUIRE_FFI,
  fn: () => {
    try {
      if (realLibPath === null) {
        throw new Error(
          "NEAT_AI_BACKPROP_REQUIRE_FFI=1 but no libneat_ai_backpropagation was found",
        );
      }
      const probeSymbols = {
        neat_backprop_capabilities: {
          parameters: [],
          result: "pointer",
          nonblocking: false,
          optional: true,
        },
      } as const;
      const probe = Deno.dlopen(realLibPath, probeSymbols);
      const advertises = probe.symbols.neat_backprop_capabilities !== null;
      probe.close();

      const capability = nativeBackpropDeadlineCapability();
      if (advertises) {
        assertEquals(capability?.version, 1);
      } else {
        assertEquals(capability, undefined);
      }
    } finally {
      closeNativeBackpropLibrary();
    }
  },
});
