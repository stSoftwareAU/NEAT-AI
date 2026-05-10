/**
 * Tests for the opt-in evolveRL milestone statistics surface
 * (Issue #2629, part of #2624).
 *
 * Covers:
 *
 * 1. `isMilestoneGeneration` predicate matches the schedule
 *    `1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, …` (geometric continuation
 *    by powers of ten beyond `1000`).
 * 2. Statistics off (default): no `evolverl_milestone` events fire over
 *    50 generations.
 * 3. Statistics on: events fire exactly at the milestone generations within
 *    50 generations (`1, 2, 5, 10, 20, 50`) and at no other generation.
 * 4. Payload shape: every field is present with the expected type and is
 *    consistent with the run.
 * 5. The returned `milestones` array length matches the count of emitted
 *    `evolverl_milestone` events.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { EpisodeAdapter, type StepResult } from "@creature/EpisodeAdapter.ts";
import { isMilestoneGeneration } from "@creature/EvolveRLStatistics.ts";
import type { TrainingEvent } from "@config/TrainingEvent.ts";
import { initWasmForTests } from "../_initWasm.ts";

await initWasmForTests();

// ---------------------------------------------------------------------------
// Adapter — minimal single-tick environment
// ---------------------------------------------------------------------------

/**
 * Trivial single-tick adapter. Reward is the constant `-1` so episodes always
 * terminate after one `step()` and `defaultRewardToError` produces a stable,
 * strictly positive error — the iterations cap is the only stop condition we
 * need to worry about.
 */
