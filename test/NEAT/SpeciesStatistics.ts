/**
 * Tests for per-species adjusted-fitness telemetry (Issue #2452).
 *
 * Verifies the foundational instrumentation step for fitness sharing:
 *  - Species exposes size, bestRawFitness, meanRawFitness, adjustedFitness.
 *  - Genus updates these statistics once per generation.
 *  - speciesSummary is emitted on the species_adjusted training event.
 *  - Adjusted fitness equals raw / speciesSize, with size 1 ⇒ raw.
 *  - Statistics persist across an evolution generation round-trip.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { Genus } from "@neat/Genus.ts";
import { Species } from "@neat/Species.ts";
import { Mutation } from "@neat/Mutation.ts";
import type {
  SpeciesAdjustedEvent,
  TrainingEvent,
} from "@config/TrainingEvent.ts";

/**
 * Build a small, valid creature using a single hidden neuron with the
 * given squash. Squash distribution drives the species key, so varying
 * the squash places creatures in different species.
 */
function makeCreatureJSON(squash: string): CreatureExport {
  return {
    neurons: [
      { uuid: "hidden-0", bias: 0.1, type: "hidden", squash },
      { uuid: "output-0", bias: 0.4, type: "output", squash: "IF" },
    ],
    synapses: [
      { weight: -0.05, fromUUID: "input-0", toUUID: "hidden-0" },
      { weight: -0.05, fromUUID: "input-1", toUUID: "hidden-0" },
      { weight: -0.03, fromUUID: "hidden-0", toUUID: "output-0" },
    ],
    input: 2,
    output: 1,
  };
}

function fixtureCreature(score: number, squash: string = "TANH"): Creature {
  const c = Creature.fromJSON(makeCreatureJSON(squash));
  // Genus tracks creatures by their `uuid`; assign a fresh one so two
  // architecturally identical creatures still occupy two genus slots.
  c.uuid = crypto.randomUUID();
  c.score = score;
  return c;
}

Deno.test(
  "Species.computeStatistics - adjusted fitness equals raw / speciesSize",
  () => {
    const species = new Species("test-species");
    species.addCreature(fixtureCreature(8));
    species.addCreature(fixtureCreature(4));
    species.addCreature(fixtureCreature(6));
    species.addCreature(fixtureCreature(2));

    species.computeStatistics();

    assertEquals(species.size, 4);
    assertEquals(species.bestRawFitness, 8);
    assertAlmostEquals(species.meanRawFitness, 5);
    // Adjusted = best raw / size = 8 / 4 = 2.
    assertAlmostEquals(species.adjustedFitness, 8 / 4);
    assertAlmostEquals(
      species.adjustedFitness,
      species.bestRawFitness / species.size,
    );
  },
);

Deno.test(
  "Species.computeStatistics - size 1 species: adjusted equals raw",
  () => {
    const species = new Species("solo-species");
    species.addCreature(fixtureCreature(0.42));

    species.computeStatistics();

    assertEquals(species.size, 1);
    assertAlmostEquals(species.bestRawFitness, 0.42);
    assertAlmostEquals(species.meanRawFitness, 0.42);
    // Size 1 ⇒ adjusted == raw. Acceptance criterion from Issue #2452.
    assertAlmostEquals(species.adjustedFitness, 0.42);
    assertAlmostEquals(species.adjustedFitness, species.bestRawFitness);
  },
);

Deno.test(
  "Species.computeStatistics - non-finite scores are skipped",
  () => {
    const species = new Species("filter-species");
    species.addCreature(fixtureCreature(10));
    const broken = fixtureCreature(0);
    broken.score = -Infinity;
    species.addCreature(broken);
    species.addCreature(fixtureCreature(2));

    species.computeStatistics();

    // Size still reflects member count; stats ignore the broken score.
    assertEquals(species.size, 3);
    assertEquals(species.bestRawFitness, 10);
    assertAlmostEquals(species.meanRawFitness, 6); // (10 + 2) / 2 finite scores
  },
);

Deno.test(
  "Genus.updateSpeciesStatistics - builds a multi-species summary",
  () => {
    const genus = new Genus();

    // Multi-species population built from fixture creatures whose squash
    // distribution differs, placing them in distinct species buckets.
    genus.addCreature(fixtureCreature(10, "TANH"));
    genus.addCreature(fixtureCreature(6, "TANH"));
    genus.addCreature(fixtureCreature(4, "LOGISTIC"));

    genus.updateSpeciesStatistics();
    const summary = genus.speciesSummary();

    // Two distinct species expected: one with two TANH members, one
    // with the lone LOGISTIC member.
    assertEquals(summary.length, 2, "Two species should be present");

    const sizeTwo = summary.find((s) => s.size === 2);
    assert(sizeTwo, "Expected a size-2 species in the summary");
    assertEquals(sizeTwo.bestRawFitness, 10);
    assertAlmostEquals(sizeTwo.meanRawFitness, 8);
    assertAlmostEquals(sizeTwo.adjustedFitness, 10 / 2);

    const sizeOne = summary.find((s) => s.size === 1);
    assert(sizeOne, "Expected a size-1 species in the summary");
    assertAlmostEquals(sizeOne.bestRawFitness, 4);
    assertAlmostEquals(sizeOne.adjustedFitness, 4);
  },
);

Deno.test(
  "Genus.speciesSummary - sorted deterministically by speciesKey",
  () => {
    const genus = new Genus();
    genus.addCreature(fixtureCreature(1, "TANH"));
    genus.addCreature(fixtureCreature(2, "LOGISTIC"));
    genus.addCreature(fixtureCreature(3, "RELU"));
    genus.updateSpeciesStatistics();

    const summary = genus.speciesSummary();
    const keys = summary.map((s) => s.speciesKey);
    const sorted = [...keys].sort();
    assertEquals(
      keys,
      sorted,
      "Summary entries should be sorted by speciesKey",
    );
  },
);

Deno.test(
  "Species statistics persist across an evolution generation round-trip",
  async () => {
    const events: TrainingEvent[] = [];

    const trainingSet = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
    ];

    const creature = new Creature(2, 1);

    await creature.evolveDataSet(trainingSet, {
      mutation: Mutation.FFW,
      iterations: 3,
      targetError: 0.001,
      populationSize: 10,
      threads: 1,
      onTrainingEvent: (event) => {
        events.push(event);
      },
    });

    const speciesEvents = events.filter(
      (e) => e.kind === "species_adjusted",
    ) as SpeciesAdjustedEvent[];

    assert(
      speciesEvents.length > 0,
      "At least one species_adjusted event should be emitted",
    );

    // Every speciation event must carry a non-empty summary, and each
    // entry's adjustedFitness must equal bestRawFitness / size.
    for (const ev of speciesEvents) {
      assert(ev.speciesSummary, "speciesSummary missing on species_adjusted");
      assertEquals(
        ev.speciesSummary.length,
        ev.speciesCount,
        "Summary length must match speciesCount",
      );
      for (const entry of ev.speciesSummary) {
        assert(entry.size >= 1, "Species size must be >= 1");
        // Statistics persisted: adjusted = best / size.
        assertAlmostEquals(
          entry.adjustedFitness,
          entry.bestRawFitness / entry.size,
          1e-9,
          `Adjusted fitness mismatch for species ${entry.speciesKey}`,
        );
        if (entry.size === 1) {
          assertAlmostEquals(
            entry.adjustedFitness,
            entry.bestRawFitness,
            1e-9,
            "Size-1 species: adjusted fitness should equal raw",
          );
        }
      }
    }
  },
);
