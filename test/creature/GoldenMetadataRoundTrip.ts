/**
 * Golden creature fixtures — the cross-engine round-trip contract
 * (Issue #3752, parent Issue #3746; memetic coverage Issue #3814, parent
 * Issue #3810).
 *
 * `test/fixtures/golden/creature-metadata.json` pins the full creature
 * metadata surface every engine that reads or writes creature JSON must
 * preserve: top-level `uuid`, top-level `tags`, `memetic` (biases **and**
 * weights), hidden-neuron `tags`, and synapse `tags`. The TypeScript engine is
 * the reference implementation, so these tests assert it reproduces the
 * fixture bytes exactly; the Rust extensions consume the same bytes rather
 * than hand-rolling near-copies.
 *
 * Two independent guards, both needed:
 *
 *  1. **Coverage** — the fixture still carries all five surfaces. Without this
 *     a lossy regeneration of the fixture would leave the round-trip green
 *     while the contract quietly shrank.
 *  2. **Byte-identical round trip** — loading the fixture and re-exporting it
 *     reproduces the file verbatim. `exportJSON` deliberately omits the
 *     creature `uuid` (Issue #2054 wire format), so the uuid is restored as
 *     the leading key from the loaded creature, which is where the fixture
 *     stores it.
 *
 * Issue #3814 adds the two memetic fixtures. Issue #3810 escaped the metadata
 * fixture's guards because nothing pinned the **wire shape** of
 * `memetic.weights`: TypeScript writes an array of `{fromUUID, toUUID, weight}`
 * rows, the Rust `MemeticExport` typed it as a map, and every scoring call on a
 * creature carrying `memetic` died with `invalid type: sequence, expected a
 * map`. `creature-memetic.json` pins the populated shape (including an
 * `ancestry[]` snapshot with its own weights and biases) and
 * `creature-memetic-empty-weights.json` pins the empty `"weights": []` variant
 * that actually fires in production runs.
 */

import { assert, assertEquals } from "@std/assert";
import type { TagInterface } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { MemeticWireData } from "@blackbox/MemeticWireData.ts";
import { assertWeightRows, snapshotsOf } from "./MemeticWireShapeAssertions.ts";

/** Stable, documented path — the Rust repos' regression tests read these bytes. */
const FIXTURE_DIR = new URL("../fixtures/golden/", import.meta.url);

/** The full metadata surface (Issue #3752). */
const METADATA_FIXTURE = "creature-metadata.json";
/** Populated memetic block, ancestry included (Issue #3814). */
const MEMETIC_FIXTURE = "creature-memetic.json";
/** The empty `"weights": []` variant that fires in production (Issue #3814). */
const MEMETIC_EMPTY_FIXTURE = "creature-memetic-empty-weights.json";

/** The Issue #3814 pair — both memetic wire shapes. */
const MEMETIC_FIXTURES = [MEMETIC_FIXTURE, MEMETIC_EMPTY_FIXTURE] as const;

/**
 * Every fixture the gate must exercise. Deleting one from the directory turns
 * `readFixture` into a load failure rather than silently reducing coverage.
 */
const ALL_FIXTURES = [METADATA_FIXTURE, ...MEMETIC_FIXTURES] as const;

type GoldenFixture = CreatureExport & { uuid: string };

type LoadedFixture = { name: string; text: string; json: GoldenFixture };

async function readFixture(name: string): Promise<LoadedFixture> {
  const text = await Deno.readTextFile(new URL(name, FIXTURE_DIR));
  return { name, text, json: JSON.parse(text) as GoldenFixture };
}

/** Reads several fixtures concurrently — a missing file rejects loudly. */
function readFixtures(
  names: readonly string[],
): Promise<LoadedFixture[]> {
  return Promise.all(names.map(readFixture));
}

/** True when `tags` carries an entry named `name`. */
function hasTag(tags: TagInterface[] | undefined, name: string): boolean {
  return tags?.some((tag) => tag.name === name) ?? false;
}

/**
 * Re-serialise a loaded creature in the fixture's on-disk form: the wire
 * export with the creature `uuid` restored as the leading key.
 */
