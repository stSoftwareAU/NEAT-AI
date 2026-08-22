/**
 * Issue #3816 — the TypeScript export path emits **only** the canonical
 * memetic wire shape.
 *
 * The canonical shape is defined once, normatively, in
 * `test/fixtures/golden/README.md` ("🧠 The canonical memetic wire shape"):
 * `weights` is an array of `{fromUUID, toUUID, weight}` rows — empty as `[]`,
 * never a map — and `biases` is an object keyed by wire neuron identity, in
 * the top-level snapshot and in every `ancestry[]` snapshot alike.
 *
 * Issue #3810 was caused by that shape being ambiguous rather than by any one
 * bug: the wire type admitted two shapes, so a producer could legitimately
 * emit either. These are "what" tests — they assert on the emitted JSON of a
 * freshly exported creature, whatever runtime shape the memetic block arrived
 * in, so they survive any rewrite of the conversion internals.
 *
 * The companion `import stays tolerant` test pins the opposite direction: a
 * creature saved with the legacy map shape must still load.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";
import type { MemeticWireData } from "@blackbox/MemeticWireData.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import {
  assertBiasMap,
  assertCanonicalMemetic,
  assertWeightRows,
} from "./MemeticWireShapeAssertions.ts";

const HIDDEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HIDDEN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A small two-hidden-neuron creature; memetic is attached by each test. */
function makeCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: HIDDEN_A, squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: HIDDEN_B, squash: "TANH", bias: -0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: HIDDEN_A, weight: 0.4 },
      { fromUUID: "input-1", toUUID: HIDDEN_A, weight: -0.5 },
      { fromUUID: HIDDEN_A, toUUID: HIDDEN_B, weight: 0.6 },
      { fromUUID: HIDDEN_B, toUUID: "output-0", weight: 0.7 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(json);
}

/** Runtime integer id of a neuron, by its wire uuid. */
function idOf(creature: Creature, uuid: string): number {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  assert(neuron, `creature must carry neuron ${uuid}`);
  return neuron.id;
}

/** The memetic block of an export, typed as it appears on the wire. */
function wireMemeticOf(exported: CreatureExport): MemeticWireData {
  const memetic = exported.memetic as unknown as MemeticWireData | undefined;
  assert(memetic, "export must carry a memetic block");
  return memetic;
}

/**
 * The runtime memetic shape production builds: a map keyed by the from-neuron's
 * runtime integer id, each entry `{ toId, weight }`.
 */
function populatedRuntimeMemetic(creature: Creature): MemeticInterface {
  const a = idOf(creature, HIDDEN_A);
  const b = idOf(creature, HIDDEN_B);
  const out = idOf(creature, "output-0");
  return {
    generation: 5,
    score: 0.9,
    biases: { [a]: 0.11, [b]: -0.22, [out]: 0.33 },
    weights: {
      [a]: [{ toId: b, weight: 0.26 }],
      [b]: [{ toId: out, weight: 0.88 }],
    },
    ancestry: [
      {
        generation: 4,
        score: 0.8,
        biases: { [a]: 0.1 },
        weights: { [a]: [{ toId: b, weight: 0.2 }] },
      },
      {
        generation: 3,
        score: 0.7,
        biases: { [b]: -0.2 },
        weights: {},
      },
    ],
  };
}

Deno.test("export emits canonical weight rows for a populated memetic (#3816)", () => {
  const creature = makeCreature();
  creature.memetic = populatedRuntimeMemetic(creature);

  const memetic = wireMemeticOf(creature.exportJSON());
  assertCanonicalMemetic(memetic, "populated export");

  const rows = assertWeightRows(memetic.weights, "populated export");
  assertEquals(rows.length, 2, "both runtime weight entries must be emitted");
  assertEquals(
    rows.map((row) => `${row.fromUUID}→${row.toUUID}=${row.weight}`).sort(),
    [
      `${HIDDEN_A}→${HIDDEN_B}=0.26`,
      `${HIDDEN_B}→output-0=0.88`,
    ].sort(),
    "runtime integer ids must be rewritten to wire uuids without loss",
  );

  const ancestry = memetic.ancestry ?? [];
  assertEquals(
    ancestry.length,
    2,
    "ancestry snapshots must survive the export",
  );
  assertEquals(
    assertWeightRows(ancestry[0].weights, "ancestry 0").length,
    1,
    "the populated ancestry snapshot keeps its weight row",
  );
  assertEquals(
    assertWeightRows(ancestry[1].weights, "ancestry 1").length,
    0,
    "the empty ancestry snapshot serialises as the canonical empty array",
  );
});

Deno.test("export emits the canonical empty value for an empty memetic (#3816)", () => {
  const creature = makeCreature();
  creature.memetic = {
    generation: 1,
    score: 0.5,
    biases: {},
    weights: {},
  };

  const memetic = wireMemeticOf(creature.exportJSON());
  assertCanonicalMemetic(memetic, "empty export");
  assertEquals(
    assertWeightRows(memetic.weights, "empty export").length,
    0,
    "an empty memetic must serialise weights as `[]`, not `{}` and not absent",
  );
  assertEquals(
    JSON.stringify(memetic.weights),
    "[]",
    "the empty weights value is an empty JSON array",
  );
  assertEquals(
    JSON.stringify(memetic.biases),
    "{}",
    "the empty biases value is an empty JSON object",
  );
});

