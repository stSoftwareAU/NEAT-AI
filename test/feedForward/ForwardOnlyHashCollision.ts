/**
 * Issue #2090 — deterministicIdFromUuid hash collision must not corrupt
 * forward-only creatures.
 *
 * `normaliseCreatureExport` adds integer IDs derived from UUID hashes.
 * With large creatures (2000+ neurons), collisions are statistically
 * inevitable. Before the fix, `loadFrom` preferred the colliding integer
 * `fromId`/`toId` over the correct `fromUUID`/`toUUID`, causing synapse
 * mis-wiring that turned valid forward connections into backward ones.
 *
 * The fix: `loadFrom` now prefers UUID-based resolution (collision-free)
 * and only falls back to integer IDs when no UUID is present.
 */
import { assertExists } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

/**
 * Reproduce deterministicIdFromUuid so we can verify the collision locally.
 */
function deterministicIdFromUuid(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const chr = uuid.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return 1_000_000 + Math.abs(hash % 1_999_000_000);
}

function findCollidingUuids(): [string, string] {
  const seen = new Map<number, string>();
  for (let i = 0; i < 200_000; i++) {
    const uuid = crypto.randomUUID();
    const id = deterministicIdFromUuid(uuid);
    const prev = seen.get(id);
    if (prev) {
      return [prev, uuid];
    }
    seen.set(id, uuid);
  }
  throw new Error(
    "Failed to find colliding UUIDs within 200 000 attempts",
  );
}

Deno.test(
  "Issue #2090 — loadFrom prefers UUID over colliding integer ID",
  () => {
    const [collidingUuid1, collidingUuid2] = findCollidingUuids();

    const id1 = deterministicIdFromUuid(collidingUuid1);
    const id2 = deterministicIdFromUuid(collidingUuid2);
    if (id1 !== id2) {
      throw new Error(`Expected collision but got ${id1} vs ${id2}`);
    }

    // Neuron layout (by array position after input):
    //   0: input-0
    //   1: input-1
    //   2: hidden  (collidingUuid1)   ← first collider
    //   3: hidden  (non-colliding)
    //   4: hidden  (collidingUuid2)   ← second collider
    //   5: output-0
    //
    // Synapses (all forward by position):
    //   input-0  → hidden(2)   [0 → 2]
    //   hidden(2) → hidden(3)  [2 → 3]
    //   hidden(3) → hidden(4)  [3 → 4]
    //   hidden(4) → output-0   [4 → 5]
    //
    // normaliseCreatureExport gives both hidden(2) and hidden(4) the same
    // integer id. If loadFrom used idMap, "hidden(2) → hidden(3)" would
    // resolve as from=4, to=3 — backward. With the fix, loadFrom uses
    // UUID resolution instead, which is collision-free.

    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: collidingUuid1,
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          squash: IDENTITY.NAME,
          bias: 0,
        },
        {
          type: "hidden",
          uuid: collidingUuid2,
          squash: IDENTITY.NAME,
          bias: 0,
        },
        { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: collidingUuid1, weight: 1 },
        {
          fromUUID: collidingUuid1,
          toUUID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          weight: 1,
        },
        {
          fromUUID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          toUUID: collidingUuid2,
          weight: 1,
        },
        { fromUUID: collidingUuid2, toUUID: "output-0", weight: 1 },
      ],
    };

    // UUID-only load always worked.
    const creature = Creature.fromJSON(json);
    assertExists(creature, "UUID-only load should succeed");

    // Normalise injects colliding integer IDs — loadFrom must still resolve
    // via UUID, not the colliding ids.
    normaliseCreatureExport(json);
    const reloaded = Creature.fromJSON(json);
    assertExists(
      reloaded,
      "Normalised load must prefer UUID and not mis-wire synapses",
    );
  },
);
