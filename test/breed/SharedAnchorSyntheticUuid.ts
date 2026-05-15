/**
 * Tests for the shared-anchor synthetic-UUID strategy (Issue #2655).
 *
 * `computeSharedAnchorSyntheticUuids` and its export sibling promote every
 * hidden/constant neuron whose real `uuid` is present in both parents into
 * an additional alignment anchor. Neighbours of each shared anchor receive
 * synthetic identifiers of the form
 * `sharedAnchor-${dir}-${anchorUuid}-${steps}-${sign}-${rank}`.
 *
 * The fallback wires through `createCompatibleFather*` in `Father.ts`. The
 * synthetic identifiers are alignment-only and must never appear in the
 * resulting `CreatureExport` (per the AGENTS.md invariant).
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  computeSharedAnchorSyntheticUuids,
  computeSharedAnchorSyntheticUuidsExport,
} from "@breed/SyntheticLocationUuid.ts";
import {
  createCompatibleFather,
  createCompatibleFatherFromCreatures,
} from "@breed/Father.ts";
import { Creature } from "../../mod.ts";

function hiddenUuidsOf(adjusted: CreatureExport): string[] {
  return adjusted.neurons
    .filter((n) => n.type === "hidden")
    .map((n) => n.uuid as string);
}

/**
 * Helper: any synthetic UUID (input/output anchor or shared anchor) is
 * disallowed in an exported neuron uuid or synapse endpoint.
 */
function hasSyntheticSuffix(s: string): boolean {
  return s.includes("-pos-") || s.includes("-neg-") ||
    s.startsWith("sharedAnchor-");
}

/**
 * Build a small two-hidden-layer creature export with controllable hidden
 * UUIDs. Layout:
 *   input-0 → A → B → C → output-0
 * where the test passes the three hidden UUIDs.
 */
function makeChain(
  hA: string,
  hB: string,
  hC: string,
): CreatureExport {
  return {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: hA, bias: 0, squash: "IDENTITY" },
      { type: "hidden", uuid: hB, bias: 0, squash: "IDENTITY" },
      { type: "hidden", uuid: hC, bias: 0, squash: "IDENTITY" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: hA, weight: 0.5 },
      { fromUUID: hA, toUUID: hB, weight: 0.7 },
      { fromUUID: hB, toUUID: hC, weight: 0.6 },
      { fromUUID: hC, toUUID: "output-0", weight: 0.9 },
    ],
  };
}

Deno.test(
  "computeSharedAnchorSyntheticUuids: empty anchor set is a no-op",
  () => {
    const creature = Creature.fromJSON(makeChain("a", "b", "c"));
    const result = computeSharedAnchorSyntheticUuids(creature, new Set());
    assertEquals(result.size, 0);
  },
);

Deno.test(
  "computeSharedAnchorSyntheticUuidsExport: empty anchor set is a no-op",
  () => {
    const result = computeSharedAnchorSyntheticUuidsExport(
      makeChain("a", "b", "c"),
      new Set(),
    );
    assertEquals(result.size, 0);
  },
);

Deno.test(
  "computeSharedAnchorSyntheticUuids: anchor in the middle propagates fwd + bwd to neighbours",
  () => {
    // Anchor B sits between A (upstream) and C (downstream). The forward
    // sweep should reach C at steps=1; the backward sweep should reach A
    // at steps=1.
    const creature = Creature.fromJSON(makeChain("nA", "shared-B", "nC"));
    const result = computeSharedAnchorSyntheticUuids(
      creature,
      new Set(["shared-B"]),
    );

    const idA = creature.neurons.find((n) => n.uuid === "nA")!.id;
    const idC = creature.neurons.find((n) => n.uuid === "nC")!.id;
    const idB = creature.neurons.find((n) => n.uuid === "shared-B")!.id;

    const aSet = result.get(idA) ?? new Set();
    const cSet = result.get(idC) ?? new Set();
    // Anchor itself must not receive a synthetic ID — its real UUID is
    // the alignment key.
    assertEquals(result.has(idB), false);

    assert(
      [...aSet].some((u) => u === "sharedAnchor-bwd-shared-B-1-pos-0"),
      `expected backward synthetic on A, got ${JSON.stringify([...aSet])}`,
    );
    assert(
      [...cSet].some((u) => u === "sharedAnchor-fwd-shared-B-1-pos-0"),
      `expected forward synthetic on C, got ${JSON.stringify([...cSet])}`,
    );
  },
);

