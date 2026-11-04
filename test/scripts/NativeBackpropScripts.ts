/**
 * The native-backprop check and the deadline probe (Issue #4119).
 *
 * Both are driven by `quality.sh --next` and the engine-gated integration
 * test. The decisions they make (which adapter a scenario forces, when the
 * precondition refuses, what the fixtures contain, how the library check
 * reports) run here without a native engine.
 */

import { assert, assertEquals } from "@std/assert";
import { getLogger, setLogger } from "@utils/Logger.ts";
import {
  checkNativeBackprop,
  type NativeBackpropCheckDeps,
} from "../../scripts/check_native_backprop_train.ts";
import {
  adapterFrom,
  chainCreatureJSON,
  checkAdapterPrecondition,
  fail,
  installRecorder,
  recordsFor,
  SCENARIO_ADAPTER,
  wideCreatureJSON,
} from "../../scripts/native_deadline_probe.ts";

// --- check_native_backprop_train ---------------------------------------------

function deps(over: Partial<NativeBackpropCheckDeps> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  let closed = 0;
  const value: NativeBackpropCheckDeps = {
    findLibrary: () => "/lib/libneat.so",
    isAvailable: () => true,
    version: () => "1.2.3",
    deadlineCapability: () => ({ version: 1 }),
    close: () => closed++,
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    ...over,
  };
  return { value, logs, errors, closed: () => closed };
}

Deno.test("native check: a missing library fails and says how to fix it", () => {
  const d = deps({ findLibrary: () => null });
  assertEquals(checkNativeBackprop(d.value), 1);
  assertEquals(d.errors.length, 3);
  assert(d.errors[0].includes("was not found"));
  assert(d.errors[2].includes("NEAT_AI_BACKPROP_LIB_PATH"));
  assertEquals(d.logs, []);
});

Deno.test("native check: a library that will not load fails and is closed", () => {
  const d = deps({ isAvailable: () => false });
  assertEquals(checkNativeBackprop(d.value), 1);
  assertEquals(d.errors.length, 1);
  assert(d.errors[0].includes("/lib/libneat.so"));
  assert(d.errors[0].includes("failed to load"));
  assertEquals(d.closed(), 1);
});

Deno.test("native check: a deadline-capable library passes and is closed", () => {
  const d = deps();
  assertEquals(checkNativeBackprop(d.value), 0);
  assertEquals(d.errors, []);
  assertEquals(d.logs.length, 2);
  assert(d.logs[0].includes("v1.2.3"));
  assert(d.logs[0].includes("/lib/libneat.so"));
  assert(d.logs[1].includes("deadline capability v1"));
  assertEquals(d.closed(), 1);
});

Deno.test("native check: an unknown version is named as such", () => {
  const d = deps({ version: () => null });
  assertEquals(checkNativeBackprop(d.value), 0);
  assert(d.logs[0].includes("v(unknown)"));
});

Deno.test("native check: a legacy library passes with a warning", () => {
  const d = deps({ deadlineCapability: () => undefined });
  assertEquals(checkNativeBackprop(d.value), 0);
  assertEquals(d.logs.length, 2);
  assert(d.logs[1].includes("not enforced natively"));
  assertEquals(d.errors, []);
  assertEquals(d.closed(), 1);
});

Deno.test("native check: a malformed capability fails with its message", () => {
  const d = deps({
    deadlineCapability: () => {
      throw new Error("bad capability shape");
    },
  });
  assertEquals(checkNativeBackprop(d.value), 1);
  assertEquals(d.errors.length, 1);
  assert(d.errors[0].includes("malformed capability: bad capability shape"));
  assertEquals(d.closed(), 1);
});

Deno.test("native check: a non-Error throw is reported as text", () => {
  const d = deps({
    deadlineCapability: () => {
      // deno-lint-ignore no-throw-literal
      throw "plain text";
    },
  });
  assertEquals(checkNativeBackprop(d.value), 1);
  assert(d.errors[0].includes("malformed capability: plain text"));
});

// --- native_deadline_probe ---------------------------------------------------

Deno.test("probe: every scenario forces the adapter its name says", () => {
  assertEquals(SCENARIO_ADAPTER, {
    "ffi-productive": "ffi",
    "cli-productive": "cli",
    "ffi-expired": "ffi",
    "cli-expired": "cli",
    "legacy-ffi": "ffi",
    "legacy-cli": "cli",
    "worker-productive": "ffi",
  });
});

/** Run `body` with `Deno.exit` and `console.error` captured. */
function captureExit(body: () => void): { code?: number; messages: string[] } {
  const originalExit = Deno.exit;
  const originalError = console.error;
  const messages: string[] = [];
  const result: { code?: number; messages: string[] } = { messages };
  console.error = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  Deno.exit = ((code?: number) => {
    result.code = code;
    throw new Error("exit-sentinel");
  }) as typeof Deno.exit;
  try {
    body();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "exit-sentinel") {
      throw error;
    }
  } finally {
    Deno.exit = originalExit;
    console.error = originalError;
  }
  return result;
}

Deno.test("probe: fail prints the message and exits with the code", () => {
  const out = captureExit(() => fail(7, "boom"));
  assertEquals(out.code, 7);
  assertEquals(out.messages, ["boom"]);
});

