/**
 * Issue #3816 — the TypeScript export path emits exactly one memetic
 * `weights` wire shape: an array of `{ fromUUID, toUUID, weight }` rows, in
 * the top-level snapshot **and** in every `ancestry[]` snapshot.
 *
 * The canonical shape is normative in `test/fixtures/golden/README.md`
 * ("The canonical memetic wire shape"). These are "what" tests: they assert on
 * the exported JSON of a real creature, never on how the converter reaches it.
 *
 * Issue #3810 is why this matters — a map where the contract says array broke
 * every `rust_scorer` run, and the empty case (`"weights": []`) was the most
 * common casualty.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";
import type { MemeticWireData } from "@blackbox/MemeticWireData.ts";
import { Creature } from "@creature";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { ValidationError } from "@errors/ValidationError.ts";

const HIDDEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HIDDEN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: HIDDEN_A, squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: HIDDEN_B, squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: HIDDEN_A, weight: -0.3 },
      { fromUUID: "input-1", toUUID: HIDDEN_A, weight: 0.4 },
      { fromUUID: HIDDEN_A, toUUID: HIDDEN_B, weight: -0.5 },
      { fromUUID: HIDDEN_B, toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
    semanticVersion: "4.0.0",
  };
  return Creature.fromJSON(json);
}

/** Runtime integer id of a neuron by its wire uuid. */
function idOf(creature: Creature, uuid: string): number {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  assert(neuron, `creature must carry neuron ${uuid}`);
  return neuron.id;
}

/** The top-level snapshot plus every ancestry snapshot beneath it. */
function snapshotsOf(memetic: MemeticWireData): MemeticWireData[] {
  const flat: MemeticWireData[] = [memetic];
  for (const ancestor of memetic.ancestry ?? []) {
    flat.push(...snapshotsOf(ancestor));
  }
  return flat;
}

/**
 * Asserts every snapshot of an exported memetic block carries the canonical
 * `weights` shape, and returns the row counts (most recent snapshot first).
 */
function assertCanonicalShape(
  memetic: MemeticInterface | undefined,
  where: string,
): number[] {
  assert(memetic, `${where}: export must carry a memetic block`);
  const counts: number[] = [];
  const snapshots = snapshotsOf(memetic as unknown as MemeticWireData);
  snapshots.forEach((snapshot, index) => {
    const weights = snapshot.weights;
    assert(
      Array.isArray(weights),
      `${where}: snapshot ${index} weights must be an array of rows, not ${
        weights === undefined ? "absent" : JSON.stringify(weights)
      }`,
    );
    for (const row of weights) {
      assertEquals(
        Object.keys(row).sort(),
        ["fromUUID", "toUUID", "weight"],
        `${where}: snapshot ${index} row carries exactly the canonical keys`,
      );
      assert(
        typeof row.fromUUID === "string" && row.fromUUID.length > 0,
        `${where}: snapshot ${index} fromUUID must be a wire uuid`,
      );
      assert(
        typeof row.toUUID === "string" && row.toUUID.length > 0,
        `${where}: snapshot ${index} toUUID must be a wire uuid`,
      );
      assertEquals(
        typeof row.weight,
        "number",
        `${where}: snapshot ${index} weight must be a number`,
      );
    }
    counts.push(weights.length);
  });
  return counts;
}

Deno.test("a populated memetic exports canonical weight rows (#3816)", () => {
  const creature = makeCreature();
  const a = idOf(creature, HIDDEN_A);
  const b = idOf(creature, HIDDEN_B);
  const out = idOf(creature, "output-0");

  creature.memetic = {
    generation: 5,
    score: 0.71,
    biases: { [a]: 0.11, [out]: -0.12 },
    weights: {
      [a]: [{ toId: b, weight: -0.55 }],
      [b]: [{ toId: out, weight: 0.66 }],
    },
    ancestry: [
      {
        generation: 4,
        score: 0.69,
        biases: { [a]: 0.1 },
        weights: { [a]: [{ toId: b, weight: -0.54 }] },
      },
    ],
  };

  assertEquals(
    assertCanonicalShape(creature.exportJSON().memetic, "exportJSON"),
    [2, 1],
    "every runtime-id weight entry becomes exactly one wire row",
  );
  assertEquals(
    assertCanonicalShape(
      exportJSONWithRuntimeIds(creature).memetic,
      "exportJSONWithRuntimeIds",
    ),
    [2, 1],
    "the runtime-id export path emits the same canonical rows",
  );

  const rows = creature.exportJSON().memetic!
    .weights as unknown as { fromUUID: string; toUUID: string }[];
  assert(
    rows.some((r) => r.fromUUID === HIDDEN_A && r.toUUID === HIDDEN_B),
    "runtime ids are resolved to wire uuids in the emitted rows",
  );
});

