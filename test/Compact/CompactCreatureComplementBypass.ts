import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { COMPLEMENT } from "../../src/methods/activations/types/COMPLEMENT.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { MAXIMUM } from "../../src/methods/activations/aggregate/MAXIMUM.ts";

function makeData(p: number, input: number): Float32Array {
  const data = new Float32Array(input);
  switch (p) {
    case 0:
      data.fill(0);
      return data;
    case 1:
      data.fill(1);
      return data;
    case 2:
      data.fill(-1);
      return data;
    default:
      for (let i = 0; i < input; i++) data[i] = Math.random() * 4 - 2;
      return data;
  }
}

Deno.test("compactCreature: bypass COMPLEMENT feeding IDENTITY output (safe algebraic fold)", () => {
  // Arrange
  //
  // hidden-0: COMPLEMENT
  // output-0: IDENTITY
  //
  // output = (wDirect * x1) + wHidden * (1 - (bHidden + w0*x0 + w1*x1)) + bOut
  //
  // After bypass we should get:
  // output = (-wHidden*w0)*x0 + (-wHidden*w1 + wDirect)*x1 + (bOut + wHidden*(1 - bHidden))

  const directory = ".test/Compact/CompactCreatureComplementBypass/safe";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: 0.25,
        type: "hidden",
        squash: COMPLEMENT.NAME,
        uuid: "hidden-0",
      },
      {
        bias: 0.1,
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-0",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.5 },
      // Existing direct link (tests weight merge behaviour)
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.25 },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  Deno.writeTextFileSync(
    `${directory}/complex.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  // Act
  const compacted = compactCreature(creature, true);

  // Assert
  assert(compacted, "Expected compaction to occur");
  compacted.validate();

  const exported = compacted.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/compacted.json`,
    JSON.stringify(exported, null, 1),
  );

  // hidden-0 should be gone
  assertEquals(
    exported.neurons.some((n) => n.uuid === "hidden-0"),
    false,
    "Expected COMPLEMENT neuron to be removed",
  );

  const out = exported.neurons.find((n) => n.uuid === "output-0");
  assert(out);

  // Bias: bOut + wHidden*(1 - bHidden) = 0.1 + 1.5*(1 - 0.25) = 1.225
  assertAlmostEquals(out.bias, 1.225, 1e-12);

  const wByFrom = new Map(
    exported.synapses
      .filter((s) => s.toUUID === "output-0")
      .map((s) => [s.fromUUID, s.weight] as const),
  );

  // input-0 weight: -wHidden*w0 = -1.5*0.5 = -0.75
  assertAlmostEquals(wByFrom.get("input-0") ?? NaN, -0.75, 1e-12);

  // input-1 weight: (-wHidden*w1) + wDirect = (-1.5*-2) + 0.25 = 3.25
  assertAlmostEquals(wByFrom.get("input-1") ?? NaN, 3.25, 1e-12);

  for (let p = 0; p < 12; p++) {
    const data = makeData(p, creature.input);
    const a = creature.activate(data, false)[0];
    const b = compacted.activate(data, false)[0];
    assertAlmostEquals(a, b, 0.000_01, `${p}) expected: ${a} actual: ${b}`);
  }
});

Deno.test("compactCreature: does not bypass COMPLEMENT into aggregate squashes (unsafe)", () => {
  const json: CreatureExport = {
    neurons: [
      {
        bias: 0.25,
        type: "hidden",
        squash: COMPLEMENT.NAME,
        uuid: "hidden-0",
      },
      {
        bias: 0.1,
        type: "output",
        squash: MAXIMUM.NAME,
        uuid: "output-0",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.5 },
      // Second input so MAXIMUM actually has a competing value.
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.25 },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, true);

  assertEquals(
    compacted,
    undefined,
    "COMPLEMENT bypass into MAXIMUM is not safe and must not run",
  );
});