Deno.test("probe: the recorder keeps info and warnings, and routes errors to warnings", () => {
  const original = getLogger();
  try {
    const recorded = installRecorder();
    const logger = getLogger();
    logger.debug("ignored");
    logger.info("one", 2);
    logger.warn("two");
    logger.error("three", "x");
    assertEquals(recorded.infos, ["one 2"]);
    assertEquals(recorded.warnings, ["two", "three x"]);
  } finally {
    setLogger(original);
  }
});

Deno.test("probe: adapterFrom names the adapter the bridge logged", () => {
  assertEquals(adapterFrom([]), { adapter: "none", log: null });
  assertEquals(adapterFrom(["unrelated", "trainDir using TypeScript"]), {
    adapter: "none",
    log: null,
  });
  assertEquals(adapterFrom(["a", "x trainDir using FFI y"]), {
    adapter: "ffi",
    log: "x trainDir using FFI y",
  });
  assertEquals(adapterFrom(["trainDir using CLI"]), {
    adapter: "cli",
    log: "trainDir using CLI",
  });
});

Deno.test("probe: an FFI scenario needs a library and REQUIRE_FFI=1", () => {
  const noLib = captureExit(() =>
    checkAdapterPrecondition("ffi", null, () => "1")
  );
  assertEquals(noLib.code, 2);
  assert(noLib.messages[0].includes("no libneat_ai_backpropagation resolves"));

  const noRequire = captureExit(() =>
    checkAdapterPrecondition("ffi", "/lib/x.so", () => undefined)
  );
  assertEquals(noRequire.code, 2);
  assert(noRequire.messages[0].includes("NEAT_AI_BACKPROP_REQUIRE_FFI=1"));

  const wrongValue = captureExit(() =>
    checkAdapterPrecondition("ffi", "/lib/x.so", () => "0")
  );
  assertEquals(wrongValue.code, 2);

  const ok = captureExit(() =>
    checkAdapterPrecondition("ffi", "/lib/x.so", () => "1")
  );
  assertEquals(ok.code, undefined);
  assertEquals(ok.messages, []);
});

Deno.test("probe: a CLI scenario needs no library and a binary path", () => {
  const withLib = captureExit(() =>
    checkAdapterPrecondition("cli", "/lib/x.so", () => "bin")
  );
  assertEquals(withLib.code, 2);
  assert(withLib.messages[0].includes("/lib/x.so"));

  const noBinary = captureExit(() =>
    checkAdapterPrecondition("cli", null, () => undefined)
  );
  assertEquals(noBinary.code, 2);
  assert(noBinary.messages[0].includes("NEAT_AI_BACKPROP_BINARY_PATH"));

  const emptyBinary = captureExit(() =>
    checkAdapterPrecondition("cli", null, () => "")
  );
  assertEquals(emptyBinary.code, 2);

  const ok = captureExit(() =>
    checkAdapterPrecondition("cli", null, () => "/bin/neat")
  );
  assertEquals(ok.code, undefined);
});

Deno.test("probe: recordsFor cycles x through 0.1..1.0 and doubles it", () => {
  const records = recordsFor(12);
  assertEquals(records.length, 12);
  assertEquals(Array.from(records[0].input), [Math.fround(0.1)]);
  assertEquals(Array.from(records[0].output), [Math.fround(0.2)]);
  assertEquals(records[9].input[0], Math.fround(1.0));
  assertEquals(records[9].output[0], Math.fround(2.0));
  assertEquals(records[10].input[0], records[0].input[0]);
});

Deno.test("probe: the wide creature fans one input through every hidden neuron", () => {
  const json = wideCreatureJSON(4) as {
    semanticVersion: string;
    forwardOnly: boolean;
    input: number;
    output: number;
    neurons: { type: string; uuid: string; bias: number; squash: string }[];
    synapses: { fromUUID: string; toUUID: string; weight: number }[];
  };
  assertEquals(json.semanticVersion, "4.0.0");
  assertEquals(json.forwardOnly, true);
  assertEquals([json.input, json.output], [1, 1]);
  assertEquals(json.neurons.map((n) => n.uuid), ["h0", "h1", "h2", "h3", "o1"]);
  assertEquals(json.neurons[0], {
    type: "hidden",
    uuid: "h0",
    bias: 0,
    squash: "IDENTITY",
  });
  assertEquals(json.neurons[4].type, "output");
  assertEquals(json.synapses.length, 8);
  assertEquals(json.synapses[0], {
    fromUUID: "input-0",
    toUUID: "h0",
    weight: 1,
  });
  assertEquals(json.synapses[4], {
    fromUUID: "h0",
    toUUID: "o1",
    weight: 0.25,
  });
});

Deno.test("probe: the chain creature links input to output through each hidden neuron", () => {
  const json = chainCreatureJSON(3) as {
    semanticVersion: string;
    forwardOnly: boolean;
    input: number;
    output: number;
    neurons: { uuid: string; type: string }[];
    synapses: { fromUUID: string; toUUID: string; weight: number }[];
  };
  assertEquals(json.semanticVersion, "4.0.0");
  assertEquals(json.forwardOnly, true);
  assertEquals([json.input, json.output], [1, 1]);
  assertEquals(json.neurons.map((n) => n.uuid), ["h0", "h1", "h2", "o1"]);
  assertEquals(
    json.synapses.map((s) => `${s.fromUUID}>${s.toUUID}:${s.weight}`),
    ["input-0>h0:1", "h0>h1:1", "h1>h2:1", "h2>o1:1"],
  );
});
