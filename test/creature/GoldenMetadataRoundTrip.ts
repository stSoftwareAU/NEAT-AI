/**
 * Golden creature-metadata fixture — the cross-engine round-trip contract
 * (Issue #3752, parent Issue #3746).
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
 */

import { assert, assertEquals } from "@std/assert";
import type { TagInterface } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/** Stable, documented path — the Rust repos' regression tests read these bytes. */
const FIXTURE_URL = new URL(
  "../fixtures/golden/creature-metadata.json",
  import.meta.url,
);

type GoldenFixture = CreatureExport & { uuid: string };

async function readFixture(): Promise<{ text: string; json: GoldenFixture }> {
  const text = await Deno.readTextFile(FIXTURE_URL);
  return { text, json: JSON.parse(text) as GoldenFixture };
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
  return `${JSON.stringify({ uuid: creature.uuid, ...exported }, null, 2)}\n`;
}

Deno.test("golden fixture covers every creature metadata surface (#3752)", async () => {
  const { json } = await readFixture();

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
  const { text, json } = await readFixture();

  const creature = Creature.fromJSON(json);
  assertEquals(
    creature.uuid,
    json.uuid,
    "the creature uuid must survive the load",
  );

  assertEquals(
    toFixtureText(creature),
    text,
    "re-exporting the golden fixture must reproduce its bytes exactly",
  );
});

Deno.test("golden fixture uuid is the deterministic structural uuid (#3752)", async () => {
  const { json } = await readFixture();

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
  const { text, json } = await readFixture();

  const once = Creature.fromJSON(json);
  const twice = Creature.fromJSON(JSON.parse(toFixtureText(once)));

  assertEquals(
    toFixtureText(twice),
    text,
    "a second load/export cycle must not drift from the fixture",
  );
});
