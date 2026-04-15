/**
 * Issue #2308 — Benchmark for makeUUID() optimisation.
 *
 * Measures the cost of computing creature UUIDs at production scale
 * (~1,500 neurons, ~20,000 synapses). The baseline uses the full
 * `exportJSON()` path; the optimised version builds the hash string
 * directly from creature arrays without allocating intermediate objects.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi \
 *     bench/MakeUuidOptimisation.ts
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  createSeededRng,
  generateProductionCreature,
} from "../test/propagate/large/ProductionScaleCreature.ts";

// ──────────────────────────────────────────────────────────────────
// Shared production-scale creature
// ──────────────────────────────────────────────────────────────────

const INPUT_COUNT = 648;
const OUTPUT_COUNT = 2;
const RNG_SEED = 2308;

let _creatureExport: CreatureExport | null = null;

function getCreatureExport(): CreatureExport {
  if (!_creatureExport) {
    const rng = createSeededRng(RNG_SEED);
    _creatureExport = generateProductionCreature(
      INPUT_COUNT,
      OUTPUT_COUNT,
      rng,
      { scale: "grq-cluster" },
    );
  }
  return _creatureExport;
}

// ──────────────────────────────────────────────────────────────────
// Benchmarks
// ──────────────────────────────────────────────────────────────────

Deno.bench(
  "makeUUID — production-scale creature (~1500N/~20000S)",
  { group: "makeUUID" },
  (b) => {
    const creature = Creature.fromJSON(getCreatureExport());

    b.start();
    // Clear cached UUID to force recomputation
    creature.uuid = undefined;
    CreatureUtil.makeUUID(creature);
    b.end();
  },
);

Deno.bench(
  "shallowClone — production-scale creature",
  { group: "clone" },
  (b) => {
    const creature = Creature.fromJSON(getCreatureExport());

    b.start();
    creature.shallowClone();
    b.end();
  },
);

Deno.bench(
  "fromJSON(exportJSON()) — production-scale creature",
  { group: "clone" },
  (b) => {
    const creature = Creature.fromJSON(getCreatureExport());

    b.start();
    Creature.fromJSON(creature.exportJSON());
    b.end();
  },
);
