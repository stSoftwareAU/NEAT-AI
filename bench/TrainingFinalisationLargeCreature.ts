/**
 * Benchmark: TypeScript-side training finalisation on a large creature
 * (Issue #4146).
 *
 * Issue #4146 reports training tasks overrunning their per-task deadline, then
 * returning no result and being quarantined. This bench times the TypeScript
 * stages that run after the native trainer returns, on a creature the size of
 * the one in the issue (9,684 neurons, 63,317 synapses): 50 inputs, 5 outputs,
 * 9,629 hidden neurons, exactly 63,317 synapses, forward-only. It shows
 * whether finalisation on its own can hold a worker.
 *
 * Methodology:
 *   - The creature is built deterministically once at module load by
 *     `buildLargeCreatureJSON` (`test/fixtures/LargeCreatureFixture.ts`, whose
 *     size is pinned by a test) from a fixed-seed LCG. The JSON is held in
 *     memory only; nothing is written to disk.
 *   - The built JSON is loaded with `Creature.fromJSON`, and that creature's
 *     `exportJSON()` is the canonical export, so the synapse order is the one
 *     the library produces.
 *   - Each case runs against that same canonical export or creature. `loadFrom`
 *     loads into one target created once at module load, with validation off
 *     (the default on the `fromJSON` / `loadFrom` hot path).
 *   - `compactUnused` takes a trace produced once at module load. It only reads
 *     its argument (it works on fresh copies built from it), so one trace serves
 *     every iteration.
 *   - Timings are reported by `Deno.bench` only. There are no timing assertions
 *     and no other timing APIs.
 *   - The trace comes from a creature that has never been activated, so it
 *     carries no activation counts; `compactUnused` here times the copy, trace
 *     and identity setup rather than a full removal pass over a trained
 *     creature. The native engine's own deadline behaviour is not covered here.
 *
 * Run:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/TrainingFinalisationLargeCreature.ts
 */

import { Creature } from "@creature";
import { compactUnused } from "@compact/CompactUnused.ts";
import {
  buildLargeCreatureJSON,
  ISSUE_4146_SHAPE,
} from "../test/fixtures/LargeCreatureFixture.ts";

const { inputs: IN, outputs: OUT } = ISSUE_4146_SHAPE;

// Built once at module load; the bench cases only time the stages.
const built = buildLargeCreatureJSON(ISSUE_4146_SHAPE);
const creature = Creature.fromJSON(built);
const canonical = creature.exportJSON();
const target = new Creature(IN, OUT);
const trace = creature.traceJSON();

const GROUP =
  "training finalisation, issue-sized creature (9,629 hidden, 63,317 synapses)";

Deno.bench({
  group: GROUP,
  name: "Creature.fromJSON",
  fn: () => {
    Creature.fromJSON(canonical);
  },
});

Deno.bench({
  group: GROUP,
  name: "creature.loadFrom(exportJSON)",
  fn: () => {
    target.loadFrom(canonical, false);
  },
});

Deno.bench({
  group: GROUP,
  name: "creature.exportJSON()",
  fn: () => {
    creature.exportJSON();
  },
});

Deno.bench({
  group: GROUP,
  name: "creature.traceJSON()",
  fn: () => {
    creature.traceJSON();
  },
});

Deno.bench({
  group: GROUP,
  name: "compactUnused(trace, 0.1)",
  fn: () => {
    compactUnused(trace, 0.1);
  },
});