Deno.test("export fills in canonical values for a snapshot missing weights (#3816)", () => {
  const creature = makeCreature();
  // A snapshot that never had a memetic pass: `weights` and `biases` absent.
  creature.memetic = {
    generation: 2,
    score: 0.6,
    ancestry: [{ generation: 1, score: 0.4 }],
  } as unknown as MemeticInterface;

  const memetic = wireMemeticOf(creature.exportJSON());
  assertCanonicalMemetic(memetic, "missing-keys export");
  assertEquals(
    assertWeightRows(memetic.weights, "missing-keys export").length,
    0,
    "a missing weights key must be emitted as the canonical empty array",
  );
  assertEquals(
    Object.keys(assertBiasMap(memetic.biases, "missing-keys export")).length,
    0,
    "a missing biases key must be emitted as the canonical empty object",
  );
});

Deno.test("export never mixes shapes across nested ancestry (#3816)", () => {
  const creature = makeCreature();
  const a = idOf(creature, HIDDEN_A);
  const b = idOf(creature, HIDDEN_B);
  creature.memetic = {
    generation: 3,
    score: 0.7,
    biases: { [a]: 0.1 },
    weights: { [a]: [{ toId: b, weight: 0.5 }] },
    ancestry: [
      {
        generation: 2,
        score: 0.6,
        biases: { [a]: 0.09 },
        weights: { [a]: [{ toId: b, weight: 0.4 }] },
        // A nested ancestry chain: every level must be canonicalised.
        ancestry: [
          {
            generation: 1,
            score: 0.5,
            biases: { [a]: 0.08 },
            weights: { [a]: [{ toId: b, weight: 0.3 }] },
          },
        ],
      },
    ],
  } as unknown as MemeticInterface;

  assertCanonicalMemetic(
    wireMemeticOf(creature.exportJSON()),
    "nested ancestry export",
  );
});

Deno.test("export emits biases as a map even when the runtime value is an array (#3816)", () => {
  const creature = makeCreature();
  creature.memetic = {
    generation: 1,
    score: 0.5,
    // Corrupt runtime state: an array where the contract requires a map. The
    // export must not put a bare `[]` on the wire where a map is expected.
    biases: [] as unknown as Record<number, number>,
    weights: {},
  } as unknown as MemeticInterface;

  const memetic = wireMemeticOf(creature.exportJSON());
  assertCanonicalMemetic(memetic, "array-biases export");
});

Deno.test("runtime-id export emits the canonical memetic shape too (#3816)", () => {
  const creature = makeCreature();
  creature.memetic = populatedRuntimeMemetic(creature);

  const exported = exportJSONWithRuntimeIds(creature);
  assertCanonicalMemetic(
    wireMemeticOf(exported),
    "runtime-id export",
  );
});

Deno.test("import stays tolerant of the legacy map weights shape (#3816)", () => {
  // A creature JSON already saved to disk with the pre-#3810 map shape:
  // `weights` keyed by the from-neuron uuid, entries carrying `toUUID`.
  const legacy = {
    neurons: [
      { type: "hidden", uuid: HIDDEN_A, squash: "TANH", bias: 0.1 },
      { type: "hidden", uuid: HIDDEN_B, squash: "TANH", bias: -0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: HIDDEN_A, weight: 0.4 },
      { fromUUID: "input-1", toUUID: HIDDEN_A, weight: -0.5 },
      { fromUUID: HIDDEN_A, toUUID: HIDDEN_B, weight: 0.6 },
      { fromUUID: HIDDEN_B, toUUID: "output-0", weight: 0.7 },
    ],
    input: 2,
    output: 1,
    memetic: {
      generation: 5,
      score: 0.9,
      biases: { [HIDDEN_A]: 0.11, "output-0": 0.33 },
      weights: {
        [HIDDEN_A]: [{ toUUID: HIDDEN_B, weight: 0.26 }],
        [HIDDEN_B]: [{ toUUID: "output-0", weight: 0.88 }],
      },
      ancestry: [
        {
          generation: 4,
          score: 0.8,
          biases: { [HIDDEN_A]: 0.1 },
          weights: { [HIDDEN_A]: [{ toUUID: HIDDEN_B, weight: 0.2 }] },
        },
      ],
    },
  } as unknown as CreatureExport;

  const creature = Creature.fromJSON(legacy);
  assert(creature.memetic, "a legacy map-shaped creature must still load");

  // Re-exporting it yields the canonical shape with the values intact.
  const memetic = wireMemeticOf(creature.exportJSON());
  assertCanonicalMemetic(memetic, "legacy import");

  const rows = assertWeightRows(memetic.weights, "legacy import");
  assertEquals(
    rows.map((row) => `${row.fromUUID}→${row.toUUID}=${row.weight}`).sort(),
    [
      `${HIDDEN_A}→${HIDDEN_B}=0.26`,
      `${HIDDEN_B}→output-0=0.88`,
    ].sort(),
    "legacy map weights must survive the import with their values",
  );
  assertEquals(
    assertBiasMap(memetic.biases, "legacy import")[HIDDEN_A],
    0.11,
    "legacy biases must survive the import",
  );
  assertEquals(
    assertWeightRows(
      (memetic.ancestry ?? [])[0]?.weights,
      "legacy import ancestry",
    ).length,
    1,
    "legacy ancestry weights must survive the import",
  );
});