class SingleTickAdapter extends EpisodeAdapter<null, number> {
  override reset(_seed: number): { observation: Float32Array; state: null } {
    return { observation: new Float32Array([0.5]), state: null };
  }
  override step(
    _state: null,
    _action: number,
  ): StepResult<Float32Array> & { state: null } {
    return {
      observation: new Float32Array([0]),
      reward: -1,
      terminated: true,
      truncated: false,
      state: null,
    };
  }
  override get observationLength(): number {
    return 1;
  }
  override decodeAction(_creatureOutput: Float32Array): number {
    return 0;
  }
  override maxSteps(): number {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// 1. Predicate — milestone schedule
// ---------------------------------------------------------------------------

Deno.test("EvolveRLStatistics: isMilestoneGeneration matches the schedule", () => {
  // True — every value in the explicit schedule.
  assertEquals(isMilestoneGeneration(1), true);
  assertEquals(isMilestoneGeneration(2), true);
  assertEquals(isMilestoneGeneration(5), true);
  assertEquals(isMilestoneGeneration(10), true);
  assertEquals(isMilestoneGeneration(20), true);
  assertEquals(isMilestoneGeneration(50), true);
  assertEquals(isMilestoneGeneration(100), true);
  assertEquals(isMilestoneGeneration(200), true);
  assertEquals(isMilestoneGeneration(500), true);
  assertEquals(isMilestoneGeneration(1000), true);

  // False — non-milestone neighbours.
  assertEquals(isMilestoneGeneration(3), false);
  assertEquals(isMilestoneGeneration(4), false);
  assertEquals(isMilestoneGeneration(6), false);
  assertEquals(isMilestoneGeneration(11), false);
  assertEquals(isMilestoneGeneration(99), false);
  assertEquals(isMilestoneGeneration(150), false);

  // Beyond 1000 the schedule sparsifies to powers of ten — 2_000 / 5_000
  // are deliberately excluded so the cadence is one milestone per decade.
  assertEquals(isMilestoneGeneration(2000), false);
  assertEquals(isMilestoneGeneration(5000), false);
  assertEquals(isMilestoneGeneration(10_000), true);
  assertEquals(isMilestoneGeneration(100_000), true);
  assertEquals(isMilestoneGeneration(20_000), false);

  // Invalid inputs reject without throwing.
  assertEquals(isMilestoneGeneration(0), false);
  assertEquals(isMilestoneGeneration(-1), false);
  assertEquals(isMilestoneGeneration(1.5), false);
  assertEquals(isMilestoneGeneration(Number.NaN), false);
  assertEquals(isMilestoneGeneration(Number.POSITIVE_INFINITY), false);
});

// ---------------------------------------------------------------------------
// 2. Statistics off (default) — no milestone events fire
// ---------------------------------------------------------------------------

Deno.test("EvolveRLStatistics: default off — no milestone events over 50 generations", async () => {
  const creature = new Creature(1, 1);
  const adapter = new SingleTickAdapter();
  const events: TrainingEvent[] = [];

  const result = await creature.evolveRL(adapter, {
    iterations: 50,
    populationSize: 4,
    targetError: 0,
    seed: 1,
    threads: 1,
    episodesPerCreature: 1,
    onTrainingEvent: (event) => events.push(event),
  });

  // The run must complete the cap (reward = -1 means error never reaches 0).
  assertEquals(result.generation, 50);

  // Zero milestone events when statistics are off.
  const milestoneEvents = events.filter((e) => e.kind === "evolverl_milestone");
  assertEquals(milestoneEvents.length, 0);

  // The return payload must NOT carry the milestones field when stats off,
  // preserving the #2628 return shape.
  assertEquals(
    Object.prototype.hasOwnProperty.call(result, "milestones"),
    false,
  );
});

// ---------------------------------------------------------------------------
// 3 + 4 + 5. Statistics on — events fire only at milestones, payload is
// well-formed, and the returned `milestones` array matches the events.
// ---------------------------------------------------------------------------

Deno.test("EvolveRLStatistics: on — events at exactly 1, 2, 5, 10, 20, 50 over 50 generations", async () => {
  const creature = new Creature(1, 1);
  const adapter = new SingleTickAdapter();
  const milestoneEvents: Extract<
    TrainingEvent,
    { kind: "evolverl_milestone" }
  >[] = [];

  const result = await creature.evolveRL(adapter, {
    iterations: 50,
    populationSize: 4,
    targetError: 0,
    seed: 1,
    threads: 1,
    episodesPerCreature: 1,
    statistics: true,
    onTrainingEvent: (event) => {
      if (event.kind === "evolverl_milestone") milestoneEvents.push(event);
    },
  });

  // Run completes all 50 generations.
  assertEquals(result.generation, 50);

  // Events fire exactly at the schedule entries that fall inside [1, 50].
  assertEquals(
    milestoneEvents.map((e) => e.generation),
    [1, 2, 5, 10, 20, 50],
  );

  // ----- 4. Payload shape -----
  for (const event of milestoneEvents) {
    assertEquals(typeof event.generation, "number");
    assertEquals(Number.isInteger(event.generation), true);
    assertEquals(typeof event.bestScore, "number");
    assertEquals(typeof event.bestNeurons, "number");
    assertEquals(typeof event.bestSynapses, "number");
    assertEquals(typeof event.meanEpisodeSteps, "number");
    assertEquals(typeof event.generationWallClockMs, "number");

    // Topology counts are positive integers — the trivial network has at
    // least 1 input + 1 output neuron.
    assert(
      event.bestNeurons >= 2,
      `bestNeurons too small: ${event.bestNeurons}`,
    );
    assert(event.bestSynapses >= 0);

    // The single-tick adapter terminates after exactly 1 step, so the mean
    // steps across the generation must equal 1.
    assertEquals(event.meanEpisodeSteps, 1);

    // Wall-clock time is non-negative and finite.
    assert(Number.isFinite(event.generationWallClockMs));
    assert(event.generationWallClockMs >= 0);

    // bestScore is finite (the run never produced NaN/Infinity rewards).
    assert(Number.isFinite(event.bestScore));
  }

  // ----- 5. Returned `milestones` array matches emitted events -----
  assert(result.milestones !== undefined, "milestones must be present");
  assertEquals(result.milestones!.length, milestoneEvents.length);
  for (let i = 0; i < milestoneEvents.length; i++) {
    const ret = result.milestones![i];
    const evt = milestoneEvents[i];
    assertEquals(ret.generation, evt.generation);
    assertEquals(ret.bestScore, evt.bestScore);
    assertEquals(ret.bestNeurons, evt.bestNeurons);
    assertEquals(ret.bestSynapses, evt.bestSynapses);
    assertEquals(ret.meanEpisodeSteps, evt.meanEpisodeSteps);
    assertEquals(ret.generationWallClockMs, evt.generationWallClockMs);
  }
});
