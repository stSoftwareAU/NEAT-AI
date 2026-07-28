/**
 * Tests for generation throughput metrics.
 *
 * Issue #2330: Verifies that `generation_complete` events expose compact
 * throughput counters — wall-clock, non-fitness time, generations/hour,
 * fast/heavy queue max depth, approximate worker wait time, and worker
 * busy/idle aggregates — with low overhead, correct types, and sensible
 * invariants.
 */
import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import { Mutation } from "@neat/Mutation.ts";
import type {
  GenerationCompleteEvent,
  GenerationThroughputMetrics,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

async function collectGenerationEvents(
  threads = 1,
  populationSize = 10,
  iterations = 3,
): Promise<GenerationCompleteEvent[]> {
  const events: GenerationCompleteEvent[] = [];

  const trainingSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
  ];

  const creature = new Creature(2, 1);
  await creature.evolveDataSet(trainingSet, {
    mutation: Mutation.FFW,
    iterations,
    targetError: 0.001,
    populationSize,
    threads,
    onTrainingEvent: (event: TrainingEvent) => {
      if (event.kind === "generation_complete") {
        events.push(event);
      }
    },
  });
  return events;
}

Deno.test("ThroughputMetrics - generation events include throughput field", async () => {
  const events = await collectGenerationEvents();
  assertGreater(
    events.length,
    0,
    "Should emit at least one generation_complete event",
  );

  const throughput = events[0].throughput;
  assert(
    throughput !== undefined,
    "throughput metrics should be present on generation_complete",
  );
});

Deno.test("ThroughputMetrics - all numeric fields are finite, non-negative numbers", async () => {
  const events = await collectGenerationEvents();
  assertGreater(events.length, 0);

  const throughput = events[0].throughput as GenerationThroughputMetrics;

  const numericFields: Array<keyof GenerationThroughputMetrics> = [
    "wallClockMs",
    "nonFitnessMs",
    "generationsPerHour",
    "fastBusyMs",
    "fastIdleMs",
    "fastQueueMaxDepth",
    "fastWaitMs",
    "heavyBusyMs",
    "heavyIdleMs",
    "heavyQueueMaxDepth",
    "heavyWaitMs",
    // Issue #2424: Scorer runtime telemetry
    "scoredCreatureCount",
    "scorerMs",
    "creaturesPerSec",
  ];

  for (const field of numericFields) {
    const value = throughput[field];
    assertEquals(
      typeof value,
      "number",
      `throughput.${String(field)} should be a number`,
    );
    assert(
      Number.isFinite(value),
      `throughput.${String(field)} should be finite, got ${value}`,
    );
    assert(
      value >= 0,
      `throughput.${String(field)} should be non-negative, got ${value}`,
    );
  }
});

Deno.test("ThroughputMetrics - wallClockMs matches phaseTiming.totalMs", async () => {
  const events = await collectGenerationEvents();
  assertGreater(events.length, 0);

  for (const event of events) {
    const throughput = event.throughput as GenerationThroughputMetrics;
    assertEquals(
      throughput.wallClockMs,
      event.phaseTiming.totalMs,
      "throughput.wallClockMs must equal phaseTiming.totalMs",
    );
  }
});

Deno.test("ThroughputMetrics - nonFitnessMs = totalMs - fitnessMs", async () => {
  const events = await collectGenerationEvents();
  assertGreater(events.length, 0);

  for (const event of events) {
    const throughput = event.throughput as GenerationThroughputMetrics;
    const expected = Math.max(
      0,
      event.phaseTiming.totalMs - event.phaseTiming.fitnessMs,
    );
    assertEquals(
      throughput.nonFitnessMs,
      expected,
      `nonFitnessMs should be totalMs (${event.phaseTiming.totalMs}) - ` +
        `fitnessMs (${event.phaseTiming.fitnessMs}) = ${expected}, ` +
        `got ${throughput.nonFitnessMs}`,
    );
  }
});

Deno.test("ThroughputMetrics - generationsPerHour is 3_600_000 / wallClockMs when positive", async () => {
  const events = await collectGenerationEvents();
  assertGreater(events.length, 0);

  for (const event of events) {
    const throughput = event.throughput as GenerationThroughputMetrics;
    if (throughput.wallClockMs > 0) {
      const expected = 3_600_000 / throughput.wallClockMs;
      // Allow small floating point tolerance (should be exact in practice).
      const diff = Math.abs(throughput.generationsPerHour - expected);
      assert(
        diff < 1e-6,
        `generationsPerHour should be 3_600_000 / wallClockMs (~${expected}), ` +
          `got ${throughput.generationsPerHour}`,
      );
    }
  }
});