function toFixtureText(creature: Creature): string {
  const exported = creature.exportJSON();
  // Issue #3843: `loadFrom` no longer adopts the creature-level uuid from the
  // JSON — a uuid that arrived from outside the process is not trusted — so the
  // fixture's uuid is re-derived from the loaded structure rather than echoed
  // back. The bytes still match because the fixture uuid *is* the deterministic
  // structural uuid of its own content (pinned by the tests below).
  const uuid = CreatureUtil.makeUUID(creature);
  return `${JSON.stringify({ uuid, ...exported }, null, 2)}\n`;
}

/** The memetic block of a fixture, typed as it appears on the wire. */
function memeticOf(json: GoldenFixture): MemeticWireData {
  const memetic = json.memetic as unknown as MemeticWireData | undefined;
  assert(memetic, "fixture must carry a memetic block");
  return memetic;
}

Deno.test("golden fixture covers every creature metadata surface (#3752)", async () => {
  const { json } = await readFixture(METADATA_FIXTURE);

  assert(
    typeof json.uuid === "string" && json.uuid.length > 0,
    "fixture must carry a top-level creature uuid",
  );
  assert(
    hasTag(json.tags, "contract"),
    "fixture must carry top-level tags, including the cross-engine contract note",
  );

  const memetic = json.memetic;
  assert(memetic, "fixture must carry memetic state");
  assert(
    Object.keys(memetic.biases ?? {}).length > 0,
    "memetic must carry at least one bias entry",
  );
  assert(
    Object.keys(memetic.weights ?? {}).length > 0,
    "memetic must carry at least one weight entry",
  );

  const taggedHidden = json.neurons.filter((neuron) =>
    neuron.type === "hidden" && hasTag(neuron.tags, "intelligentDesign")
  );
  assertEquals(
    taggedHidden.length,
    1,
    "fixture must carry a hidden neuron with an intelligentDesign pedigree tag",
  );

  const taggedSynapses = json.synapses.filter((synapse) =>
    (synapse.tags?.length ?? 0) > 0
  );
  assert(
    taggedSynapses.length > 0,
    "fixture must carry at least one synapse with tags",
  );
});

Deno.test("golden fixture round-trips byte-identically (#3752)", async () => {
  const { text, json } = await readFixture(METADATA_FIXTURE);

  const creature = Creature.fromJSON(json);
  // Issue #3843: the load discards the incoming uuid and re-derives it, which
  // reproduces the fixture value because the fixture uuid is the deterministic
  // structural uuid of its own content.
  assertEquals(
    creature.uuid,
    undefined,
    "the creature uuid must not be adopted from the file",
  );
  assertEquals(
    CreatureUtil.makeUUID(creature),
    json.uuid,
    "the re-derived creature uuid must match the fixture",
  );

  assertEquals(
    toFixtureText(creature),
    text,
    "re-exporting the golden fixture must reproduce its bytes exactly",
  );
});

Deno.test("golden fixture uuid is the deterministic structural uuid (#3752)", async () => {
  const { json } = await readFixture(METADATA_FIXTURE);

  // Strip the recorded uuid so makeUUID recomputes it from the structure
  // rather than echoing the stored value back.
  const withoutUuid = { ...json } as Partial<GoldenFixture>;
  delete withoutUuid.uuid;

  const creature = Creature.fromJSON(withoutUuid as CreatureExport);
  assertEquals(
    CreatureUtil.makeUUID(creature),
    json.uuid,
    "the fixture uuid must match the uuid derived from its own topology",
  );
});

Deno.test("golden fixture round trip is idempotent (#3752)", async () => {
  const { text, json } = await readFixture(METADATA_FIXTURE);

  const once = Creature.fromJSON(json);
  const twice = Creature.fromJSON(JSON.parse(toFixtureText(once)));

  assertEquals(
    toFixtureText(twice),
    text,
    "a second load/export cycle must not drift from the fixture",
  );
});

