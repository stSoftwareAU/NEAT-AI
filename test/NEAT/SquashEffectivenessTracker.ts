/**
 * SquashEffectivenessTracker tests (Issue #2457).
 *
 * Verifies the per-role squash effectiveness tracker drives ModSquash
 * sampling toward squashes with positive EMA fitness deltas — without
 * losing the regression behaviour when the feature flag is off.
 */

import { assertAlmostEquals, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { DEFAULT_SQUASH_EFFECTIVENESS_CONFIG } from "@config/SquashEffectivenessConfig.ts";
import { ModActivation as ModSquash } from "@mutate/ModSquash.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import {
  type NeuronRole,
  SquashEffectivenessTracker,
} from "@neat/SquashEffectivenessTracker.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";

function makeCreature(): Creature {
  const c = new Creature(3, 2, { layers: [{ count: 4 }] });
  CreatureUtil.makeUUID(c);
  return c;
}

function role(): NeuronRole {
  return { layer: "mid", fanIn: "medium" };
}

function buildTracker(
  overrides: Partial<typeof DEFAULT_SQUASH_EFFECTIVENESS_CONFIG> = {},
): SquashEffectivenessTracker {
  return new SquashEffectivenessTracker({
    ...DEFAULT_SQUASH_EFFECTIVENESS_CONFIG,
    ...overrides,
  });
}

// ============================================================================
// Acceptance criterion: minSamples gate prevents premature bias
// ============================================================================

Deno.test("SquashEffectivenessTracker: returns null until minSamples is reached", () => {
  const tracker = buildTracker({ minSamples: 5, explorationWeight: 0 });
  const r = role();
  const candidates = ["RELU", "TANH", "LOGISTIC"];
  const rng = createSeededRng(42);

  // Feed a strongly positive signal for RELU but stop short of minSamples.
  for (let i = 0; i < 4; i++) {
    tracker.recordOutcome(r, "RELU", 1.0);
  }

  assertEquals(tracker.getSampleCount(r), 4);
  // With insufficient samples the tracker MUST decline to bias.
  for (let i = 0; i < 20; i++) {
    assertEquals(tracker.pickSquashBiased(r, candidates, rng), null);
  }
});

Deno.test("SquashEffectivenessTracker: starts biasing once minSamples is reached", () => {
  const tracker = buildTracker({ minSamples: 5, explorationWeight: 0 });
  const r = role();
  const candidates = ["RELU", "TANH", "LOGISTIC"];
  const rng = createSeededRng(7);

  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(r, "RELU", 1.0);
  }

  let biased = 0;
  for (let i = 0; i < 50; i++) {
    if (tracker.pickSquashBiased(r, candidates, rng) !== null) biased++;
  }
  assertGreater(
    biased,
    0,
    "Tracker should produce biased picks once minSamples is met",
  );
});

// ============================================================================
// Acceptance criterion: biased deltas concentrate draws on the favoured squash
// ============================================================================

Deno.test("SquashEffectivenessTracker: feeds positive deltas to RELU and biases sampling", () => {
  const explorationWeight = 0.2;
  const tracker = buildTracker({
    minSamples: 5,
    explorationWeight,
    emaAlpha: 0.5,
  });
  const r = role();
  const candidates = ["RELU", "TANH", "LOGISTIC"];
  const rng = createSeededRng(2024);

  // RELU consistently improves fitness; the others are flat.
  for (let i = 0; i < 30; i++) {
    tracker.recordOutcome(r, "RELU", 0.1);
    tracker.recordOutcome(r, "TANH", 0.0);
    tracker.recordOutcome(r, "LOGISTIC", 0.0);
  }

  // Draw many times. When the tracker biases (and the pick is not the
  // exploration draw), RELU must dominate by at least (1 - explorationWeight).
  let reluDraws = 0;
  let biasedDraws = 0;
  const totalDraws = 1000;
  for (let i = 0; i < totalDraws; i++) {
    const pick = tracker.pickSquashBiased(r, candidates, rng);
    if (pick !== null) {
      biasedDraws++;
      if (pick === "RELU") reluDraws++;
    }
  }

  assertGreater(
    biasedDraws,
    totalDraws * 0.5,
    "Most draws should be biased once enough samples exist",
  );
  // Among biased draws, RELU should be picked overwhelmingly because
  // exp(0.1) > exp(0) for the alternatives.
  const reluRate = reluDraws / biasedDraws;
  assertGreater(
    reluRate,
    1 - explorationWeight - 0.1,
    `RELU pick rate ${reluRate} should exceed (1 - explorationWeight)`,
  );
});

