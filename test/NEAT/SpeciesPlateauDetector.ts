/**
 * Tests for per-species stagnation detection and breeding-budget
 * reclamation (Issue #2454).
 *
 * Verifies:
 *  - A species held flat for `haltWindow` generations has its breeding
 *    share halved on the next quota allocation.
 *  - The same species held flat for `extinctionWindow` generations is
 *    dropped from the breeding pool entirely; the remaining species
 *    absorb its share so the global breeding budget is preserved.
 *  - Disabling the flag is a no-op (regression: previous behaviour).
 */

import { assert, assertEquals } from "@std/assert";
import {
  applyStagnationToQuotas,
  SpeciesPlateauDetector,
} from "@neat/SpeciesPlateauDetector.ts";
import { DEFAULT_SPECIES_STAGNATION_CONFIG } from "@config/SpeciesStagnationConfig.ts";

const HALT_WINDOW = DEFAULT_SPECIES_STAGNATION_CONFIG.haltWindow;
const EXTINCTION_WINDOW = DEFAULT_SPECIES_STAGNATION_CONFIG.extinctionWindow;

/** Drive a species' best-fitness history by repeating a fixed value. */
function recordFlatGenerations(
  detector: SpeciesPlateauDetector,
  speciesKey: string,
  fitness: number,
  generations: number,
): void {
  for (let i = 0; i < generations; i++) {
    detector.recordSpecies(speciesKey, fitness);
  }
}

/** Sum the values of a quota map. */
function totalQuota(quotas: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const v of quotas.values()) sum += v;
  return sum;
}

Deno.test(
  "SpeciesPlateauDetector - active when fitness improves each generation",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    for (let i = 0; i < EXTINCTION_WINDOW + 5; i++) {
      detector.recordSpecies("species-progressing", 0.1 + i * 0.01);
    }

    assertEquals(detector.getStagnantGenerations("species-progressing"), 0);
    assertEquals(detector.getStatus("species-progressing"), "active");
  },
);

Deno.test(
  "SpeciesPlateauDetector - status flips to halted at haltWindow",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    detector.recordSpecies("flat", 1.0);
    // After the initial recording, run haltWindow more flat generations.
    recordFlatGenerations(detector, "flat", 1.0, HALT_WINDOW - 1);
    assertEquals(
      detector.getStatus("flat"),
      "active",
      "Just below haltWindow should still be active",
    );
    detector.recordSpecies("flat", 1.0);
    assertEquals(
      detector.getStagnantGenerations("flat"),
      HALT_WINDOW,
      "Stagnant counter should equal haltWindow exactly",
    );
    assertEquals(detector.getStatus("flat"), "halted");
  },
);

Deno.test(
  "SpeciesPlateauDetector - status flips to extinct at extinctionWindow",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    detector.recordSpecies("flat", 2.0);
    recordFlatGenerations(detector, "flat", 2.0, EXTINCTION_WINDOW);
    assertEquals(
      detector.getStagnantGenerations("flat"),
      EXTINCTION_WINDOW,
    );
    assertEquals(detector.getStatus("flat"), "extinct");
  },
);

Deno.test(
  "SpeciesPlateauDetector - improvement resets the stagnant counter",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    detector.recordSpecies("late-bloomer", 1.0);
    recordFlatGenerations(detector, "late-bloomer", 1.0, HALT_WINDOW);
    assertEquals(detector.getStatus("late-bloomer"), "halted");

    detector.recordSpecies("late-bloomer", 1.5); // Improvement
    assertEquals(detector.getStagnantGenerations("late-bloomer"), 0);
    assertEquals(detector.getStatus("late-bloomer"), "active");
  },
);

Deno.test(
  "applyStagnationToQuotas - halts halve a species' breeding share",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    // Two-species fixture. Species "stagnant" is held flat for the
    // halt window; species "progressing" improves every generation.
    for (let i = 0; i < HALT_WINDOW + 1; i++) {
      detector.recordSpecies("stagnant", 1.0);
      detector.recordSpecies("progressing", 1.0 + i * 0.05);
    }

    assertEquals(detector.getStatus("stagnant"), "halted");
    assertEquals(detector.getStatus("progressing"), "active");

    // The pre-stagnation quota — derived from any allocator. We use a
    // fixed 50/50 split to make the halving signal unambiguous.
    const quotas = new Map<string, number>([
      ["stagnant", 20],
      ["progressing", 20],
    ]);

    const adjusted = applyStagnationToQuotas(quotas, detector);

    // Stagnant species lost half: 20 → 10. The 10 reclaimed slots are
    // redistributed to the only active recipient (progressing), which
    // grows from 20 → 30. Total budget preserved.
    assertEquals(adjusted.get("stagnant"), 10);
    assertEquals(adjusted.get("progressing"), 30);
    assertEquals(totalQuota(adjusted), totalQuota(quotas));
  },
);