Deno.test("an empty memetic exports the canonical empty array (#3816)", () => {
  const creature = makeCreature();
  creature.memetic = {
    generation: 1,
    score: 0.5,
    biases: {},
    weights: {},
  };

  const exported = creature.exportJSON().memetic;
  assertEquals(
    assertCanonicalShape(exported, "empty exportJSON"),
    [0],
    "an empty weight map serialises as the canonical empty array",
  );
  assertEquals(
    JSON.parse(JSON.stringify(exported)).weights,
    [],
    "the empty value is [] — never {} and never a missing key",
  );
  assertEquals(
    assertCanonicalShape(
      exportJSONWithRuntimeIds(creature).memetic,
      "empty exportJSONWithRuntimeIds",
    ),
    [0],
    "the runtime-id export path agrees on the canonical empty value",
  );
});

Deno.test("a memetic missing weights still exports the key (#3816)", () => {
  const creature = makeCreature();
  // A snapshot written before `weights` was always populated: the key is
  // simply absent, top level and in ancestry.
  creature.memetic = {
    generation: 2,
    score: 0.6,
    biases: {},
    ancestry: [{ generation: 1, score: 0.55, biases: {} }],
  } as unknown as MemeticInterface;

  assertEquals(
    assertCanonicalShape(creature.exportJSON().memetic, "absent weights"),
    [0, 0],
    "an absent weights key is emitted as the canonical empty array",
  );
});

Deno.test("no creature mixes the two weight shapes across snapshots (#3816)", () => {
  const creature = makeCreature();
  const a = idOf(creature, HIDDEN_A);
  const b = idOf(creature, HIDDEN_B);

  // Deliberately mixed input: a populated map at the top, an already-converted
  // row array in one ancestor, an empty map in another, nothing in a third.
  creature.memetic = {
    generation: 6,
    score: 0.8,
    biases: {},
    weights: { [a]: [{ toId: b, weight: 0.2 }] },
    ancestry: [
      {
        generation: 5,
        score: 0.79,
        biases: {},
        weights: [
          { fromUUID: HIDDEN_A, toUUID: HIDDEN_B, weight: 0.19 },
        ] as unknown as MemeticInterface["weights"],
      },
      { generation: 4, score: 0.78, biases: {}, weights: {} },
      { generation: 3, score: 0.77, biases: {} } as unknown as never,
    ],
  };

  assertEquals(
    assertCanonicalShape(creature.exportJSON().memetic, "mixed input"),
    [1, 1, 0, 0],
    "every snapshot lands on the row array, whatever it started as",
  );
});

Deno.test("a weights value that is neither array nor map fails loud (#3816)", () => {
  for (const broken of [7, "rows", null, true]) {
    const creature = makeCreature();
    creature.memetic = {
      generation: 1,
      score: 0.5,
      biases: {},
      weights: broken as unknown as MemeticInterface["weights"],
    };
    const error = assertThrows(
      () => creature.exportJSON(),
      ValidationError,
      "memetic",
      `weights=${JSON.stringify(broken)} must not be exported silently`,
    );
    assertEquals((error as ValidationError).reason, "MEMETIC");
  }
});

Deno.test("an ancestry that is not an array fails loud (#3816)", () => {
  const creature = makeCreature();
  creature.memetic = {
    generation: 1,
    score: 0.5,
    biases: {},
    weights: {},
    ancestry: { generation: 0 } as unknown as MemeticInterface["ancestry"],
  };

  const error = assertThrows(
    () => creature.exportJSON(),
    ValidationError,
    "ancestry",
  );
  assertEquals((error as ValidationError).reason, "MEMETIC");
});

Deno.test("a legacy map-shaped memetic still loads (#3816)", () => {
  // Backward compatibility: creature JSON already on disk may carry the map
  // shape. The import path stays tolerant of it indefinitely; the export path
  // rewrites it to the canonical rows.
  const legacy = {
    neurons: [
      { type: "hidden", uuid: HIDDEN_A, squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: HIDDEN_B, squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: HIDDEN_A, weight: -0.3 },
      { fromUUID: "input-1", toUUID: HIDDEN_A, weight: 0.4 },
      { fromUUID: HIDDEN_A, toUUID: HIDDEN_B, weight: -0.5 },
      { fromUUID: HIDDEN_B, toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
    semanticVersion: "4.0.0",
    memetic: {
      generation: 4,
      score: 0.9,
      biases: { "output-0": -0.2 },
      weights: {
        [HIDDEN_A]: [{ toUUID: HIDDEN_B, weight: 0.42 }],
      },
      ancestry: [{
        generation: 3,
        score: 0.8,
        biases: { "output-0": -0.3 },
        weights: { "input-0": [{ toUUID: HIDDEN_A, weight: 0.11 }] },
      }],
    },
  } as unknown as CreatureExport;

  const creature = Creature.fromJSON(legacy);
  assert(creature.memetic, "the legacy memetic block must survive the load");
  assertEquals(creature.memetic.generation, 4);
  assertEquals(creature.memetic.score, 0.9);

  const exported = creature.exportJSON().memetic;
  assertEquals(
    assertCanonicalShape(exported, "legacy re-export"),
    [1, 1],
    "an old-shape creature re-exports as canonical rows",
  );
  assertEquals(
    JSON.parse(JSON.stringify(exported)).weights,
    [{ fromUUID: HIDDEN_A, toUUID: HIDDEN_B, weight: 0.42 }],
    "the legacy map entry keeps its endpoints and weight",
  );
});