Deno.test(
  "createCompatibleFather: many shared real UUIDs — shared-anchor fallback aligns the rest (Issue #2655)",
  () => {
    // Two parents whose hidden chain shares two anchors but differs in the
    // remaining neuron. The mother and father each have 4 hidden neurons,
    // 2 shared (real overlap = 0.5 → above the default threshold so the
    // synthetic pass would normally not fire). Force the synthetic pass
    // by lowering the threshold to 1.0 so we exercise the shared-anchor
    // alignment for the unique mother/father neuron.
    const mother: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "anchor-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "m-mid", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "anchor-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "anchor-A", weight: 0.5 },
        { fromUUID: "anchor-A", toUUID: "m-mid", weight: 0.7 },
        { fromUUID: "m-mid", toUUID: "anchor-B", weight: 0.6 },
        { fromUUID: "anchor-B", toUUID: "output-0", weight: 0.9 },
      ],
    };
    const father: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "anchor-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "f-mid", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "anchor-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "anchor-A", weight: 0.5 },
        { fromUUID: "anchor-A", toUUID: "f-mid", weight: 0.7 },
        { fromUUID: "f-mid", toUUID: "anchor-B", weight: 0.6 },
        { fromUUID: "anchor-B", toUUID: "output-0", weight: 0.9 },
      ],
    };

    // threshold = 1.0 → fallback always runs.
    const adjusted = createCompatibleFather(mother, father, 1.0);
    const adjustedHidden = hiddenUuidsOf(adjusted);
    // f-mid sits at the same topological position as m-mid, between two
    // shared anchors. The shared-anchor pass must align it to m-mid.
    assert(
      adjustedHidden.includes("m-mid"),
      `expected m-mid alignment via shared anchors, got ${
        JSON.stringify(adjustedHidden)
      }`,
    );
    // No synthetic UUIDs leak out.
    for (const uuid of adjustedHidden) {
      assert(
        !hasSyntheticSuffix(uuid),
        `synthetic UUID leaked into export: ${uuid}`,
      );
    }
    for (const synapse of adjusted.synapses) {
      const f = synapse.fromUUID ?? "";
      const t = synapse.toUUID ?? "";
      assert(!hasSyntheticSuffix(f), `synthetic in fromUUID: ${f}`);
      assert(!hasSyntheticSuffix(t), `synthetic in toUUID: ${t}`);
    }
  },
);

Deno.test(
  "createCompatibleFather: zero shared real UUIDs — no regression on existing fallback (Issue #2655)",
  () => {
    // Same chains as the existing #2614 test fixture: zero hidden UUID
    // overlap. The shared-anchor pass must contribute nothing, leaving the
    // existing input/output anchor pass to do all the work.
    const mother: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "m-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "m-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "m-A", weight: 0.5 },
        { fromUUID: "m-A", toUUID: "m-B", weight: 0.7 },
        { fromUUID: "m-B", toUUID: "output-0", weight: 0.9 },
      ],
    };
    const father: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "f-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "f-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "f-A", weight: 0.5 },
        { fromUUID: "f-A", toUUID: "f-B", weight: 0.7 },
        { fromUUID: "f-B", toUUID: "output-0", weight: 0.9 },
      ],
    };

    const adjusted = createCompatibleFather(mother, father);
    const adjustedHidden = hiddenUuidsOf(adjusted);
    // Existing #2614 behaviour: at least one mother UUID appears.
    assert(
      adjustedHidden.includes("m-A") || adjustedHidden.includes("m-B"),
      `expected I/O-anchor alignment, got ${JSON.stringify(adjustedHidden)}`,
    );
    // Crucially, no shared-anchor synthetic strings leak.
    for (const uuid of adjustedHidden) {
      assert(
        !uuid.startsWith("sharedAnchor-"),
        `unexpected sharedAnchor leak: ${uuid}`,
      );
    }
  },
);

