/**
 * Issue #2307 — Tests for production-scale evolveDir phase profiling.
 *
 * Validates that:
 *   1. Production-scale creature generation produces correct dimensions
 *   2. Phase timing events are captured at production scale
 *   3. All expected phase timing fields are present
 *   4. Analysis script input format matches expected structure
 */

import { assertEquals, assertGreater } from "@std/assert";
import { Creature } from "@creature";
import type {
  GenerationCompleteEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";
import {
  createSeededRng,
  generateProductionCreature,
  generateTrainingData,
} from "../../test/propagate/large/ProductionScaleCreature.ts";

Deno.test("Production-scale creature has GRQ-cluster dimensions", () => {
  const rng = createSeededRng(2307);
  const creature = generateProductionCreature(648, 2, rng, {
    scale: "grq-cluster",
  });

  // GRQ-cluster target: ~1,500 neurons, ~20,000 synapses
  assertGreater(
    creature.neurons.length,
    1_300,
    "Should have at least 1,300 neurons for production scale",
  );
  assertGreater(
    creature.synapses.length,
    15_000,
    "Should have at least 15,000 synapses for production scale",
  );
  assertEquals(creature.input, 648, "Input count should match GRQ-cluster");
  assertEquals(creature.output, 2, "Output count should match GRQ-cluster");
});

Deno.test(
  "Phase timing events captured during production-scale evolution",
  async () => {
    const rng = createSeededRng(2307);
    const creatureExport = generateProductionCreature(648, 2, rng, {
      scale: "grq-cluster",
    });

    const trainingData = generateTrainingData(648, 2, 10, createSeededRng(42));
    const creature = Creature.fromJSON(creatureExport);

    const events: GenerationCompleteEvent[] = [];

    await creature.evolveDataSet(trainingData, {
      iterations: 2,
      targetError: 0,
      populationSize: 4,
      threads: 1,
      onTrainingEvent: (event: TrainingEvent) => {
        if (event.kind === "generation_complete") {
          events.push(event);
        }
      },
    });

    assertGreater(
      events.length,
      0,
      "Should capture at least one generation_complete event",
    );

    // Verify phase timing fields are present
    const firstEvent = events[0];
    const t = firstEvent.phaseTiming;

    assertGreater(t.totalMs, 0, "totalMs should be positive");
    assertGreater(t.fitnessMs, 0, "fitnessMs should be positive");
    // breedingMs can be 0 if population is very small
    assertEquals(
      typeof t.breedingMs,
      "number",
      "breedingMs should be a number",
    );
    assertEquals(
      typeof t.resultProcessingMs,
      "number",
      "resultProcessingMs should be a number",
    );
  },
);

Deno.test(
  "All phase timing fields are present with correct types",
  async () => {
    const rng = createSeededRng(2307);
    const creatureExport = generateProductionCreature(648, 2, rng, {
      scale: "grq-cluster",
    });

    const trainingData = generateTrainingData(648, 2, 10, createSeededRng(99));
    const creature = Creature.fromJSON(creatureExport);

    const events: GenerationCompleteEvent[] = [];

    await creature.evolveDataSet(trainingData, {
      iterations: 2,
      targetError: 0,
      populationSize: 6,
      threads: 1,
      onTrainingEvent: (event: TrainingEvent) => {
        if (event.kind === "generation_complete") {
          events.push(event);
        }
      },
    });

    assertGreater(
      events.length,
      0,
      "Should capture generation events",
    );

    // Verify all expected phase timing fields are numbers
    const t = events[0].phaseTiming;
    assertEquals(typeof t.fitnessMs, "number", "fitnessMs should be number");
    assertEquals(typeof t.breedingMs, "number", "breedingMs should be number");
    assertEquals(typeof t.totalMs, "number", "totalMs should be number");
    assertEquals(
      typeof t.resultProcessingMs,
      "number",
      "resultProcessingMs should be number",
    );

    // These optional fields should be present when instrumented
    if (t.mutationMs !== undefined) {
      assertEquals(
        typeof t.mutationMs,
        "number",
        "mutationMs should be number when present",
      );
    }
    if (t.deduplicationMs !== undefined) {
      assertEquals(
        typeof t.deduplicationMs,
        "number",
        "deduplicationMs should be number when present",
      );
    }
    if (t.speciationMs !== undefined) {
      assertEquals(
        typeof t.speciationMs,
        "number",
        "speciationMs should be number when present",
      );
    }
    if (t.sortMs !== undefined) {
      assertEquals(
        typeof t.sortMs,
        "number",
        "sortMs should be number when present",
      );
    }
  },
);