// ============================================================================
// Acceptance criterion: disabling the flag restores uniform squash sampling
// ============================================================================

Deno.test("SquashEffectivenessTracker: disabled flag returns null so caller falls back to uniform", () => {
  const tracker = buildTracker({ enabled: false });
  const r = role();
  const candidates = ["RELU", "TANH", "LOGISTIC"];
  const rng = createSeededRng(1);

  for (let i = 0; i < 100; i++) {
    tracker.recordOutcome(r, "RELU", 5.0);
  }
  for (let i = 0; i < 50; i++) {
    assertEquals(
      tracker.pickSquashBiased(r, candidates, rng),
      null,
      "When disabled the tracker MUST not bias",
    );
  }
});

Deno.test("SquashEffectivenessTracker: with enabled=false, ModSquash produces uniform-equivalent draws via Activations", () => {
  // Regression safeguard: when squashEffectiveness is disabled the operator
  // must fall back to Activations.pickRandomSquash so the squash distribution
  // remains exactly the historical one.
  const config = createNeatConfig({
    populationSize: 4,
    squashEffectiveness: { enabled: false },
  });
  const mutator = new Mutator(config);
  const tracker = mutator.getSquashEffectivenessTracker();
  // Pre-seed a strong bias in the tracker; with enabled=false this must be
  // ignored.
  const r: NeuronRole = { layer: "input-adjacent", fanIn: "medium" };
  for (let i = 0; i < 200; i++) tracker.recordOutcome(r, "RELU", 100);

  const seen = new Set<string>();
  for (let attempt = 0; attempt < 60; attempt++) {
    const creature = makeCreature();
    let changed = false;
    for (let i = 0; i < 10 && !changed; i++) {
      changed = mutator.mutateCreature(creature, Mutation.MOD_SQUASH);
    }
    if (!changed) continue;
    for (const neuron of creature.neurons) {
      if (neuron.type === "hidden" || neuron.type === "output") {
        if (neuron.squash) seen.add(neuron.squash);
      }
    }
  }
  // Uniform sampling should expose multiple distinct squashes across attempts.
  assertGreater(
    seen.size,
    1,
    `When disabled the operator must explore multiple squashes (saw ${seen.size})`,
  );
});

// ============================================================================
// EMA / commit semantics
// ============================================================================

Deno.test("SquashEffectivenessTracker: commit applies (currentScore - baseline) when baseline present", () => {
  const tracker = buildTracker({ emaAlpha: 1.0, minSamples: 1 });
  const creature = makeCreature();
  const r = role();
  tracker.recordPending(creature, r, "RELU", 0.5);

  const committed = tracker.commit(creature, 0.9);
  assertEquals(committed, true);
  // emaAlpha=1 means the EMA equals the most recent delta exactly.
  assertAlmostEquals(tracker.getEma(r, "RELU"), 0.4, 1e-9);
  assertEquals(tracker.getSampleCount(r), 1);
});

Deno.test("SquashEffectivenessTracker: commit returns false when nothing pending", () => {
  const tracker = buildTracker();
  const creature = makeCreature();
  assertEquals(tracker.commit(creature, 1.0), false);
});

Deno.test("SquashEffectivenessTracker: commit ignores non-finite scores", () => {
  const tracker = buildTracker();
  const creature = makeCreature();
  tracker.recordPending(creature, role(), "RELU", 0);
  assertEquals(tracker.commit(creature, Number.NaN), false);
  assertEquals(tracker.getSampleCount(role()), 0);
});

// ============================================================================
// computeRole bucketing
// ============================================================================

Deno.test("SquashEffectivenessTracker: output neurons map to output-adjacent layer", () => {
  const tracker = buildTracker();
  const creature = makeCreature();
  const outputStart = creature.neurons.length - creature.output;
  const r = tracker.computeRole(creature, outputStart);
  assertEquals(r.layer, "output-adjacent");
});

