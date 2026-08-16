import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Creature } from "@creature";
import { Costs } from "@costs";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import {
  __closeNativeBackpropLibraryForTests,
  __setRustTrainDirEnabledForTests,
  canUseRustTrainDir,
  findRustTrainDirBinary,
  findRustTrainDirBinaryFromOptions,
  isRustTrainDirEnabled,
  parseRustTrainDirEnabledFlag,
  rustTrainDirRefusalReason,
  rustTrainDirSkipReason,
} from "@architecture/training/RustTrainDirBridge.ts";
import {
  closeNativeBackpropLibrary,
  findNativeBackpropLibrary,
  findNativeBackpropLibraryFromOptions,
  isNativeBackpropAvailable,
  nativeBackpropLibFileName,
} from "@architecture/training/NativeBackpropLibrary.ts";
import { prepareTraining } from "@architecture/training/TrainingSetup.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";

class ConstantCost implements CostInterface {
  getName(): string {
    return "ConstantCost";
  }
  calculate(_target: Float32Array, _output: Float32Array): number {
    return 1;
  }
}

Deno.test("Rust trainDir binary: override file path wins", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const override = join(dir, "neat_ai_backpropagation");
    Deno.writeTextFileSync(override, "");
    const found = findRustTrainDirBinaryFromOptions({
      overridePath: override,
      cwd: join(dir, "missing-cwd"),
      siblingPath: join(dir, "missing-sibling"),
    });
    assertEquals(found, override);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Rust trainDir binary: missing candidates return null", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const found = findRustTrainDirBinaryFromOptions({
      overridePath: join(dir, "nope"),
      cwd: dir,
      siblingPath: join(dir, "also-nope"),
    });
    assertEquals(found, null);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Native backprop library: override file path wins", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const override = join(dir, nativeBackpropLibFileName());
    Deno.writeTextFileSync(override, "");
    const found = findNativeBackpropLibraryFromOptions({
      overridePath: override,
      cwd: join(dir, "missing-cwd"),
      siblingDir: join(dir, "missing-sibling"),
      homeDir: join(dir, "missing-home"),
    });
    assertEquals(found, override);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Native backprop library: missing candidates return null", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const found = findNativeBackpropLibraryFromOptions({
      overridePath: join(dir, "nope"),
      cwd: dir,
      siblingDir: join(dir, "also-nope"),
      homeDir: join(dir, "no-home"),
    });
    assertEquals(found, null);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Rust trainDir: custom cost stays on the TypeScript loop", () => {
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    canUseRustTrainDir(
      creature,
      { iterations: 1 },
      new ConstantCost(),
      setup,
      true,
    ),
    false,
  );
  assertEquals(
    rustTrainDirSkipReason(
      creature,
      { iterations: 1 },
      new ConstantCost(),
      setup,
    )?.includes("not used by WASM backprop"),
    true,
  );
  assertEquals(
    rustTrainDirRefusalReason(
      creature,
      { iterations: 1 },
      new ConstantCost(),
      setup,
    ),
    undefined,
  );
});

Deno.test("Rust trainDir flag: only explicit off disables a default-on feature", () => {
  assertEquals(parseRustTrainDirEnabledFlag(undefined), true);
  assertEquals(parseRustTrainDirEnabledFlag("0"), false);
  assertEquals(parseRustTrainDirEnabledFlag("false"), false);
  assertEquals(parseRustTrainDirEnabledFlag("NO"), false);
  assertEquals(parseRustTrainDirEnabledFlag("1"), true);
  assertEquals(parseRustTrainDirEnabledFlag("true"), true);
  assertEquals(parseRustTrainDirEnabledFlag("yes"), true);
  assertEquals(parseRustTrainDirEnabledFlag("on"), true);
  assertEquals(parseRustTrainDirEnabledFlag("enabled"), true);
  assertEquals(parseRustTrainDirEnabledFlag("  ON  "), true);
});

