/**
 * Tests for breed-time tolerance of corrupt parents (Issue #2523).
 *
 * Verifies that `findFather` skips a candidate whose `Creature.fromJSON`
 * throws a `TopologyError`, surfaces the skip count, and falls back to
 * a recoverable `BreedExhaustionError` only after every candidate has
 * been exhausted (or the retry cap is hit). Setting
 * `tolerateCorruptParents: false` restores legacy fail-fast behaviour;
 * non-`TopologyError` exceptions are always re-thrown unchanged.
 *
 * The tests stub `Creature.fromJSON` so failures can be triggered
 * deterministically by tagging a father with `__corrupt = true`. This
 * exercises the same call site that throws in production
 * (`ParentSelection.ts::findFather`) without depending on producer
 * pipeline corruption to land naturally.
 */
import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { stub } from "@std/testing/mock";
import {
  Creature,
  type CreatureExport,
  CreatureUtil,
  Selection,
} from "../../mod.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Genus } from "@neat/Genus.ts";
import {
  type BreedSelectionStats,
  findFather,
} from "@breed/ParentSelection.ts";
import { BreedExhaustionError } from "@errors/BreedExhaustionError.ts";
import { TopologyError } from "@errors/TopologyError.ts";

const CORRUPT_TAG = "__corrupt-parent-test";

function createScoredCreature(score: number, corrupt = false): Creature {
  const hiddenUUID = crypto.randomUUID();
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: hiddenUUID, squash: "LOGISTIC", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: hiddenUUID, weight: 0.5 },
      { fromUUID: hiddenUUID, toUUID: "output-0", weight: 0.8 },
    ],
  };
  if (corrupt) {
    json.tags = [{ name: CORRUPT_TAG, value: "true" }];
  }
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  return creature;
}

function createGenus(creatures: Creature[]): Genus {
  const genus = new Genus();
  for (const c of creatures) genus.addCreature(c);
  return genus;
}

/**
 * Wraps `Creature.fromJSON` so any export carrying a corrupt-marker tag
 * throws a `TopologyError` (mirroring the production `loadFrom` failure
 * path). Returns a disposer that restores the original implementation.
 */
function stubCorruptFromJson(
  triggeredBy: (json: CreatureExport) => boolean,
  errorFactory: () => Error = () =>
    new TopologyError(
      "[test] simulated recurrent synapse on forward-only creature",
      "INVALID_CONNECTION",
    ),
): { restore: () => void } {
  // deno-lint-ignore no-explicit-any
  const original = (Creature as any).fromJSON.bind(Creature);
  const s = stub(
    Creature,
    "fromJSON",
    // deno-lint-ignore no-explicit-any
    (json: any, validate?: boolean) => {
      if (
        json && typeof json === "object" && Array.isArray(json.neurons) &&
        triggeredBy(json as CreatureExport)
      ) {
        throw errorFactory();
      }
      return original(json, validate);
    },
  );
  return { restore: () => s.restore() };
}

function isCorrupt(json: CreatureExport): boolean {
  const tags = json.tags;
  if (!tags) return false;
  for (const t of tags) {
    if (t.name === CORRUPT_TAG && t.value === "true") return true;
  }
  return false;
}

Deno.test(
  "findFather - skips one corrupt candidate and breeds successfully (Issue #2523)",
  () => {
    // 5 candidates, 1 marked corrupt. Force the global breeding rate so
    // the candidate pool is the entire population — this gives the
    // retry loop a real second draw to fall back on.
    const corrupt = createScoredCreature(0.95, true);
    const goodA = createScoredCreature(0.6);
    const goodB = createScoredCreature(0.55);
    const goodC = createScoredCreature(0.5);
    const mum = createScoredCreature(0.9);
    const genus = createGenus([mum, corrupt, goodA, goodB, goodC]);

    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
    });

    const stats: BreedSelectionStats = { corruptParentSkips: 0 };
    const handle = stubCorruptFromJson(isCorrupt);
    try {
      // Repeat enough times to ensure we eventually pick the corrupt
      // candidate at least once. Five fathers × power selection makes
      // this very likely within 20 attempts.
      let observedSkips = 0;
      let success = 0;
      for (let i = 0; i < 20; i++) {
        const dad = findFather(mum, genus, config, stats);
        if (dad) success++;
      }
      observedSkips = stats.corruptParentSkips;
      assert(success > 0, "should have produced at least one valid father");
      assert(
        observedSkips >= 1,
        `expected at least one corrupt-parent skip, observed ${observedSkips}`,
      );
    } finally {
      handle.restore();
    }
  },
);

