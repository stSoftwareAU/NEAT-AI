/**
 * Issue #3693 — fact-check guard for the serialisation and
 * `randomConnectMissing` claims in `docs/api/CREATURE.md`.
 *
 * The method table claimed `exportJSON` emits "wire UUIDs plus resolved runtime
 * ids (`id` / `fromId` / `toId`)" and that `exportSnapshotJSON` differs by
 * omitting them. Both inverted the repo's most safety-critical serialisation
 * contract (AGENTS.md "Neuron UUID stability", rule 4): `exportJSON` is
 * UUID-only and `exportSnapshotJSON` is its backward-compatible equivalent.
 * A second bullet claimed `randomConnectMissing` repairs neurons lacking
 * "inward or outward" connections during topology repair; it only connects
 * input neurons that have no outgoing synapse.
 *
 * Each documented claim is anchored to the live API here, so neither half can
 * drift: the behaviour assertions fail if the exports ever regain numeric ids,
 * and the doc assertions fail if the corrected prose is reverted.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Creature, randomConnectMissing } from "../../mod.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const CREATURE_DOC = join(REPO_ROOT, "docs", "api", "CREATURE.md");

async function readDocLines(): Promise<string[]> {
  return (await Deno.readTextFile(CREATURE_DOC)).split("\n");
}

/**
 * Extracts the claim documenting `symbol` — its method-table row when it has
 * one, otherwise its bullet with wrapped continuation lines folded in. Scoping
 * to a single claim keeps assertions from bleeding into a neighbouring entry,
 * and folding the wrap keeps them alive across a `deno fmt` reflow.
 */
function claimFor(lines: string[], symbol: string): string {
  const row = lines.findIndex((line) => line.startsWith(`| \`${symbol}\``));
  const start = row >= 0
    ? row
    : lines.findIndex((line) => line.startsWith(`- \`${symbol}\``));
  assert(start >= 0, `CREATURE.md must document ${symbol}`);

  const block = [lines[start]];
  if (lines[start].startsWith("- ")) {
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("  ")) break; // end of the wrapped bullet
      block.push(line);
    }
  }
  return block.join(" ").replace(/\s+/g, " ");
}

Deno.test("CREATURE.md: exportJSON is documented as the UUID-only wire format", async () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exported = creature.exportJSON();

  // Behaviour anchor for the documented claim.
  for (const neuron of exported.neurons) {
    assert(neuron.uuid, "every exported neuron carries a uuid");
    assertEquals(neuron.id, undefined, "exportJSON omits the runtime id");
  }
  for (const synapse of exported.synapses) {
    assert(synapse.fromUUID && synapse.toUUID, "endpoints are uuid strings");
    assertEquals(synapse.fromId, undefined, "exportJSON omits fromId");
    assertEquals(synapse.toId, undefined, "exportJSON omits toId");
  }

  const claim = claimFor(await readDocLines(), "exportJSON");
  assert(
    /UUID-only/i.test(claim),
    `exportJSON must be documented as UUID-only, got: ${claim}`,
  );
  assert(
    !/runtime ids/i.test(claim),
    `exportJSON must not be documented as emitting runtime ids, got: ${claim}`,
  );
});

Deno.test("CREATURE.md: exportSnapshotJSON is documented as equivalent to exportJSON", async () => {
  const creature = new Creature(3, 2, { layers: [{ count: 2 }] });

  // Behaviour anchor: the two produce the same wire payload.
  assertEquals(
    JSON.stringify(creature.exportSnapshotJSON()),
    JSON.stringify(creature.exportJSON()),
    "exportSnapshotJSON is equivalent to exportJSON",
  );

  const claim = claimFor(await readDocLines(), "exportSnapshotJSON");
  assert(
    /equivalent/i.test(claim),
    `exportSnapshotJSON must be documented as equivalent, got: ${claim}`,
  );
  assert(
    !/omits numeric ids/i.test(claim),
    `exportSnapshotJSON must not be documented as differing, got: ${claim}`,
  );
});

Deno.test("CREATURE.md: randomConnectMissing is documented as input-side only", async () => {
  // Behaviour anchor: an already-connected creature is returned untouched.
  const connected = new Creature(3, 1);
  assertEquals(
    randomConnectMissing(connected),
    connected,
    "a creature with no unconnected input is returned unchanged",
  );

  const bullet = claimFor(
    await readDocLines(),
    "randomConnectMissing(creature)",
  );
  assert(
    /input neuron/i.test(bullet),
    `randomConnectMissing must be documented as input-side, got: ${bullet}`,
  );
  assert(
    !/inward or outward/i.test(bullet),
    `randomConnectMissing does not repair inward/outward gaps, got: ${bullet}`,
  );
  assert(
    !/topology repair after structural mutation/i.test(bullet),
    `randomConnectMissing has no topology-repair caller, got: ${bullet}`,
  );
});
