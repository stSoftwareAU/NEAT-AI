/**
 * Issue #3909 — end-to-end behaviour of `mcmcAdvantageMode: "rankShaped"`.
 *
 * Covers the config surface, the run-wide reference window carried on
 * `MCMCState`, the acceptance decision in the mutation pipeline, and the
 * centred-rank variant of the parent-selection advantage map.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { DEFAULT_MCMC_CONFIG } from "@config/MCMCConfig.ts";
import { Genus } from "@neat/Genus.ts";
import { MCMCState } from "@neat/MCMCState.ts";
import { Mutator } from "@neat/Mutator.ts";
import { computeCreatureWeightBiasPenalty } from "@neat/MetropolisHastings.ts";
import { buildGroupRelativeAdvantageMap } from "@breed/ParentSelection.ts";
import { DEFAULT_RANK_SHAPING_WINDOW } from "@neat/RankShaping.ts";

// ---------------------------------------------------------------- config

Deno.test("rankShaped - config accepts the new advantage mode", () => {
  const config = createNeatConfig({
    mcmc: { enabled: true, mcmcAdvantageMode: "rankShaped" },
  });
  assertEquals(config.mcmc.mcmcAdvantageMode, "rankShaped");
});

Deno.test("rankShaped - remains opt-in", () => {
  assertEquals(DEFAULT_MCMC_CONFIG.mcmcAdvantageMode, "absolute");
  assertEquals(createNeatConfig({}).mcmc.mcmcAdvantageMode, "absolute");
});

Deno.test("rankShaped - an unknown advantage mode still fails fast", () => {
  assertThrows(
    () =>
      createNeatConfig({
        mcmc: { mcmcAdvantageMode: "ranked" as never },
      }),
    Error,
    "mcmcAdvantageMode",
  );
});

Deno.test("rankShaped - rankShapingWindow default and validation", () => {
  assertEquals(
    createNeatConfig({}).mcmc.rankShapingWindow,
    DEFAULT_RANK_SHAPING_WINDOW,
  );
  assertEquals(
    createNeatConfig({ mcmc: { rankShapingWindow: 32 } }).mcmc
      .rankShapingWindow,
    32,
  );
  assertThrows(
    () => createNeatConfig({ mcmc: { rankShapingWindow: 0 } }),
    Error,
    "rankShapingWindow",
  );
  assertThrows(
    () => createNeatConfig({ mcmc: { rankShapingWindow: 12.5 } }),
    Error,
    "rankShapingWindow",
  );
});

// ------------------------------------------------------------- MCMCState

Deno.test("rankShaped - MCMCState sizes its window from config", () => {
  const config = createNeatConfig({
    mcmc: {
      enabled: true,
      mcmcAdvantageMode: "rankShaped",
      rankShapingWindow: 3,
    },
  });
  const state = new MCMCState(config.mcmc);
  for (const d of [10, 11, 12, 0.1, 0.2]) state.rankShaping.record(d);
  assertEquals(state.rankShaping.size, 3);
});

Deno.test("rankShaped - MCMCState.reset() drops the abandoned run's deltas", () => {
  const config = createNeatConfig({
    mcmc: { enabled: true, mcmcAdvantageMode: "rankShaped" },
  });
  const state = new MCMCState(config.mcmc);
  for (const d of [0.1, 0.2, 0.3, 0.4]) state.rankShaping.record(d);
  assert(state.rankShaping.shape(0.05) < 0.5, "ranks below a populated window");
  state.reset();
  assertEquals(state.rankShaping.shape(0.05), 0.5);
});

// -------------------------------------------------- acceptance behaviour

/** A small creature with uniform, non-trivial weights and biases. */
function makeMutationTarget(): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  for (const synapse of creature.synapses) synapse.weight = 0.5;
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = 0.1;
  }
  return creature;
}

function makeRankShapedConfig(temperature: number) {
  return createNeatConfig({
    creatures: [makeMutationTarget().exportJSON()],
    mutationRate: 1.0,
    mutationAmount: 3,
    mutation: [{ name: "MOD_WEIGHT" }, { name: "MOD_BIAS" }],
    mcmc: {
      enabled: true,
      mcmcAdvantageMode: "rankShaped",
      initialTemperature: temperature,
      minTemperature: temperature,
    },
  });
}

/** Snapshot of every weight and bias, for change detection. */
function magnitudes(creature: Creature): number[] {
  const out = creature.synapses.map((s) => s.weight);
  for (let i = creature.input; i < creature.neurons.length; i++) {
    out.push(creature.neurons[i].bias);
  }
  return out;
}

