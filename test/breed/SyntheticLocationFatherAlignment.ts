/**
 * Tests for the synthetic-UUID alignment fallback wired into
 * `createCompatibleFather*` (Issue #2614).
 *
 * The fallback runs only when the real-UUID overlap between mother and
 * father is below the configured threshold. Aligned father neurons
 * inherit the mother's real UUID — synthetic UUIDs are never written
 * into the resulting `CreatureExport`.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import {
  createCompatibleFather,
  createCompatibleFatherFromCreatures,
} from "@breed/Father.ts";
import { Creature } from "../../mod.ts";

/**
 * Linear-chain mother: input-0 → m-A → m-B → output-0.
 * Hidden uuids are deliberately distinct from any father below.
 */
function makeLinearMother(): CreatureExport {
  return {
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
}

/**
 * Linear-chain father with the same shape but disjoint hidden uuids.
 */
function makeLinearFather(): CreatureExport {
  return {
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
}

function hiddenUuidsOf(adjusted: CreatureExport): string[] {
  return adjusted.neurons
    .filter((n) => n.type === "hidden")
    .map((n) => n.uuid as string);
}

function hasSyntheticSuffix(s: string): boolean {
  // Synthetic UUIDs are formatted `${anchor}-${steps}-${sign}-${rank}`
  // where sign is one of `pos` / `neg`. Anchors are real
  // canonical wire UUIDs (`input-N`, `output-N`) so the discriminator is
  // the `-pos-` / `-neg-` infix.
  return s.includes("-pos-") || s.includes("-neg-");
}

Deno.test(
  "createCompatibleFather: above-threshold case is a no-op (Issue #2614)",
  () => {
    // Parents share both hidden uuids → real overlap is 1.0 (>> 0.2).
    // The synthetic fallback must not run; behaviour equals the existing
    // stable-UUID + connectivity-key alignment.
    const mother: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "shared-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "shared-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "shared-A", weight: 0.5 },
        { fromUUID: "shared-A", toUUID: "shared-B", weight: 0.7 },
        { fromUUID: "shared-B", toUUID: "output-0", weight: 0.9 },
      ],
    };
    const father: CreatureExport = structuredClone(mother);

    const adjusted = createCompatibleFather(mother, father);
    const uuids = hiddenUuidsOf(adjusted);
    assertEquals(uuids.sort(), ["shared-A", "shared-B"]);
    for (const uuid of uuids) {
      assert(
        !hasSyntheticSuffix(uuid),
        `unexpected synthetic suffix in ${uuid}`,
      );
    }
  },
);

Deno.test(
  "createCompatibleFather: below-threshold case aligns at least one neuron via synthetic UUID (Issue #2614)",
  () => {
    // Mother and father share zero hidden UUIDs → real overlap is 0 (< 0.2).
    // Both are linear chains — synthetic location UUIDs match exactly.
    const mother = makeLinearMother();
    const father = makeLinearFather();

    // Baseline: with the synthetic fallback disabled (threshold = 0),
    // the existing alignment passes leave the father's hidden UUIDs intact.
    const baseline = createCompatibleFather(
      structuredClone(mother),
      structuredClone(father),
      0,
    );
    const baselineHidden = hiddenUuidsOf(baseline);
    // No mother UUID should appear in the baseline.
    assertEquals(baselineHidden.includes("m-A"), false);
    assertEquals(baselineHidden.includes("m-B"), false);

    // With the synthetic fallback at the default 0.2 threshold, both
    // father hidden neurons inherit the mother's real UUID.
    const adjusted = createCompatibleFather(mother, father);
    const adjustedHidden = hiddenUuidsOf(adjusted);
    assert(
      adjustedHidden.includes("m-A") || adjustedHidden.includes("m-B"),
      `expected at least one mother UUID after synthetic alignment, got ${
        JSON.stringify(adjustedHidden)
      }`,
    );

    // Regression: the resulting export contains zero synthetic-UUID strings.
    for (const uuid of adjustedHidden) {
      assert(
        !hasSyntheticSuffix(uuid),
        `synthetic UUID leaked into export: ${uuid}`,
      );
    }
    for (const synapse of adjusted.synapses) {
      const from = synapse.fromUUID ?? "";
      const to = synapse.toUUID ?? "";
      assert(!hasSyntheticSuffix(from), `synthetic in fromUUID: ${from}`);
      assert(!hasSyntheticSuffix(to), `synthetic in toUUID: ${to}`);
    }
  },
);