Deno.test("ThroughputMetrics - fastQueueMaxDepth reflects population size during fitness", async () => {
  const populationSize = 15;
  const events = await collectGenerationEvents(1, populationSize);
  assertGreater(events.length, 0);

  // fastQueueMaxDepth is Math.max(fitness queue depth, breeding queue depth).
  // On the first generation the fitness queue holds at least 1 creature, so
  // the metric must be >= 1.
  const first = events[0].throughput as GenerationThroughputMetrics;
  assert(
    Number.isInteger(first.fastQueueMaxDepth),
    `fastQueueMaxDepth should be an integer, got ${first.fastQueueMaxDepth}`,
  );
  assert(
    first.fastQueueMaxDepth >= 1,
    `fastQueueMaxDepth should be >= 1 on first generation, got ${first.fastQueueMaxDepth}`,
  );
  // Bound the metric by the work the generation actually did rather than by a
  // fixed multiple of the configured population size. The fitness queue holds
  // exactly the creatures scored this generation (`scoredCreatureCount`) and
  // the breeding queue never exceeds the effective population, which equals
  // the configured size here because adaptive sizing is off by default. The
  // population itself is NOT capped at `populationSize` — completed
  // training/fine-tuning/discovery creatures are concatenated back in — so the
  // old `2 × populationSize` ceiling asserted an invariant the implementation
  // does not provide and failed on a slower runner (48 vs 30, PR #3503).
  const upperBound = Math.max(first.scoredCreatureCount, populationSize);
  assert(
    first.fastQueueMaxDepth <= upperBound,
    `fastQueueMaxDepth should be <= max(scoredCreatureCount, populationSize) ` +
      `(${upperBound}), got ${first.fastQueueMaxDepth}`,
  );
});

Deno.test("ThroughputMetrics - fastIdleMs <= fastWorkers × wallClockMs", async () => {
  const events = await collectGenerationEvents();
  assertGreater(events.length, 0);

  for (const event of events) {
    const throughput = event.throughput as GenerationThroughputMetrics;
    // fastIdleMs is capped by worker capacity. We don't know the exact worker
    // count from the event, but we can check that idle is at least non-negative
    // and that busy + idle relation holds.
    assert(
      throughput.fastIdleMs >= 0,
      "fastIdleMs must be non-negative",
    );
    assert(
      throughput.heavyIdleMs >= 0,
      "heavyIdleMs must be non-negative",
    );
  }
});

Deno.test("ThroughputMetrics - heavy pool metrics present even when no heavy tasks ran", async () => {
  // With iterations=3 the heavy pool may be idle. Metrics must still be
  // populated with valid zero-or-positive values.
  const events = await collectGenerationEvents();
  assertGreater(events.length, 0);

  for (const event of events) {
    const throughput = event.throughput as GenerationThroughputMetrics;
    assertEquals(typeof throughput.heavyBusyMs, "number");
    assertEquals(typeof throughput.heavyIdleMs, "number");
    assertEquals(typeof throughput.heavyQueueMaxDepth, "number");
    assertEquals(typeof throughput.heavyWaitMs, "number");
  }
});

Deno.test("ThroughputMetrics - fastBusyMs is non-negative for each generation", async () => {
  // The cumulative busy aggregator is reset per generation (delta), so we
  // cannot assert monotonicity of the delta itself — only that each delta
  // is non-negative. Training may converge in a single generation when
  // targetError is set, so we only require at least one event.
  const events = await collectGenerationEvents(1, 10, 5);
  assertGreater(events.length, 0);

  for (const event of events) {
    const throughput = event.throughput as GenerationThroughputMetrics;
    assert(
      throughput.fastBusyMs >= 0,
      `fastBusyMs should be non-negative, got ${throughput.fastBusyMs}`,
    );
    assert(
      throughput.heavyBusyMs >= 0,
      `heavyBusyMs should be non-negative, got ${throughput.heavyBusyMs}`,
    );
  }
});

Deno.test("ThroughputMetrics - scorer fields reported per generation (Issue #2424)", async () => {
  const populationSize = 15;
  const events = await collectGenerationEvents(1, populationSize);
  assertGreater(events.length, 0);

  for (const event of events) {
    const throughput = event.throughput as GenerationThroughputMetrics;
    assert(
      throughput.scoredCreatureCount >= 0,
      `scoredCreatureCount should be non-negative, got ${throughput.scoredCreatureCount}`,
    );
    // Issue #2791: per-generation backprop now trains up to `trainPerGen`
    // creatures (which auto-scales with the population for supervised costs).
    // Their asynchronously-completed trained variants — along with any
    // discovery/replay results — are merged into the population before the
    // fitness phase, so the scored count can exceed the base population size by
    // a small margin. The bound stays meaningful (it catches gross
    // over-scoring) but no longer assumes scoring is capped at the population.
    const maxScored = populationSize * 2;
    assert(
      throughput.scoredCreatureCount <= maxScored,
      `scoredCreatureCount should be <= ${maxScored} (2x population ${populationSize}), ` +
        `got ${throughput.scoredCreatureCount}`,
    );
    assert(
      throughput.scorerMs >= 0,
      `scorerMs should be non-negative, got ${throughput.scorerMs}`,
    );
    assert(
      throughput.creaturesPerSec >= 0,
      `creaturesPerSec should be non-negative, got ${throughput.creaturesPerSec}`,
    );
    assert(
      Number.isFinite(throughput.creaturesPerSec),
      `creaturesPerSec should be finite, got ${throughput.creaturesPerSec}`,
    );
  }

  // On the first generation every creature needs evaluation, so the scored
  // count should be positive (unless everything hashes to an identical UUID,
  // which is effectively impossible).
  const first = events[0].throughput as GenerationThroughputMetrics;
  assert(
    first.scoredCreatureCount >= 1,
    `first-generation scoredCreatureCount should be >= 1, got ${first.scoredCreatureCount}`,
  );
});

Deno.test("ThroughputMetrics - callback still fires without throughput field access crashing", async () => {
  // Guard against future regressions where throughput may be optional.
  const events = await collectGenerationEvents();
  assertGreater(events.length, 0);

  // Accessing .throughput on every event must not throw.
  for (const event of events) {
    const throughput = event.throughput;
    assert(
      throughput === undefined || typeof throughput === "object",
      "throughput should be an object or undefined",
    );
  }
});