Deno.test("compactCreature: bypass COMPLEMENT feeding multiple IDENTITY outputs (safe algebraic fold)", () => {
  const directory = ".test/Compact/CompactCreatureComplementBypass/multi-safe";
  Deno.mkdirSync(directory, { recursive: true });

  const json: CreatureExport = {
    neurons: [
      {
        bias: 0.25,
        type: "hidden",
        squash: COMPLEMENT.NAME,
        uuid: "hidden-0",
      },
      {
        bias: 0.1,
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-0",
      },
      {
        bias: -0.3,
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-1",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.5 },
      { fromUUID: "hidden-0", toUUID: "output-1", weight: -0.4 },
      // Existing direct link (tests weight merge behaviour for output-0)
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.25 },
    ],
    input: 2,
    output: 2,
  };

  const creature = Creature.fromJSON(json);
  Deno.writeTextFileSync(
    `${directory}/complex.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  const compacted = compactCreature(creature, true);
  assert(compacted, "Expected compaction to occur");
  compacted.validate();

  const exported = compacted.exportJSON();
  Deno.writeTextFileSync(
    `${directory}/compacted.json`,
    JSON.stringify(exported, null, 1),
  );

  assertEquals(
    exported.neurons.some((n) => n.uuid === "hidden-0"),
    false,
    "Expected COMPLEMENT neuron to be removed",
  );

  const out0 = exported.neurons.find((n) => n.uuid === "output-0");
  const out1 = exported.neurons.find((n) => n.uuid === "output-1");
  assert(out0);
  assert(out1);

  // Bias folds:
  // output-0: 0.1 + 1.5*(1 - 0.25) = 1.225
  // output-1: -0.3 + (-0.4)*(1 - 0.25) = -0.6
  assertAlmostEquals(out0.bias, 1.225, 1e-12);
  assertAlmostEquals(out1.bias, -0.6, 1e-12);

  const wToOut0 = new Map(
    exported.synapses
      .filter((s) => s.toUUID === "output-0")
      .map((s) => [s.fromUUID, s.weight] as const),
  );
  const wToOut1 = new Map(
    exported.synapses
      .filter((s) => s.toUUID === "output-1")
      .map((s) => [s.fromUUID, s.weight] as const),
  );

  // output-0:
  // input-0 weight: -1.5*0.5 = -0.75
  // input-1 weight: (-1.5*-2) + 0.25 = 3.25
  assertAlmostEquals(wToOut0.get("input-0") ?? NaN, -0.75, 1e-12);
  assertAlmostEquals(wToOut0.get("input-1") ?? NaN, 3.25, 1e-12);

  // output-1:
  // input-0 weight: -(-0.4)*0.5 = 0.2
  // input-1 weight: -(-0.4)*(-2) = -0.8
  assertAlmostEquals(wToOut1.get("input-0") ?? NaN, 0.2, 1e-12);
  assertAlmostEquals(wToOut1.get("input-1") ?? NaN, -0.8, 1e-12);

  for (let p = 0; p < 12; p++) {
    const data = makeData(p, creature.input);
    const a = creature.activate(data, false);
    const b = compacted.activate(data, false);
    assertEquals(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      assertAlmostEquals(
        a[i],
        b[i],
        0.000_01,
        `${p})[${i}] expected: ${a[i]} actual: ${b[i]}`,
      );
    }
  }
});

Deno.test("compactCreature: does not bypass multi-outbound COMPLEMENT when any downstream is aggregate (unsafe)", () => {
  const json: CreatureExport = {
    neurons: [
      {
        bias: 0.25,
        type: "hidden",
        squash: COMPLEMENT.NAME,
        uuid: "hidden-0",
      },
      {
        bias: 0.1,
        type: "output",
        squash: IDENTITY.NAME,
        uuid: "output-0",
      },
      {
        bias: -0.3,
        type: "output",
        squash: MAXIMUM.NAME,
        uuid: "output-1",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.5 },
      { fromUUID: "hidden-0", toUUID: "output-1", weight: -0.4 },
      { fromUUID: "input-1", toUUID: "output-1", weight: 0.25 },
    ],
    input: 2,
    output: 2,
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, true);
  assertEquals(
    compacted,
    undefined,
    "Multi-outbound bypass must not run when any downstream is aggregate",
  );
});
