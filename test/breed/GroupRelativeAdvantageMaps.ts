/**
 * Tests for the GRPO-style group-relative advantage helpers exposed
 * from `ParentSelection.ts` (Issue #2527).
 *
 * Verifies that `buildGroupRelativeAdvantageMap` and
 * `buildCohortStdContext` produce sensible outputs over a synthetic
 * genus with multiple species — including the small-species fallback
 * behaviour mandated by the issue.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { Genus } from "@neat/Genus.ts";
import {
  buildCohortStdContext,
  buildGroupRelativeAdvantageMap,
} from "@breed/ParentSelection.ts";

function makeCreature(
  hiddenUuid: string,
  score: number,
  squash: "LOGISTIC" | "TANH" | "RELU",
): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: hiddenUuid, squash, bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: hiddenUuid, weight: 0.5 },
      { fromUUID: "input-1", toUUID: hiddenUuid, weight: 0.5 },
      { fromUUID: hiddenUuid, toUUID: "output-0", weight: 0.5 },
    ],
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  addTag(creature, "score", score.toString());
  return creature;
}

Deno.test(
  "buildGroupRelativeAdvantageMap: large species use within-species advantage",
  () => {
    // Five-creature species — above the default minCohortSize of 4 —
    // so the per-species advantage should be the active signal.
    const creatures = [
      makeCreature("h-1", 0.1, "LOGISTIC"),
      makeCreature("h-2", 0.3, "LOGISTIC"),
      makeCreature("h-3", 0.5, "LOGISTIC"),
      makeCreature("h-4", 0.7, "LOGISTIC"),
      makeCreature("h-5", 0.9, "LOGISTIC"),
    ];
    const genus = new Genus();
    for (const c of creatures) genus.addCreature(c);

    const map = buildGroupRelativeAdvantageMap(genus, { minCohortSize: 4 });
    assertEquals(map.size, 5);

    // The middle (mean) entry has ~zero advantage; below-mean entries
    // are negative, above-mean positive.
    assert(map.get(creatures[0].uuid!)! < 0);
    assert(map.get(creatures[1].uuid!)! < 0);
    assertAlmostEquals(map.get(creatures[2].uuid!)!, 0, 1e-6);
    assert(map.get(creatures[3].uuid!)! > 0);
    assert(map.get(creatures[4].uuid!)! > 0);
  },
);

Deno.test(
  "buildGroupRelativeAdvantageMap: small species fall back to generation cohort",
  () => {
    // Create three "species" of 1 creature each (all hidden uuids
    // differ → distinct species keys). Each species is below the
    // default `minCohortSize: 4`, so the helper must fall back to the
    // generation-wide cohort.
    const creatures = [
      makeCreature("h-1", 1.0, "LOGISTIC"),
      makeCreature("h-2", 2.0, "TANH"),
      makeCreature("h-3", 3.0, "RELU"),
    ];
    const genus = new Genus();
    for (const c of creatures) genus.addCreature(c);

    const map = buildGroupRelativeAdvantageMap(genus, { minCohortSize: 4 });
    assertEquals(map.size, 3);

    // Generation mean = 2; advantages must straddle zero.
    assert(map.get(creatures[0].uuid!)! < 0);
    assertAlmostEquals(map.get(creatures[1].uuid!)!, 0, 1e-6);
    assert(map.get(creatures[2].uuid!)! > 0);
  },
);

Deno.test(
  "buildGroupRelativeAdvantageMap: skips creatures with non-finite scores",
  () => {
    const creatures = [
      makeCreature("h-1", 1.0, "LOGISTIC"),
      makeCreature("h-2", 2.0, "TANH"),
      makeCreature("h-3", 3.0, "RELU"),
    ];
    creatures[1].score = NaN;
    const genus = new Genus();
    for (const c of creatures) genus.addCreature(c);

    const map = buildGroupRelativeAdvantageMap(genus, { minCohortSize: 4 });
    assert(!map.has(creatures[1].uuid!));
    assert(map.has(creatures[0].uuid!));
    assert(map.has(creatures[2].uuid!));
  },
);

Deno.test(
  "buildCohortStdContext: returns finite fallback std and per-species std",
  () => {
    // One species of size 5 — has a per-species std entry — and three
    // singletons that fall back to the generation std.
    const creatures = [
      makeCreature("hd-1", 0.1, "LOGISTIC"),
      makeCreature("hd-2", 0.3, "LOGISTIC"),
      makeCreature("hd-3", 0.5, "LOGISTIC"),
      makeCreature("hd-4", 0.7, "LOGISTIC"),
      makeCreature("hd-5", 0.9, "LOGISTIC"),
      makeCreature("h-a", 5.0, "TANH"),
      makeCreature("h-b", 6.0, "RELU"),
    ];
    const genus = new Genus();
    for (const c of creatures) genus.addCreature(c);

    const ctx = buildCohortStdContext(genus, 4);
    assert(Number.isFinite(ctx.fallbackStd));
    assert(ctx.fallbackStd > 0, "generation std should be > 0");

    // The five LOGISTIC creatures share a species → their UUIDs map to
    // a per-species std (>0). The two singletons should not be in the
    // map (they fall back to generation std).
    for (let i = 0; i < 5; i++) {
      const std = ctx.stdByUuid.get(creatures[i].uuid!);
      assert(std !== undefined && std > 0);
    }
    assert(!ctx.stdByUuid.has(creatures[5].uuid!));
    assert(!ctx.stdByUuid.has(creatures[6].uuid!));
  },
);

Deno.test(
  "buildCohortStdContext: zero-variance population yields zero fallback std",
  () => {
    const creatures = [
      makeCreature("h-1", 0.5, "LOGISTIC"),
      makeCreature("h-2", 0.5, "TANH"),
      makeCreature("h-3", 0.5, "RELU"),
    ];
    const genus = new Genus();
    for (const c of creatures) genus.addCreature(c);

    const ctx = buildCohortStdContext(genus, 4);
    assertEquals(ctx.fallbackStd, 0);
    // No species qualifies, so no entries.
    assertEquals(ctx.stdByUuid.size, 0);
  },
);