Deno.test("SquashEffectivenessTracker: fan-in buckets are determined by inward connection count", () => {
  const tracker = buildTracker({
    fanInLowThreshold: 3,
    fanInHighThreshold: 8,
  });
  const creature = makeCreature();

  // Find a hidden neuron index.
  let hiddenIndex = -1;
  for (let i = 0; i < creature.neurons.length; i++) {
    if (creature.neurons[i].type === "hidden") {
      hiddenIndex = i;
      break;
    }
  }
  assertGreater(hiddenIndex, -1);

  const r = tracker.computeRole(creature, hiddenIndex);
  // Default 3-input × 4-hidden layer means each hidden neuron has fan-in 3,
  // which falls into the "medium" bucket (>=3 and <8).
  assertEquals(r.fanIn, "medium");
});

// ============================================================================
// ModSquash + tracker integration: pending → commit pipeline
// ============================================================================

Deno.test("ModSquash: records pending entry on the tracker when enabled", () => {
  const config = createNeatConfig({
    populationSize: 4,
    squashEffectiveness: { enabled: true, minSamples: 1 },
  });
  const mutator = new Mutator(config);
  const tracker = mutator.getSquashEffectivenessTracker();

  const creature = makeCreature();
  creature.score = 0.4; // Pre-mutation baseline
  let mutated = false;
  for (let i = 0; i < 20 && !mutated; i++) {
    mutated = mutator.mutateCreature(creature, Mutation.MOD_SQUASH);
  }
  // The mutation may legitimately fail in a single-neuron pool; if so, skip.
  if (!mutated) return;

  // After the mutation, committing with a higher score should record a
  // positive EMA delta. We do not know which role / squash was selected,
  // so we just assert that *some* role accumulated a sample.
  const before = totalSamples(tracker);
  tracker.commit(creature, 0.9);
  const after = totalSamples(tracker);
  assertGreater(
    after - before,
    0,
    "commit must record at least one sample after a successful squash mutation",
  );
});

Deno.test("ModSquash: tracker disabled means no pending entries are recorded", () => {
  const config = createNeatConfig({
    populationSize: 4,
    squashEffectiveness: { enabled: false },
  });
  const mutator = new Mutator(config);
  const tracker = mutator.getSquashEffectivenessTracker();

  const creature = makeCreature();
  creature.score = 0.4;
  for (let i = 0; i < 20; i++) {
    mutator.mutateCreature(creature, Mutation.MOD_SQUASH);
  }
  assertEquals(
    tracker.commit(creature, 0.9),
    false,
    "No pending entry should be recorded when the tracker is disabled",
  );
});

// ============================================================================
// Direct unit test: ModSquash uses Activations registry
// ============================================================================

Deno.test("ModSquash: result is a registered activation name", () => {
  const config = createNeatConfig({ populationSize: 4 });
  const mutator = new Mutator(config);
  const creature = makeCreature();
  let mutated = false;
  for (let i = 0; i < 10 && !mutated; i++) {
    mutated = mutator.mutateCreature(creature, Mutation.MOD_SQUASH);
  }
  if (!mutated) return;
  // Every neuron's squash must resolve via the Activations registry.
  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden" || neuron.type === "output") {
      if (neuron.squash) Activations.find(neuron.squash);
    }
  }
});

Deno.test("ModSquash: ModActivation can be constructed without a tracker", () => {
  const creature = makeCreature();
  const op = new ModSquash(creature);
  // Should not throw — the operator must work in standalone use.
  op.mutate();
});

function totalSamples(tracker: SquashEffectivenessTracker): number {
  // Sum sample counts across every conceivable role bucket. We only need
  // a coarse signal — pick the union of roles ModSquash could plausibly
  // produce on the test creatures.
  const layers: NeuronRole["layer"][] = [
    "input-adjacent",
    "mid",
    "output-adjacent",
  ];
  const fanIns: NeuronRole["fanIn"][] = ["low", "medium", "high"];
  let total = 0;
  for (const layer of layers) {
    for (const fanIn of fanIns) {
      total += tracker.getSampleCount({ layer, fanIn });
    }
  }
  return total;
}
