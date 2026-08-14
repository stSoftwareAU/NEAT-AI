import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Creature } from "@creature";
import { Costs } from "@costs";
import type { CostInterface } from "@costs/CostInterface.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import {
  canUseRustTrainDir,
  findRustTrainDirBinary,
  findRustTrainDirBinaryFromOptions,
  isRustTrainDirEnabled,
} from "@architecture/training/RustTrainDirBridge.ts";
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
});

Deno.test("Rust trainDir is opt-in (TypeScript loop is the default)", () => {
  assertEquals(isRustTrainDirEnabled(), false);
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const setup = prepareTraining(
    creature,
    { iterations: 1, disableRandomSamples: true },
    uuid.substring(Math.max(0, uuid.length - 8)),
  );
  assertEquals(
    canUseRustTrainDir(creature, { iterations: 1 }, Costs.find("MSE"), setup),
    false,
  );
  if (findRustTrainDirBinary() !== null) {
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

Deno.test("Rust trainDir: MSE forward-only still trains when CLI is unused", () => {
  const creature = new Creature(2, 1);
  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];
  const dataDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
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
    Deno.removeSync(dataDir, { recursive: true });
  }
});
