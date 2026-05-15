/**
 * Issue #2668 — Reproducer test for lunar_lander-shape WASM compile traps.
 *
 * Background:
 *
 *   The lunar_lander example in NEAT-AI-Examples (7 inputs, 3 outputs,
 *   ~36–37 total neurons) reproducibly logs three producer-gate warnings
 *   during evolution:
 *
 *     [Offspring] dropping offspring that fails WASM compile
 *       (neurons=37, inputs=7, outputs=3): unreachable
 *     WASM compile failed for creature 72609101-...
 *       (neurons=36, inputs=7, outputs=3): unreachable.
 *     [Offspring] dropping offspring that fails WASM compile
 *       (neurons=36, inputs=7, outputs=3): unreachable
 *
 *   These shapes are tiny — well below the 2156-neuron #2636 reproducer —
 *   so the underlying bug is a different failure mode from the one #2636
 *   addressed. This file is the in-tree reproducer that the diagnose-and-fix
 *   work in #2666 must drive to zero rejects.
 *
 *   The test drives `Mutator.mutate` and `Offspring.breed` against a small
 *   population of lunar_lander-shaped creatures with a fixed PRNG seed,
 *   captures every producer-gate reject (both the in-Mutator revert and the
 *   in-Offspring drop), writes diagnostics for the first offending creature,
 *   and asserts the count is bounded by `BASELINE_REJECT_ALLOWANCE`.
 *
 *   The allowance is a small non-zero number today so the test passes against
 *   the existing buggy producers; #2666 will drive it to zero. Bumping the
 *   allowance is NOT how to "fix" this test — root-cause the trap and bring
 *   the count down instead.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { ensureProducerOutputCompiles } from "@wasm/ProducerCompileGuard.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { getLogger, setLogger } from "@utils/Logger.ts";
import { writeDiagnostics } from "@utils/Diagnostics.ts";
import { initWasmForTests } from "../_initWasm.ts";

// ---------------------------------------------------------------------------
// Shape constants — match the lunar_lander example.
// ---------------------------------------------------------------------------

const LUNAR_INPUTS = 7;
const LUNAR_OUTPUTS = 3;
/** Target total neuron count after the AddNeuron seed loop. */
const LUNAR_SEED_NEURONS = 30;
/** Bounded mutation/breed iterations driven against the population. */
const ITERATIONS = 200;
/** Population size — small enough to keep the test under 30 seconds. */
const POPULATION_SIZE = 4;
/** Fixed seed — change only with a deliberate baseline-recapture commit. */
const SEED = 2668;
/**
 * Maximum producer-gate rejects we tolerate. Issue #2670 drove this to
 * zero by fixing the topology-hash collision that let the WASM
 * compilation cache serve a stale template across two valid topological
 * orderings of the same UUID set (causing the `RuntimeError: unreachable`
 * inside `CompiledNetwork::new`). Do NOT raise this — a non-zero count
 * means a NEW producer defect is leaking past the gate.
 */
const BASELINE_REJECT_ALLOWANCE = 0;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface RejectEvent {
  readonly source: "mutator" | "offspring";
  readonly message: string;
}

/**
 * Hook the global logger so we can count producer-gate warn lines emitted
 * by `Mutator.repairAfterMutation` (which logs `[Mutator] reverting
 * mutation that fails WASM compile`) and `Offspring.breed` (which logs
 * `[Offspring] dropping offspring that fails WASM compile`). Returns the
 * capture and a disposer that restores the previous logger.
 */
function captureGateRejects(): {
  events: RejectEvent[];
  dispose: () => void;
} {
  const events: RejectEvent[] = [];
  const previous = getLogger();
  setLogger({
    debug() {},
    info() {},
    warn(...args: unknown[]) {
      const line = args.map((a) => String(a)).join(" ");
      if (line.includes("WASM compile")) {
        if (line.startsWith("[Mutator]")) {
          events.push({ source: "mutator", message: line });
        } else if (line.startsWith("[Offspring]")) {
          events.push({ source: "offspring", message: line });
        }
      }
    },
    error() {},
  });
  return { events, dispose: () => setLogger(previous) };
}

/**
 * Build a single lunar_lander-shaped creature: 7 inputs, 3 outputs,
 * grown to `LUNAR_SEED_NEURONS` total neurons via repeated `AddNeuron`.
 *
 * The AddNeuron operator can no-op when the draw lands on an
 * inappropriate edge, so the loop retries up to 5x the needed count.
 */
function buildLunarShape(): Creature {
  const creature = new Creature(LUNAR_INPUTS, LUNAR_OUTPUTS);
  creature.fix();
  const need = LUNAR_SEED_NEURONS - creature.neurons.length;
  let added = 0;
  for (let attempt = 0; attempt < need * 5 && added < need; attempt++) {
    const op = new AddNeuron(creature);
    if (op.mutate()) {
      added++;
    }
  }
  assertEquals(
    creature.neurons.length,
    LUNAR_SEED_NEURONS,
    `failed to seed ${LUNAR_SEED_NEURONS} neurons in bounded attempts`,
  );
  // Re-validate compile-cleanness of the seed before the loop runs.
  const baseline = ensureProducerOutputCompiles(creature);
  assert(
    baseline.ok,
    `seed creature must compile before the loop runs; trap=${baseline.trapMessage}`,
  );
  return creature;
}

/**
 * Run the bounded mutation/breed loop with a fixed PRNG seed and return
 * the captured reject events. The function is self-contained: it sets the
 * RNG, installs the warn-capturing logger, runs the loop, and restores
 * the previous global state before returning.
 *
 * Two consecutive calls with the same seed MUST return arrays of equal
 * length — that property is what makes the test deterministic.
 */