Deno.test("Rust trainDir is on by default unless NEAT_AI_BACKPROP_ENABLED=0", () => {
  const raw = Deno.env.get("NEAT_AI_BACKPROP_ENABLED");
  const expected = raw === undefined ||
    !["0", "false", "no"].includes(raw.trim().toLowerCase());
  assertEquals(isRustTrainDirEnabled(), expected);
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    canUseRustTrainDir(
      creature,
      { iterations: 1 },
      Costs.find("MSE"),
      setup,
      false,
    ),
    false,
  );
  if (
    findNativeBackpropLibrary() !== null || findRustTrainDirBinary() !== null
  ) {
    assertEquals(
      canUseRustTrainDir(
        creature,
        { iterations: 1 },
        Costs.find("MSE"),
        setup,
        true,
      ),
      true,
    );
  }
});

Deno.test("Rust trainDir: custom cost skips Rust and trains on the TypeScript loop", () => {
  const creature = new Creature(2, 1);
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  __setRustTrainDirEnabledForTests(true);
  try {
    const result = trainDir(
      creature,
      dataDir,
      { iterations: 1, disableRandomSamples: true },
      new ConstantCost(),
    );
    assert(Number.isFinite(result.error), "error should be finite");
    assert(result.iteration >= 1);
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir: dropout skips Rust and trains on the TypeScript loop", () => {
  const creature = new Creature(2, 1);
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  __setRustTrainDirEnabledForTests(true);
  try {
    const result = trainDir(
      creature,
      dataDir,
      { iterations: 1, disableRandomSamples: true, dropoutRate: 0.2 },
      Costs.find("MSE"),
    );
    assert(Number.isFinite(result.error), "error should be finite");
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir: recurrent skips Rust and trains on the TypeScript loop", () => {
  const creature = new Creature(2, 1, { feedbackEnabled: true });
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    rustTrainDirSkipReason(
      creature,
      { iterations: 1, disableRandomSamples: true },
      Costs.find("MSE"),
      setup,
    )?.includes("recurrent"),
    true,
  );

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  __setRustTrainDirEnabledForTests(true);
  try {
    const result = trainDir(
      creature,
      dataDir,
      { iterations: 1, disableRandomSamples: true },
      Costs.find("MSE"),
    );
    assert(Number.isFinite(result.error), "error should be finite");
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("Rust trainDir: non-backprop options skip the Rust app", () => {
  const forward = new Creature(2, 1);
  const recurrent = new Creature(2, 1, { feedbackEnabled: true });
  const mse = Costs.find("MSE");
  const cases: Array<{
    name: string;
    creature: Creature;
    options: TrainOptions;
    cost: CostInterface;
    needle: string;
  }> = [
    {
      name: "predictive coding",
      creature: forward,
      options: { iterations: 1, predictiveCoding: { enabled: true } },
      cost: mse,
      needle: "predictive coding",
    },
    {
      name: "cross-validation",
      creature: forward,
      options: { iterations: 1, crossValidation: { enabled: true } },
      cost: mse,
      needle: "cross-validation",
    },
    {
      name: "custom cost",
      creature: forward,
      options: { iterations: 1 },
      cost: new ConstantCost(),
      needle: "not used by WASM backprop",
    },
    {
      name: "fuzzing",
      creature: forward,
      options: { iterations: 1, dataFuzzing: { enabled: true } },
      cost: mse,
      needle: "fuzzing",
    },
    {
      name: "quantisation",
      creature: forward,
      options: { iterations: 1, dataQuantisation: { enabled: true } },
      cost: mse,
      needle: "quantisation",
    },
    {
      name: "dropout",
      creature: forward,
      options: { iterations: 1, dropoutRate: 0.2 },
      cost: mse,
      needle: "dropout",
    },
    {
      name: "Muon",
      creature: forward,
      options: { iterations: 1, gradientOrthogonalisation: "muon" },
      cost: mse,
      needle: "Muon",
    },
    {
      name: "recurrent",
      creature: recurrent,
      options: { iterations: 1 },
      cost: mse,
      needle: "recurrent",
    },
    {
      name: "feedbackLoop",
      creature: forward,
      options: {
        iterations: 1,
        feedbackLoop: true,
        disableRandomSamples: true,
      },
      cost: mse,
      needle: "feedbackLoop",
    },
  ];

  for (const c of cases) {
    const uuid = CreatureUtil.makeUUID(c.creature);
    const setup = prepareTraining(
      c.creature,
      { ...c.options, disableRandomSamples: true },
      uuid.substring(Math.max(0, uuid.length - 8)),
    );
    const reason = rustTrainDirSkipReason(
      c.creature,
      c.options,
      c.cost,
      setup,
    );
    assert(reason !== undefined, `${c.name} should skip Rust`);
    assert(
      reason.includes(c.needle),
      `${c.name} skip reason should mention ${c.needle}, got ${reason}`,
    );
    assertEquals(
      canUseRustTrainDir(c.creature, c.options, c.cost, setup, true),
      false,
      `${c.name} must not call the Rust app`,
    );
  }
});

Deno.test("Rust trainDir: trainingSampleRate with disableRandomSamples is eligible", () => {
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true, trainingSampleRate: 0.5 },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    rustTrainDirSkipReason(
      creature,
      { iterations: 1, disableRandomSamples: true, trainingSampleRate: 0.5 },
      Costs.find("MSE"),
      setup,
    ),
    undefined,
  );
  if (
    findNativeBackpropLibrary() !== null || findRustTrainDirBinary() !== null
  ) {
    assertEquals(
      canUseRustTrainDir(
        creature,
        { iterations: 1, disableRandomSamples: true, trainingSampleRate: 0.5 },
        Costs.find("MSE"),
        setup,
        true,
      ),
      true,
    );
  }
});

Deno.test("Rust trainDir: random trainingSampleRate is eligible (Backpropagation#77)", () => {
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: false, trainingSampleRate: 0.5 },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    rustTrainDirSkipReason(
      creature,
      { iterations: 1, disableRandomSamples: false, trainingSampleRate: 0.5 },
      Costs.find("MSE"),
      setup,
    ),
    undefined,
  );
  if (
    findNativeBackpropLibrary() !== null || findRustTrainDirBinary() !== null
  ) {
    assertEquals(
      canUseRustTrainDir(
        creature,
        { iterations: 1, disableRandomSamples: false, trainingSampleRate: 0.5 },
        Costs.find("MSE"),
        setup,
        true,
      ),
      true,
    );
  }
});