Deno.test("rankShaped - near-zero temperature rejects every worsening proposal", () => {
  // Under rank shaping a worsening proposal shapes to a quantile in (0, 1),
  // so exp(-q / 1e-15) underflows to zero: the penalty must never rise.
  const config = makeRankShapedConfig(1e-15);
  const creature = makeMutationTarget();
  const before = computeCreatureWeightBiasPenalty(creature);

  const mutator = new Mutator(config, 1e-15);
  // Several rounds so the reference cohort is populated and the shaped
  // delta is a genuine quantile rather than the no-information 0.5.
  for (let i = 0; i < 8; i++) mutator.mutate([creature]);

  const after = computeCreatureWeightBiasPenalty(creature);
  assert(
    after <= before,
    `penalty must not rise at a frozen temperature: ${before} → ${after}`,
  );
});

Deno.test("rankShaped - a hot temperature lets worsening mutations through", () => {
  const config = makeRankShapedConfig(1e6);
  const creature = makeMutationTarget();
  const before = magnitudes(creature);

  const mutator = new Mutator(config, 1e6);
  for (let i = 0; i < 5; i++) mutator.mutate([creature]);

  const after = magnitudes(creature);
  assert(
    after.some((v, i) => v !== before[i]),
    "at least one weight/bias moved at a hot temperature",
  );
});

Deno.test("rankShaped - the shared window accumulates across generations", () => {
  const config = makeRankShapedConfig(0.5);
  const state = new MCMCState(config.mcmc);
  const creature = makeMutationTarget();

  for (let generation = 0; generation < 4; generation++) {
    // A fresh Mutator per generation, exactly as NeatEvolution builds one.
    const mutator = new Mutator(config, 0.5);
    mutator.setRankShapingWindow(state.rankShaping);
    mutator.mutate([creature]);
  }

  assert(
    state.rankShaping.size > 0,
    "proposals from earlier generations remain available to rank against",
  );
});

// ------------------------------------------------- parent-selection maps

function makeScoredCreature(hiddenUuid: string, score: number): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: hiddenUuid, squash: "LOGISTIC", bias: 0 },
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

function advantageMapFor(scores: number[], shaping: "zscore" | "centredRank") {
  const creatures = scores.map((s, i) => makeScoredCreature(`h-${i}`, s));
  const genus = new Genus();
  for (const c of creatures) genus.addCreature(c);
  const map = buildGroupRelativeAdvantageMap(genus, {
    minCohortSize: 4,
    shaping,
  });
  return creatures.map((c) => map.get(c.uuid!)!);
}

Deno.test("centredRank shaping - preserves the fitness ordering", () => {
  const advantages = advantageMapFor([0.1, 0.3, 0.5, 0.7, 0.9], "centredRank");
  assertEquals(advantages, [-0.5, -0.25, 0, 0.25, 0.5]);
});

Deno.test("centredRank shaping - an outlier cannot flatten the rest of the cohort", () => {
  const modest = advantageMapFor([1, 2, 3, 4, 5], "centredRank");
  const extreme = advantageMapFor([1, 2, 3, 4, 1e9], "centredRank");
  assertEquals(extreme, modest);

  // The z-score it replaces does collapse under the same outlier: the four
  // ordinary members all crowd toward the same value.
  const zModest = advantageMapFor([1, 2, 3, 4, 5], "zscore");
  const zExtreme = advantageMapFor([1, 2, 3, 4, 1e9], "zscore");
  const spread = (v: number[]) =>
    Math.max(...v.slice(0, 4)) - Math.min(...v.slice(0, 4));
  assert(
    spread(zExtreme) < spread(zModest) / 100,
    `expected the z-score spread to collapse, got ${spread(zExtreme)} vs ${
      spread(zModest)
    }`,
  );
});

Deno.test("centredRank shaping - default shaping is still the z-score", () => {
  const creatures = [0.1, 0.3, 0.5, 0.7, 0.9].map((s, i) =>
    makeScoredCreature(`h-${i}`, s)
  );
  const genus = new Genus();
  for (const c of creatures) genus.addCreature(c);
  const map = buildGroupRelativeAdvantageMap(genus, { minCohortSize: 4 });
  // The z-score of the lowest member of this cohort is well outside the
  // [-0.5, 0.5] band a centred rank is confined to.
  const lowest = map.get(creatures[0].uuid!)!;
  assertAlmostEquals(lowest, -1.4142, 1e-3);
});