Deno.test(
  "findFather - throws BreedExhaustionError when every candidate is corrupt (Issue #2523)",
  () => {
    const corrupt1 = createScoredCreature(0.95, true);
    const corrupt2 = createScoredCreature(0.85, true);
    const corrupt3 = createScoredCreature(0.75, true);
    const mum = createScoredCreature(0.9);
    const genus = createGenus([mum, corrupt1, corrupt2, corrupt3]);

    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
    });

    const stats: BreedSelectionStats = { corruptParentSkips: 0 };
    const handle = stubCorruptFromJson(isCorrupt);
    try {
      let caught: unknown;
      try {
        findFather(mum, genus, config, stats);
      } catch (e) {
        caught = e;
      }
      assertInstanceOf(
        caught,
        BreedExhaustionError,
        "should raise BreedExhaustionError, not TopologyError",
      );
      const err = caught as BreedExhaustionError;
      assert(
        err.corruptParentSkips >= 3,
        `expected ≥3 skips, got ${err.corruptParentSkips}`,
      );
      assertEquals(stats.corruptParentSkips, err.corruptParentSkips);
    } finally {
      handle.restore();
    }
  },
);

Deno.test(
  "findFather - tolerateCorruptParents: false re-throws TopologyError (Issue #2523)",
  () => {
    const corrupt = createScoredCreature(0.95, true);
    const good = createScoredCreature(0.6);
    const mum = createScoredCreature(0.9);
    const genus = createGenus([mum, corrupt, good]);

    // Force selection of the corrupt creature deterministically by
    // making it the only candidate — we set globalBreedingRate=1 so
    // the global pool is used, then the corrupt candidate is the
    // single highest-scored option for POWER selection. Looping
    // multiple times ensures the test stops on the first
    // corrupt draw.
    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
      tolerateCorruptParents: false,
    });
    assertEquals(config.tolerateCorruptParents, false);

    const handle = stubCorruptFromJson(isCorrupt);
    try {
      let caught: unknown;
      // Up to 30 attempts; POWER picks the highest-scored corrupt very
      // frequently. If somehow we never picked corrupt, the test would
      // be inconclusive but not flaky-failing.
      for (let i = 0; i < 30; i++) {
        try {
          findFather(mum, genus, config);
        } catch (e) {
          caught = e;
          break;
        }
      }
      assertInstanceOf(
        caught,
        TopologyError,
        "legacy fail-fast must re-throw TopologyError unchanged",
      );
    } finally {
      handle.restore();
    }
  },
);

Deno.test(
  "findFather - non-TopologyError exceptions are re-thrown unchanged (Issue #2523)",
  () => {
    const bad = createScoredCreature(0.95, true);
    const mum = createScoredCreature(0.9);
    const genus = createGenus([mum, bad, createScoredCreature(0.5)]);

    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
    });

    // Inject a non-TopologyError so the tolerant path must re-throw
    // unchanged regardless of `tolerateCorruptParents`.
    const handle = stubCorruptFromJson(
      isCorrupt,
      () => new Error("[test] disk read failure"),
    );
    try {
      let caught: unknown;
      for (let i = 0; i < 30; i++) {
        try {
          findFather(mum, genus, config);
        } catch (e) {
          caught = e;
          break;
        }
      }
      assert(caught instanceof Error, "expected an Error");
      assert(
        !(caught instanceof TopologyError),
        "must not be wrapped/re-typed as TopologyError",
      );
      assert(
        !(caught instanceof BreedExhaustionError),
        "must not be wrapped as BreedExhaustionError",
      );
      assertEquals((caught as Error).message, "[test] disk read failure");
    } finally {
      handle.restore();
    }
  },
);

Deno.test(
  "config - tolerateCorruptParents defaults to true (Issue #2523)",
  () => {
    const config = createNeatConfig({});
    assertEquals(config.tolerateCorruptParents, true);
  },
);