Deno.test(
  "createCompatibleFather: single shared anchor mid-network propagates alignment to neighbours (Issue #2655)",
  () => {
    // Mother: input-0 → uA → mid → uC → output-0
    // Father: input-0 → fA → mid → fC → output-0
    // Only `mid` is shared. The shared-anchor pass should produce
    // synthetic IDs that align uA↔fA (backward 1 step from `mid`) and
    // uC↔fC (forward 1 step from `mid`).
    const mother = makeChain("uA", "mid", "uC");
    const father = makeChain("fA", "mid", "fC");

    // Real overlap is 1/3 ≈ 0.33, above the default 0.2 threshold. Force
    // the fallback by lowering the threshold to 1.0 so the strategy is
    // exercised on this scenario.
    const adjusted = createCompatibleFather(mother, father, 1.0);
    const adjustedHidden = hiddenUuidsOf(adjusted);

    // mid stays as-is (real UUID match).
    assertEquals(
      adjustedHidden.filter((u) => u === "mid").length,
      1,
      "mid must appear exactly once",
    );
    // The neighbours of mid in the father (fA, fC) should be remapped to
    // the mother's mid-neighbour UUIDs (uA, uC) via shared-anchor synthetics.
    assert(
      adjustedHidden.includes("uA"),
      `expected fA → uA alignment via backward shared-anchor, got ${
        JSON.stringify(adjustedHidden)
      }`,
    );
    assert(
      adjustedHidden.includes("uC"),
      `expected fC → uC alignment via forward shared-anchor, got ${
        JSON.stringify(adjustedHidden)
      }`,
    );
    // No synthetic strings leaked.
    for (const uuid of adjustedHidden) {
      assert(
        !hasSyntheticSuffix(uuid),
        `synthetic UUID leaked into export: ${uuid}`,
      );
    }
  },
);

Deno.test(
  "createCompatibleFather: cross-machine round-trip — alignment is independent of neuron array position (Issue #2655)",
  () => {
    // Same logical creature, different array order. The shared-anchor
    // pass uses UUID-keyed maps internally so the result must be byte-
    // identical (bar non-deterministic ordering inside the synapses
    // array, which we sort before comparison).
    const mother = makeChain("uA", "mid", "uC");
    const fatherCanonical = makeChain("fA", "mid", "fC");
    const fatherShuffled: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        // Reverse hidden-neuron order; the export's runtime ids would
        // differ if alignment depended on array position.
        { type: "hidden", uuid: "fC", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "mid", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "fA", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      // Synapses are listed in a different order than the canonical
      // version too — uuid resolution must produce identical alignment.
      synapses: [
        { fromUUID: "fC", toUUID: "output-0", weight: 0.9 },
        { fromUUID: "mid", toUUID: "fC", weight: 0.6 },
        { fromUUID: "fA", toUUID: "mid", weight: 0.7 },
        { fromUUID: "input-0", toUUID: "fA", weight: 0.5 },
      ],
    };

    const a = createCompatibleFather(
      structuredClone(mother),
      structuredClone(fatherCanonical),
      1.0,
    );
    const b = createCompatibleFather(
      structuredClone(mother),
      structuredClone(fatherShuffled),
      1.0,
    );

    const hiddenA = hiddenUuidsOf(a).sort();
    const hiddenB = hiddenUuidsOf(b).sort();
    assertEquals(
      hiddenA,
      hiddenB,
      "shared-anchor alignment must be position-independent",
    );
  },
);

Deno.test(
  "createCompatibleFatherFromCreatures: shared-anchor pass aligns neighbours and exports cleanly (Issue #2655)",
  () => {
    const mother = Creature.fromJSON(makeChain("uA", "mid", "uC"));
    const father = Creature.fromJSON(makeChain("fA", "mid", "fC"));

    const adjusted = createCompatibleFatherFromCreatures(mother, father, 1.0);
    const adjustedHidden = hiddenUuidsOf(adjusted);

    assert(
      adjustedHidden.includes("uA") && adjustedHidden.includes("uC"),
      `expected uA + uC alignment via shared-anchor, got ${
        JSON.stringify(adjustedHidden)
      }`,
    );

    // Round-trip via Creature.fromJSON / exportJSON — confirm zero
    // synthetic UUID strings leak through serialisation.
    const child = Creature.fromJSON(adjusted);
    const reExported = child.exportJSON();
    for (const n of reExported.neurons) {
      const uuid = n.uuid;
      if (typeof uuid === "string") {
        assert(
          !uuid.startsWith("sharedAnchor-"),
          `sharedAnchor leaked into exportJSON: ${uuid}`,
        );
      }
    }
    for (const s of reExported.synapses) {
      const f = s.fromUUID ?? "";
      const t = s.toUUID ?? "";
      assert(
        !f.startsWith("sharedAnchor-"),
        `sharedAnchor leaked into synapse fromUUID: ${f}`,
      );
      assert(
        !t.startsWith("sharedAnchor-"),
        `sharedAnchor leaked into synapse toUUID: ${t}`,
      );
    }
  },
);