Deno.test({
  name: "Rust trainDir FFI: MSE forward-only trains when library is present",
  fn: () => {
    closeNativeBackpropLibrary();
    __closeNativeBackpropLibraryForTests();
    if (!isNativeBackpropAvailable()) {
      return;
    }
    const creature = new Creature(2, 1);
    const dataSet: DataRecordInterface[] = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
    ];
    const dataDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });
    __setRustTrainDirEnabledForTests(true);
    try {
      const result = trainDir(
        creature,
        dataDir,
        { iterations: 2, targetError: 0.5, disableRandomSamples: true },
        Costs.find("MSE"),
      );
      assert(Number.isFinite(result.error), "error should be finite");
      assert(result.iteration >= 1);
    } finally {
      __setRustTrainDirEnabledForTests(undefined);
      closeNativeBackpropLibrary();
      Deno.removeSync(dataDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test("Rust trainDir: MSE forward-only still trains when Rust is unused", () => {
  const creature = new Creature(2, 1);
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  __setRustTrainDirEnabledForTests(false);
  try {
    const result = trainDir(
      creature,
      dataDir,
      { iterations: 2, targetError: 0.5, disableRandomSamples: true },
      Costs.find("MSE"),
    );
    assert(Number.isFinite(result.error), "error should be finite");
    assert(result.iteration >= 1);
  } finally {
    __setRustTrainDirEnabledForTests(undefined);
    Deno.removeSync(dataDir, { recursive: true });
  }
});