Deno.test("golden memetic fixture carries a populated memetic block (#3814)", async () => {
  const { json } = await readFixture(MEMETIC_FIXTURE);
  const memetic = memeticOf(json);

  assert(
    assertWeightRows(memetic.weights, MEMETIC_FIXTURE).length > 0,
    "the populated fixture must carry at least one memetic weight row",
  );
  assert(
    Object.keys(memetic.biases ?? {}).length > 0,
    "the populated fixture must carry at least one memetic bias entry",
  );

  const ancestry = memetic.ancestry ?? [];
  assert(
    ancestry.length > 0,
    "the populated fixture must carry at least one ancestry snapshot",
  );

  const populatedAncestor = ancestry.find((snapshot) =>
    Array.isArray(snapshot.weights) && snapshot.weights.length > 0
  );
  assert(
    populatedAncestor,
    "at least one ancestry snapshot must carry its own populated weights",
  );
  assert(
    Object.keys(populatedAncestor.biases ?? {}).length > 0,
    "that ancestry snapshot must carry its own biases",
  );

  assert(
    ancestry.some((snapshot) =>
      Array.isArray(snapshot.weights) && snapshot.weights.length === 0
    ),
    "an ancestry snapshot must pin the empty weights array too",
  );
});

Deno.test("golden memetic fixture pins the empty weights array (#3814)", async () => {
  const { json } = await readFixture(MEMETIC_EMPTY_FIXTURE);
  const memetic = memeticOf(json);

  assertEquals(
    assertWeightRows(memetic.weights, MEMETIC_EMPTY_FIXTURE).length,
    0,
    "this fixture pins the empty `weights: []` shape production actually emits",
  );
  assert(
    Object.keys(memetic.biases ?? {}).length > 0,
    "an empty weights array must still ship alongside populated biases",
  );

  const ancestry = memetic.ancestry ?? [];
  assert(
    ancestry.length > 0,
    "the empty-weights fixture must carry an ancestry snapshot",
  );
  for (const snapshot of ancestry) {
    assertEquals(
      assertWeightRows(snapshot.weights, `${MEMETIC_EMPTY_FIXTURE} ancestry`)
        .length,
      0,
      "ancestry snapshots pin the empty weights array as well",
    );
  }
});

Deno.test("every golden fixture serialises memetic weights as rows (#3814)", async () => {
  for (const { name, json } of await readFixtures(ALL_FIXTURES)) {
    const memetic = memeticOf(json);
    let depth = 0;
    for (const snapshot of snapshotsOf(memetic)) {
      assertWeightRows(snapshot.weights, `${name} snapshot ${depth++}`);
    }
  }
});

Deno.test("golden memetic fixtures round-trip byte-identically (#3814)", async () => {
  for (const { name, text, json } of await readFixtures(MEMETIC_FIXTURES)) {
    const creature = Creature.fromJSON(json);
    // Issue #3843: the incoming uuid is discarded, then re-derived to the same
    // value from the structure the file actually carried.
    assertEquals(
      creature.uuid,
      undefined,
      `${name}: uuid must not be adopted from the file`,
    );
    assertEquals(
      CreatureUtil.makeUUID(creature),
      json.uuid,
      `${name}: the re-derived uuid must match the fixture`,
    );

    const exported = creature.exportJSON();
    assertEquals(
      JSON.stringify(exported.memetic),
      JSON.stringify(json.memetic),
      `${name}: the memetic block must survive export → normalise → import byte-identically`,
    );

    assertEquals(
      toFixtureText(creature),
      text,
      `${name}: re-exporting must reproduce the fixture bytes exactly`,
    );

    const twice = Creature.fromJSON(JSON.parse(toFixtureText(creature)));
    assertEquals(
      toFixtureText(twice),
      text,
      `${name}: a second load/export cycle must not drift`,
    );
  }
});

Deno.test("golden memetic fixture uuid is the deterministic structural uuid (#3814)", async () => {
  for (const { name, json } of await readFixtures(MEMETIC_FIXTURES)) {
    const withoutUuid = { ...json } as Partial<GoldenFixture>;
    delete withoutUuid.uuid;

    const creature = Creature.fromJSON(withoutUuid as CreatureExport);
    assertEquals(
      CreatureUtil.makeUUID(creature),
      json.uuid,
      `${name}: the fixture uuid must match the uuid derived from its topology`,
    );
  }
});