Deno.test(
  "applyStagnationToQuotas - extinction zeroes the species and surviving species absorb its share",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    for (let i = 0; i < EXTINCTION_WINDOW + 1; i++) {
      detector.recordSpecies("doomed", 1.0);
      detector.recordSpecies("survivor", 1.0 + i * 0.05);
    }

    assertEquals(detector.getStatus("doomed"), "extinct");
    assertEquals(detector.getStatus("survivor"), "active");

    const quotas = new Map<string, number>([
      ["doomed", 12],
      ["survivor", 28],
    ]);

    const adjusted = applyStagnationToQuotas(quotas, detector);

    assertEquals(
      adjusted.get("doomed"),
      0,
      "Extinct species must receive zero breeding slots",
    );
    assertEquals(
      adjusted.get("survivor"),
      40,
      "Survivor should absorb the full 12 reclaimed slots",
    );
    assertEquals(
      totalQuota(adjusted),
      totalQuota(quotas),
      "Total breeding budget must be preserved",
    );
  },
);

Deno.test(
  "applyStagnationToQuotas - extinct slots split proportionally across active species",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    for (let i = 0; i < EXTINCTION_WINDOW + 1; i++) {
      detector.recordSpecies("doomed", 0.2);
      detector.recordSpecies("active-large", 1.0 + i * 0.1);
      detector.recordSpecies("active-small", 0.5 + i * 0.05);
    }

    const quotas = new Map<string, number>([
      ["doomed", 8],
      ["active-large", 18],
      ["active-small", 6],
    ]);

    const adjusted = applyStagnationToQuotas(quotas, detector);

    assertEquals(adjusted.get("doomed"), 0);
    // Reclaimed 8 slots are split 18:6 between the two active species
    // (proportional to their pre-stagnation quotas). The proportional
    // allocation gives ~6 to active-large and ~2 to active-small.
    assertEquals(
      totalQuota(adjusted),
      totalQuota(quotas),
      "Total breeding budget must be preserved across redistribution",
    );
    assert(
      (adjusted.get("active-large") ?? 0) > 18,
      "Active-large should grow after absorbing reclaimed slots",
    );
    assert(
      (adjusted.get("active-small") ?? 0) > 6,
      "Active-small should grow after absorbing reclaimed slots",
    );
  },
);

Deno.test(
  "applyStagnationToQuotas - disabled flag is a no-op (regression test)",
  () => {
    const detector = new SpeciesPlateauDetector({
      enabled: false,
      haltWindow: HALT_WINDOW,
      extinctionWindow: EXTINCTION_WINDOW,
    });

    // Even when fed enough flat generations to trip both windows,
    // the detector reports every species as active when disabled.
    for (let i = 0; i < EXTINCTION_WINDOW + 5; i++) {
      detector.recordSpecies("would-be-extinct", 0.1);
    }
    assertEquals(detector.getStatus("would-be-extinct"), "active");

    const quotas = new Map<string, number>([
      ["would-be-extinct", 15],
      ["other", 25],
    ]);

    const adjusted = applyStagnationToQuotas(quotas, detector);

    // The quota map round-trips unchanged when nothing is reclaimed.
    assertEquals(adjusted.get("would-be-extinct"), 15);
    assertEquals(adjusted.get("other"), 25);
    assertEquals(totalQuota(adjusted), totalQuota(quotas));
  },
);

Deno.test(
  "SpeciesPlateauDetector - pruneAbsent drops history for missing species",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    detector.recordSpecies("alpha", 1.0);
    detector.recordSpecies("beta", 1.0);
    detector.recordSpecies("gamma", 1.0);

    // Only alpha and beta remain in the genus; gamma should be pruned.
    detector.pruneAbsent(["alpha", "beta"]);

    // Following stagnation generations should accumulate only for
    // alpha/beta — gamma is treated as a fresh species when reseen.
    recordFlatGenerations(detector, "alpha", 1.0, HALT_WINDOW + 1);
    detector.recordSpecies("gamma", 1.0);

    assertEquals(detector.getStatus("alpha"), "halted");
    assertEquals(
      detector.getStagnantGenerations("gamma"),
      0,
      "gamma should restart its history after pruning",
    );
  },
);

Deno.test(
  "applyStagnationToQuotas - non-finite fitness does not advance stagnation",
  () => {
    const detector = new SpeciesPlateauDetector(
      DEFAULT_SPECIES_STAGNATION_CONFIG,
    );

    detector.recordSpecies("species", 1.0);
    // Non-finite samples are skipped — the stagnation counter stays put.
    for (let i = 0; i < HALT_WINDOW + 5; i++) {
      detector.recordSpecies("species", -Infinity);
    }
    assertEquals(detector.getStatus("species"), "active");
  },
);