Deno.test(
  "createCompatibleFather: loose match — input-anchor only also aligns (Issue #2614)",
  () => {
    // The mother has an extra output dimension on its B-neuron, so the
    // (output-0, steps=1) anchor for the father's f-B neuron does NOT
    // match any mother neuron. Only the input-anchor matches. The loose
    // match rule (either anchor) must still align f-B → m-B.
    const mother: CreatureExport = {
      input: 1,
      output: 2,
      neurons: [
        { type: "hidden", uuid: "m-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "m-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "m-A", weight: 0.5 },
        { fromUUID: "m-A", toUUID: "m-B", weight: 0.7 },
        { fromUUID: "m-B", toUUID: "output-0", weight: 0.9 },
        { fromUUID: "m-B", toUUID: "output-1", weight: 0.3 },
      ],
    };
    const father: CreatureExport = {
      input: 1,
      output: 2,
      neurons: [
        { type: "hidden", uuid: "f-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "f-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-1", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "f-A", weight: 0.5 },
        { fromUUID: "f-A", toUUID: "f-B", weight: 0.7 },
        { fromUUID: "f-B", toUUID: "output-0", weight: 0.9 },
        // Note: father is missing the output-1 connection from f-B.
        // This is intentional — output-1 must still exist on father, so
        // wire it from f-A directly so f-B's nearest-output anchor differs.
        { fromUUID: "f-A", toUUID: "output-1", weight: 0.4 },
      ],
    };

    const adjusted = createCompatibleFather(mother, father);
    const adjustedHidden = hiddenUuidsOf(adjusted);
    assert(
      adjustedHidden.includes("m-B") || adjustedHidden.includes("m-A"),
      `expected loose-match alignment, got ${JSON.stringify(adjustedHidden)}`,
    );
    for (const uuid of adjustedHidden) {
      assert(
        !hasSyntheticSuffix(uuid),
        `synthetic UUID leaked into export: ${uuid}`,
      );
    }
  },
);

Deno.test(
  "createCompatibleFather: stable-UUID alignment is not double-claimed by synthetic pass (Issue #2614)",
  () => {
    // f-A is bound to mother-A by stable UUID (`shared-A`) before the
    // synthetic pass runs. The synthetic pass must NOT re-bind f-A to a
    // different mother neuron and must NOT claim mother-A's id again.
    const mother: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "shared-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "m-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "shared-A", weight: 0.5 },
        { fromUUID: "shared-A", toUUID: "m-B", weight: 0.7 },
        { fromUUID: "m-B", toUUID: "output-0", weight: 0.9 },
      ],
    };
    const father: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "shared-A", bias: 0, squash: "IDENTITY" },
        { type: "hidden", uuid: "f-B", bias: 0, squash: "IDENTITY" },
        { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "shared-A", weight: 0.5 },
        { fromUUID: "shared-A", toUUID: "f-B", weight: 0.7 },
        { fromUUID: "f-B", toUUID: "output-0", weight: 0.9 },
      ],
    };

    const adjusted = createCompatibleFather(mother, father);
    const adjustedHidden = hiddenUuidsOf(adjusted);
    // shared-A must remain shared-A, no double-claim.
    assertEquals(
      adjustedHidden.filter((u) => u === "shared-A").length,
      1,
      "shared-A must appear exactly once after alignment",
    );
    for (const uuid of adjustedHidden) {
      assert(
        !hasSyntheticSuffix(uuid),
        `synthetic UUID leaked into export: ${uuid}`,
      );
    }
  },
);

Deno.test(
  "createCompatibleFatherFromCreatures: below-threshold case aligns via synthetic UUID and exports cleanly (Issue #2614)",
  () => {
    const mother = Creature.fromJSON(makeLinearMother());
    const father = Creature.fromJSON(makeLinearFather());

    const adjusted = createCompatibleFatherFromCreatures(mother, father);
    const adjustedHidden = hiddenUuidsOf(adjusted);
    assert(
      adjustedHidden.includes("m-A") || adjustedHidden.includes("m-B"),
      `expected at least one mother UUID after synthetic alignment, got ${
        JSON.stringify(adjustedHidden)
      }`,
    );

    // Build a child via fromJSON and re-export — confirm round-trip
    // produces zero synthetic UUID strings.
    const child = Creature.fromJSON(adjusted);
    const reExported = child.exportJSON();
    for (const n of reExported.neurons) {
      const uuid = n.uuid;
      if (typeof uuid === "string") {
        assert(
          !hasSyntheticSuffix(uuid),
          `synthetic UUID leaked into exportJSON: ${uuid}`,
        );
      }
    }
    for (const s of reExported.synapses) {
      const f = s.fromUUID ?? "";
      const t = s.toUUID ?? "";
      assert(
        !hasSyntheticSuffix(f),
        `synthetic UUID leaked into exportJSON synapse fromUUID: ${f}`,
      );
      assert(
        !hasSyntheticSuffix(t),
        `synthetic UUID leaked into exportJSON synapse toUUID: ${t}`,
      );
    }
  },
);

Deno.test(
  "createCompatibleFatherFromCreatures: threshold = 0 disables synthetic pass (Issue #2614)",
  () => {
    const mother = Creature.fromJSON(makeLinearMother());
    const father = Creature.fromJSON(makeLinearFather());

    const adjusted = createCompatibleFatherFromCreatures(mother, father, 0);
    const adjustedHidden = hiddenUuidsOf(adjusted);
    // Without synthetic alignment the father's UUIDs survive unchanged.
    assertEquals(adjustedHidden.includes("m-A"), false);
    assertEquals(adjustedHidden.includes("m-B"), false);
  },
);
