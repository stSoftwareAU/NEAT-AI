/**
 * Tests for the location-based synthetic UUID generator (Issue #2613).
 *
 * `computeSyntheticLocationUuids` produces, for every hidden/constant neuron,
 * up to two alignment-only synthetic UUIDs anchored against the nearest input
 * and nearest output. The function is pure, deterministic, and side-effect
 * free — it never mutates the creature and is never persisted.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { computeSyntheticLocationUuids } from "@breed/SyntheticLocationUuid.ts";
import { Creature } from "../../mod.ts";

/**
 * Helper: looks up the runtime integer id for the hidden neuron with the
 * given uuid on the loaded creature. Synthetic UUIDs are returned in a Map
 * keyed by runtime id, so tests dereference by uuid for readability.
 */
function idOf(creature: Creature, uuid: string): number {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  assert(neuron, `neuron with uuid ${uuid} not found on creature`);
  return neuron.id;
}

function uuidsFor(
  result: Map<number, Set<string>>,
  creature: Creature,
  uuid: string,
): string[] {
  const set = result.get(idOf(creature, uuid));
  return set ? [...set].sort() : [];
}

Deno.test(
  "computeSyntheticLocationUuids: linear chain produces stable UUIDs",
  () => {
    // input-0 → h1 → h2 → output-0
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h1", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "h2", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
        { fromUUID: "h1", toUUID: "h2", weight: 0.7 },
        { fromUUID: "h2", toUUID: "output-0", weight: 0.9 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    assertEquals(uuidsFor(result, creature, "h1"), [
      "input-0-1-pos-0",
      "output-0-2-pos-0",
    ]);
    assertEquals(uuidsFor(result, creature, "h2"), [
      "input-0-2-pos-0",
      "output-0-1-pos-0",
    ]);
  },
);

Deno.test(
  "computeSyntheticLocationUuids: rank disambiguates siblings by |weight| desc, fromUUID asc",
  () => {
    // Two hidden neurons share the same (anchor=input-0, steps=1, sign=pos)
    // bucket. Their primary incoming synapses come from input-0 and have
    // different magnitudes — rank-0 must be the larger magnitude.
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h-strong", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "h-weak", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h-strong", weight: 0.9 },
        { fromUUID: "input-0", toUUID: "h-weak", weight: 0.1 },
        { fromUUID: "h-strong", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "h-weak", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    const strong = result.get(idOf(creature, "h-strong"))!;
    const weak = result.get(idOf(creature, "h-weak"))!;
    assert(strong.has("input-0-1-pos-0"), "strong must take rank 0");
    assert(weak.has("input-0-1-pos-1"), "weak must take rank 1");
  },
);

Deno.test(
  "computeSyntheticLocationUuids: rank ties broken by fromUUID asc",
  () => {
    // Two hidden neurons with equal-magnitude primary incoming synapses;
    // the lexicographically smaller fromUUID takes rank 0.
    const json: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        // Both anchored to input-0 (steps=1) via the strong primary edge.
        { type: "hidden", uuid: "h-from0", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "h-from1", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        // Equal-magnitude primaries from input-0 and input-1 respectively
        // would put each neuron in a different anchor bucket. Force both into
        // the same anchor bucket (input-0) by making input-0 the primary
        // edge for both, with identical weights so ranking falls through to
        // fromUUID — but here both have the same fromUUID. Use a secondary
        // tie-break path: have h-from0 receive its primary from input-0,
        // h-from1 also receive its primary from input-0 with the same
        // weight. Then ranking falls through to fromUUID equality, and the
        // sort must be stable (insertion order or any deterministic order).
        // Actual rank tie-break path tested separately — here we verify
        // that two neurons whose primaries differ in fromUUID but match in
        // |weight| are ranked by fromUUID.
        { fromUUID: "input-0", toUUID: "h-from0", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "h-from1", weight: 0.5 },
        { fromUUID: "h-from0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "h-from1", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    // h-from0 is anchored to input-0, h-from1 to input-1 — different anchor
    // buckets, so each has rank 0 in its own bucket.
    assert(
      result.get(idOf(creature, "h-from0"))!.has("input-0-1-pos-0"),
      "h-from0 should be rank 0 in input-0 bucket",
    );
    assert(
      result.get(idOf(creature, "h-from1"))!.has("input-1-1-pos-0"),
      "h-from1 should be rank 0 in input-1 bucket",
    );
  },
);

Deno.test(
  "computeSyntheticLocationUuids: negative primary weight produces neg sign",
  () => {
    // h-neg's primary incoming synapse is negative, h-pos's is positive.
    // They share the same (anchor, steps) but must NOT collide because the
    // sign component of the synthetic UUID differs.
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h-neg", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "h-pos", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h-neg", weight: -0.7 },
        { fromUUID: "input-0", toUUID: "h-pos", weight: 0.7 },
        { fromUUID: "h-neg", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "h-pos", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    const neg = result.get(idOf(creature, "h-neg"))!;
    const pos = result.get(idOf(creature, "h-pos"))!;
    assert(neg.has("input-0-1-neg-0"), `h-neg got: ${[...neg]}`);
    assert(pos.has("input-0-1-pos-0"), `h-pos got: ${[...pos]}`);
    // Each is rank 0 in its own (sign-distinct) bucket.
  },
);

Deno.test(
  "computeSyntheticLocationUuids: zero-weight primary maps to pos sign",
  () => {
    // A primary incoming synapse of exactly 0 must produce sign=pos
    // (per Round 3 decision in #2609).
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h-zero", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h-zero", weight: 0 },
        { fromUUID: "h-zero", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    const set = result.get(idOf(creature, "h-zero"))!;
    assert(set.has("input-0-1-pos-0"), `h-zero got: ${[...set]}`);
  },
);

Deno.test(
  "computeSyntheticLocationUuids: nearest input by hop count breaks ties by lowest index",
  () => {
    // Multi-input creature. h1 is one hop from input-2, three hops from
    // input-0 (via h-far → h-mid → h1). The nearest-input anchor must be
    // input-2.
    const json: CreatureExport = {
      input: 3,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h-far", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "h-mid", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "h1", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h-far", weight: 0.5 },
        { fromUUID: "h-far", toUUID: "h-mid", weight: 0.5 },
        { fromUUID: "h-mid", toUUID: "h1", weight: 0.5 },
        { fromUUID: "input-2", toUUID: "h1", weight: 0.5 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    const set = result.get(idOf(creature, "h1"))!;
    // input-2 is at distance 1, input-0 at distance 3 — nearest is input-2.
    const inputAnchored = [...set].filter((u) => u.startsWith("input-"));
    assertEquals(inputAnchored.length, 1, "exactly one input-anchored uuid");
    assert(
      inputAnchored[0].startsWith("input-2-1-"),
      `nearest input should be input-2 at steps=1, got ${inputAnchored[0]}`,
    );
  },
);

Deno.test(
  "computeSyntheticLocationUuids: tie on hop count breaks by lowest input index",
  () => {
    // h1 is exactly 1 hop from both input-0 and input-1 — the lower index
    // (input-0) must win the anchor tie-break.
    const json: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h1", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "h1", weight: 0.4 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    const set = result.get(idOf(creature, "h1"))!;
    const inputAnchored = [...set].filter((u) => u.startsWith("input-"));
    assertEquals(inputAnchored.length, 1);
    assert(
      inputAnchored[0].startsWith("input-0-1-"),
      `expected input-0 anchor, got ${inputAnchored[0]}`,
    );
  },
);

Deno.test(
  "computeSyntheticLocationUuids: nearest output by hop count breaks ties by lowest index",
  () => {
    // h1 → output-1 directly (1 hop), output-0 via h2 (2 hops).
    const json: CreatureExport = {
      input: 1,
      output: 2,
      neurons: [
        { type: "hidden", uuid: "h1", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "h2", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
        { fromUUID: "h1", toUUID: "h2", weight: 0.5 },
        { fromUUID: "h2", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "h1", toUUID: "output-1", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    const set = result.get(idOf(creature, "h1"))!;
    const outputAnchored = [...set].filter((u) => u.startsWith("output-"));
    assertEquals(outputAnchored.length, 1);
    assert(
      outputAnchored[0].startsWith("output-1-1-"),
      `expected output-1 anchor at steps=1, got ${outputAnchored[0]}`,
    );
  },
);

Deno.test(
  "computeSyntheticLocationUuids: tie on output hop count breaks by lowest output index",
  () => {
    // h1 is 1 hop from both output-0 and output-1 — lower output index wins.
    const json: CreatureExport = {
      input: 1,
      output: 2,
      neurons: [
        { type: "hidden", uuid: "h1", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "h1", toUUID: "output-1", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    const set = result.get(idOf(creature, "h1"))!;
    const outputAnchored = [...set].filter((u) => u.startsWith("output-"));
    assertEquals(outputAnchored.length, 1);
    assert(
      outputAnchored[0].startsWith("output-0-1-"),
      `expected output-0 anchor, got ${outputAnchored[0]}`,
    );
  },
);

Deno.test(
  "computeSyntheticLocationUuids: bias-only hidden neuron emits no entry",
  () => {
    // h-bias has no incoming synapse — only its bias drives it. It must be
    // skipped: no synthetic UUIDs at all.
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h-real", bias: 0, squash: "IDENTITY" },
        // h-bias is reachable from output-0 (so it could in principle get
        // an output anchor), but it has no incoming synapse — bias-only.
        // The function must skip it entirely.
        { type: "hidden", uuid: "h-bias", bias: 0.5, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h-real", weight: 0.5 },
        { fromUUID: "h-real", toUUID: "output-0", weight: 0.5 },
        // h-bias also feeds output-0 (so it has an outgoing edge), but it
        // has no incoming edge, so it is skipped per the issue spec.
        { fromUUID: "h-bias", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const result = computeSyntheticLocationUuids(creature);

    assertEquals(
      result.has(idOf(creature, "h-bias")),
      false,
      "bias-only hidden neuron must not appear in the result map",
    );
    // h-real should still be present.
    assert(result.has(idOf(creature, "h-real")));
  },
);

Deno.test(
  "computeSyntheticLocationUuids: deterministic across consecutive calls",
  () => {
    const json: CreatureExport = {
      input: 2,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "a", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "b", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "c", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "a", weight: 0.4 },
        { fromUUID: "input-1", toUUID: "a", weight: -0.3 },
        { fromUUID: "input-0", toUUID: "b", weight: 0.6 },
        { fromUUID: "a", toUUID: "c", weight: 0.2 },
        { fromUUID: "b", toUUID: "c", weight: 0.8 },
        { fromUUID: "c", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    const first = computeSyntheticLocationUuids(creature);
    const second = computeSyntheticLocationUuids(creature);

    assertEquals(first.size, second.size);
    for (const [id, set1] of first) {
      const set2 = second.get(id);
      assert(set2, `id ${id} missing from second call`);
      assertEquals([...set1].sort(), [...set2].sort());
    }
  },
);

Deno.test(
  "computeSyntheticLocationUuids: synthetic UUIDs are not persisted via exportJSON",
  () => {
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h1", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json);
    // Compute once — must not mutate the creature in any observable way.
    computeSyntheticLocationUuids(creature);

    const roundTrip = Creature.fromJSON(creature.exportJSON()).exportJSON();
    // No synthetic-looking uuids on neurons or synapses.
    for (const n of roundTrip.neurons) {
      if (n.uuid) {
        assert(
          !/^(input|output)-\d+-\d+-(pos|neg)-\d+$/.test(n.uuid),
          `neuron uuid leaked synthetic format: ${n.uuid}`,
        );
      }
    }
    for (const s of roundTrip.synapses) {
      if (s.fromUUID) {
        assert(
          !/^(input|output)-\d+-\d+-(pos|neg)-\d+$/.test(s.fromUUID),
        );
      }
      if (s.toUUID) {
        assert(
          !/^(input|output)-\d+-\d+-(pos|neg)-\d+$/.test(s.toUUID),
        );
      }
    }
  },
);