function runReproducer(seed: number): RejectEvent[] {
  const previousRng = getRandomNumberGenerator();
  setRandomNumberGenerator(createSeededRng(seed));

  // Build a small population of lunar-shaped creatures BEFORE installing the
  // capture logger — `buildLunarShape` does not emit gate-reject warns.
  const population: Creature[] = [];
  for (let i = 0; i < POPULATION_SIZE; i++) {
    population.push(buildLunarShape());
  }

  // `createNeatConfig` calls `setLogger()` to install the default console
  // logger (see NeatConfig.ts), so the capture logger MUST be installed
  // AFTER the config is built — otherwise the gate-reject warns fall back
  // to the console and the assertion below sees zero events.
  //
  // We also explicitly pass `rng: getRandomNumberGenerator()` so the
  // config does NOT replace our seeded RNG with a fresh unseeded one
  // (NeatConfig.ts line 190 calls `setRandomNumberGenerator(rng)` and
  // would otherwise wipe the seed we just installed, making the
  // mutation/breed loop non-deterministic across consecutive runs).
  const config = createNeatConfig({
    populationSize: POPULATION_SIZE,
    // High rate so every iteration exercises the gate; the test is
    // about gate fire-rate, not the production mutation rate.
    mutationRate: 1.0,
    mutationAmount: 3,
    rng: getRandomNumberGenerator(),
  });
  const mutator = new Mutator(config);

  const capture = captureGateRejects();
  try {
    const rng = getRandomNumberGenerator();

    for (let iter = 0; iter < ITERATIONS; iter++) {
      // Half mutate, half breed. Both paths go through the producer gate.
      if (rng.random() < 0.5) {
        const idx = rng.randomInt(0, population.length - 1);
        mutator.mutate([population[idx]]);
        // After mutate (which auto-reverts on gate failure) the creature
        // must still pass the probe — the gate is the contract this test
        // pins. If the post-mutate creature ever fails compile, that is a
        // gate escape and must surface immediately.
        const probe = ensureProducerOutputCompiles(population[idx]);
        assert(
          probe.ok,
          `[iter ${iter}] post-mutate creature failed WASM compile — ` +
            `gate escape: ${probe.trapMessage}`,
        );
      } else {
        const i = rng.randomInt(0, population.length - 1);
        let j = rng.randomInt(0, population.length - 1);
        if (j === i) j = (j + 1) % population.length;
        const child = Offspring.breed(population[i], population[j]);
        if (child !== undefined) {
          const probe = ensureProducerOutputCompiles(child);
          assert(
            probe.ok,
            `[iter ${iter}] post-breed offspring failed WASM compile — ` +
              `gate escape: ${probe.trapMessage}`,
          );
        }
      }
    }

    return capture.events.slice();
  } finally {
    capture.dispose();
    setRandomNumberGenerator(previousRng);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test(
  "Issue #2668: lunar_lander-shape mutation/breed loop keeps producer-gate rejects under the baseline",
  async () => {
    await initWasmForTests();
    const events = runReproducer(SEED);

    // Record the baseline so #2666 has a concrete number to drive to zero.
    // The first offending creature is dumped via writeDiagnostics so the
    // diagnosis sub-issue has an in-tree artefact.
    if (events.length > 0) {
      writeDiagnostics({
        error: new Error(
          `Issue #2668 reproducer recorded ${events.length} producer-gate ` +
            `rejects on lunar_lander shape (seed=${SEED}, iterations=${ITERATIONS}).`,
        ),
        prefix: "issue-2668-lunar-lander-shape",
        context: {
          seed: SEED,
          iterations: ITERATIONS,
          populationSize: POPULATION_SIZE,
          lunarInputs: LUNAR_INPUTS,
          lunarOutputs: LUNAR_OUTPUTS,
          lunarSeedNeurons: LUNAR_SEED_NEURONS,
          rejectCount: events.length,
          mutatorRejects: events.filter((e) => e.source === "mutator").length,
          offspringRejects: events.filter((e) => e.source === "offspring")
            .length,
          firstFiveMessages: events.slice(0, 5).map((e) => e.message),
        },
      });
    }

    assert(
      events.length <= BASELINE_REJECT_ALLOWANCE,
      `Producer-gate rejects exceeded baseline allowance: ` +
        `${events.length} > ${BASELINE_REJECT_ALLOWANCE}. ` +
        `If this rose, the producer is emitting MORE bad topologies, ` +
        `not fewer — investigate #2666 rather than raising the allowance. ` +
        `First message: ${events[0]?.message ?? "(none)"}`,
    );
  },
);

Deno.test(
  "Issue #2668: reproducer is deterministic across three consecutive runs at the same seed",
  async () => {
    await initWasmForTests();
    const run1 = runReproducer(SEED);
    const run2 = runReproducer(SEED);
    const run3 = runReproducer(SEED);

    assertEquals(
      run1.length,
      run2.length,
      `run1 (${run1.length}) and run2 (${run2.length}) must match — ` +
        `the seeded reproducer is not deterministic`,
    );
    assertEquals(
      run2.length,
      run3.length,
      `run2 (${run2.length}) and run3 (${run3.length}) must match — ` +
        `the seeded reproducer is not deterministic`,
    );

    // Stronger check: the sequence of reject sources must also match,
    // not just the count. If the count matches but the order differs, the
    // PRNG is reused but a downstream call is non-deterministic.
    const sources1 = run1.map((e) => e.source).join(",");
    const sources2 = run2.map((e) => e.source).join(",");
    const sources3 = run3.map((e) => e.source).join(",");
    assertEquals(sources1, sources2);
    assertEquals(sources2, sources3);
  },
);
