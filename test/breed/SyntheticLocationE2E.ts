/**
 * End-to-end regression for the synthetic-UUID alignment fallback wired into
 * `createCompatibleFatherFromCreatures` by Issue #2614.
 *
 * Loads two production-shape, genetically incompatible parent fixtures
 * (mother modelled on the GRQ-cluster `network.json`, father modelled on the
 * GRQ-teams Europa creature) and proves that:
 *
 *  1. Real-UUID overlap is below the configured `syntheticAlignmentThreshold`.
 *  2. The synthetic-UUID alignment pass produces strictly more aligned
 *     father→mother id mappings than a baseline run with the pass disabled
 *     (`syntheticAlignmentThreshold: 0`).
 *  3. `Offspring.breed` returns a non-undefined child that passes
 *     `creatureValidate`.
 *  4. The child's `exportJSON()` contains zero synthetic UUID strings on any
 *     `uuid`, `fromUUID`, or `toUUID` field — alignment is ephemeral and
 *     never persisted.
 *
 * Fixtures live under `test/breed/fixtures/synthetic-alignment/`. See the
 * `README.md` in that folder for provenance and licence notes (Issue #2615).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createCompatibleFatherFromCreatures } from "@breed/Father.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

const FIXTURE_DIR = new URL(
  "./fixtures/synthetic-alignment/",
  import.meta.url,
);
const MOTHER_PATH = new URL("parent-mother.json", FIXTURE_DIR);
const FATHER_PATH = new URL("parent-father.json", FIXTURE_DIR);

/**
 * Synthetic UUIDs are formatted `${anchor}-${steps}-${sign}-${rank}` where
 * `anchor` is `input-N` or `output-N`, `steps >= 1`, `sign ∈ {pos, neg}`,
 * and `rank >= 0`. Issue #2615 acceptance criterion 5: this regex must
 * never match anything in the bred child's export.
 */
const SYNTHETIC_UUID_REGEX = /^(input|output)-\d+-\d+-(pos|neg)-\d+$/;

function loadFixture(path: URL): CreatureExport {
  const text = Deno.readTextFileSync(path);
  return JSON.parse(text) as CreatureExport;
}

function realUuidOverlap(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  if (smaller.size === 0) return 1;
  let matches = 0;
  for (const u of smaller) {
    if (larger.has(u)) matches++;
  }
  return matches / smaller.size;
}

/**
 * Counts the number of father hidden/constant neurons that ended up
 * remapped to the mother — i.e. the resulting export's `uuid` is a
 * known mother hidden/constant UUID. Each remapped father neuron
 * inherits the mother's real UUID.
 */
function countRemappedToMother(
  adjusted: CreatureExport,
  motherHiddenUuids: Set<string>,
): number {
  let n = 0;
  for (const neuron of adjusted.neurons) {
    if (neuron.type !== "hidden" && neuron.type !== "constant") continue;
    if (typeof neuron.uuid === "string" && motherHiddenUuids.has(neuron.uuid)) {
      n++;
    }
  }
  return n;
}

function motherHiddenUuidSet(motherExport: CreatureExport): Set<string> {
  const out = new Set<string>();
  for (const n of motherExport.neurons) {
    if (
      (n.type === "hidden" || n.type === "constant") &&
      typeof n.uuid === "string"
    ) {
      out.add(n.uuid);
    }
  }
  return out;
}

function assertNoSyntheticUuids(exported: CreatureExport, where: string) {
  for (const neuron of exported.neurons) {
    if (typeof neuron.uuid === "string") {
      assert(
        !SYNTHETIC_UUID_REGEX.test(neuron.uuid),
        `synthetic UUID leaked into ${where} neuron.uuid: ${neuron.uuid}`,
      );
    }
  }
  for (const synapse of exported.synapses) {
    if (typeof synapse.fromUUID === "string") {
      assert(
        !SYNTHETIC_UUID_REGEX.test(synapse.fromUUID),
        `synthetic UUID leaked into ${where} synapse.fromUUID: ${synapse.fromUUID}`,
      );
    }
    if (typeof synapse.toUUID === "string") {
      assert(
        !SYNTHETIC_UUID_REGEX.test(synapse.toUUID),
        `synthetic UUID leaked into ${where} synapse.toUUID: ${synapse.toUUID}`,
      );
    }
  }
}

Deno.test(
  "Synthetic-alignment E2E: GRQ-style incompatible parents (Issue #2615)",
  () => {
    const motherExport = loadFixture(MOTHER_PATH);
    const fatherExport = loadFixture(FATHER_PATH);

    const mother = Creature.fromJSON(motherExport);
    const father = Creature.fromJSON(fatherExport);

    // (1) Pre-test sanity: real-UUID overlap is below 0.2.
    const motherKeys = mother.getHiddenNeuronWireKeys();
    const fatherKeys = father.getHiddenNeuronWireKeys();
    const overlap = realUuidOverlap(motherKeys, fatherKeys);
    assert(
      overlap < 0.2,
      `expected real-UUID overlap < 0.2 to exercise the synthetic fallback, got ${overlap}`,
    );

    // (2) Baseline: disable the synthetic pass via threshold = 0 and
    //     count how many father neurons get remapped to mother ids.
    const baselineFather = createCompatibleFatherFromCreatures(
      mother,
      father,
      0, // disables the synthetic-alignment pass — internal-only override
    );
    const motherHidden = motherHiddenUuidSet(motherExport);
    const baselineCount = countRemappedToMother(baselineFather, motherHidden);

    // (3) Synthetic pass: default threshold (0.2) — fires because overlap < 0.2.
    const syntheticFather = createCompatibleFatherFromCreatures(mother, father);
    const syntheticCount = countRemappedToMother(syntheticFather, motherHidden);

    assert(
      syntheticCount > baselineCount,
      `expected synthetic-UUID pass to remap strictly more father neurons than baseline; got synthetic=${syntheticCount} baseline=${baselineCount}`,
    );

    // (4) Both intermediate exports must be free of synthetic UUIDs —
    //     synthetic UUIDs are alignment-only and must never be persisted.
    assertNoSyntheticUuids(
      syntheticFather,
      "createCompatibleFatherFromCreatures result",
    );
    assertNoSyntheticUuids(
      baselineFather,
      "baseline createCompatibleFatherFromCreatures result",
    );

    // (5) Breed via Offspring.breed and assert the child is valid.
    //     Pass `geneticCompatibilityThreshold` so the standard crossover
    //     path runs (the parents are intentionally incompatible).
    const child = Offspring.breed(mother, father, {
      geneticCompatibilityThreshold: 1,
    });
    assert(
      child !== undefined,
      "Offspring.breed must return a non-undefined child for incompatible parents with synthetic alignment",
    );
    // creatureValidate throws on failure; a successful return = pass.
    creatureValidate(child);

    // (6) Child's exportJSON must not contain any synthetic UUID strings.
    const childExport = child.exportJSON();
    assertEquals(
      childExport.input,
      mother.input,
      "child must have the parents' input arity",
    );
    assertEquals(
      childExport.output,
      mother.output,
      "child must have the parents' output arity",
    );
    assertNoSyntheticUuids(childExport, "child.exportJSON()");
  },
);
