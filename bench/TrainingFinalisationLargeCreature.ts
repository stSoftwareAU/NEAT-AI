/**
 * Benchmark: TypeScript-side training finalisation on a large creature
 * (Issue #4146).
 *
 * Issue #4146 reports training tasks overrunning their per-task deadline, then
 * returning no result and being quarantined. This bench times the TypeScript
 * stages that run after the native trainer returns, on a creature the size of
 * the one in the issue (9,684 neurons, 63,317 synapses): 50 inputs, 5 outputs,
 * 9,630 hidden neurons, at least 63,317 synapses, forward-only. It shows
 * whether finalisation on its own can hold a worker.
 *
 * Methodology:
 *   - The creature is built deterministically once at module load from a
 *     fixed-seed LCG: each hidden neuron is fed by an earlier neuron (the first five by inputs),
 *     random extra synapses are added up to 63,317, and a fix-up gives every
 *     hidden neuron an outward connection. The JSON is held in memory only;
 *     nothing is written to disk.
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
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

const IN = 50;
const OUT = 5;
const HIDDEN = 9630;
const SYNAPSES = 63317;

// Fixed-seed LCG, so the same creature is rebuilt on every run.
let seed = 12345;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function buildCreatureJSON(): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  for (let i = 0; i < HIDDEN; i++) {
    neurons.push({
      type: "hidden",
      uuid: `h-${i}`,
      bias: rnd() - 0.5,
      squash: "TANH",
    });
  }
  for (let o = 0; o < OUT; o++) {
    neurons.push({
      type: "output",
      uuid: `output-${o}`,
      bias: rnd() - 0.5,
      squash: "TANH",
    });
  }

  const synapses: CreatureExport["synapses"] = [];
  const seen = new Set<string>();
  const add = (fromUUID: string, toUUID: string) => {
    const key = `${fromUUID}>${toUUID}`;
    if (seen.has(key)) return;
    seen.add(key);
    synapses.push({ weight: (rnd() * 2 - 1) * 0.3, fromUUID, toUUID });
  };

  // The first five hidden neurons read the inputs; the rest read an earlier
  // hidden neuron.
  for (let i = 0; i < HIDDEN; i++) {
    add(
      i < 5 ? `input-${i % IN}` : `h-${Math.floor(rnd() * i)}`,
      `h-${i}`,
    );
  }
  for (let o = 0; o < OUT; o++) {
    add(`h-${HIDDEN - 1 - o}`, `output-${o}`);
  }
  while (synapses.length < SYNAPSES) {
    const to = Math.floor(rnd() * HIDDEN);
    const from = rnd() < 0.3
      ? `input-${Math.floor(rnd() * IN)}`
      : `h-${Math.floor(rnd() * (to || 1))}`;
    if (from === `h-${to}`) continue;
    add(from, `h-${to}`);
  }

  // Fix-up: every hidden neuron needs an outward connection.
  const hasOutward = new Set(synapses.map((s) => s.fromUUID));
  for (let i = 0; i < HIDDEN; i++) {
    if (!hasOutward.has(`h-${i}`)) add(`h-${i}`, `output-${i % OUT}`);
  }

  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    neurons,
    synapses,
    input: IN,
    output: OUT,
  };
}

// Built once at module load; the bench cases only time the stages.
const built = buildCreatureJSON();
const creature = Creature.fromJSON(built);
const canonical = creature.exportJSON();
const target = new Creature(IN, OUT);
const trace = creature.traceJSON();

const GROUP =
  "training finalisation, issue-sized creature (9,630 hidden, 63,317+ synapses)";

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
