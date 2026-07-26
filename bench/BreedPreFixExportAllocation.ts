/**
 * Allocation harness for Issue #3473 — Defer the pre-fix genome export in
 * `Offspring.breed` to the compile-failure path.
 *
 * Before #3473, `Offspring.breed` unconditionally called
 * `exportJSONUnchecked(offspring)` for every offspring so a rare
 * WASM-compile-failure diagnostic dump could embed the pre-fix genome. That
 * export allocates an object per neuron and per synapse — pure overhead on the
 * happy path, which runs ~population-size times per generation.
 *
 * This harness quantifies the memory the deferral removes from the happy path:
 *
 *  1. Per-breed heap delta on the current (deferred) code — the residual
 *     allocation of the breeding pipeline with the export skipped.
 *  2. The isolated allocation of a single `exportJSONUnchecked` call for an
 *     offspring-sized genome — this is what the deferral removes from *every*
 *     happy-path breed when diagnostics are off.
 *
 * `Deno.bench()` measures wall-clock only and cannot report allocations, so
 * this is a `deno run` harness (excluded from the `deno bench` glob in
 * `deno.json`). It is not a unit test — it prints numbers for the PR summary.
 *
 * Run with:
 *   deno run --allow-read --allow-write --allow-env --allow-ffi \
 *     --v8-flags=--expose-gc bench/BreedPreFixExportAllocation.ts
 *
 * `--expose-gc` is optional; without it the deltas include uncollected garbage
 * but the relative comparison still holds.
 */
import { Creature } from "@creature";
import { Offspring } from "@architecture/Offspring.ts";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

// deno-lint-ignore no-explicit-any
const maybeGc = (globalThis as any).gc as (() => void) | undefined;

function build(a: number, b: number, layers: { count: number }[]): Creature {
  const c = new Creature(a, b, { layers });
  creatureValidate(c);
  return c;
}

interface Case {
  name: string;
  mum: Creature;
  dad: Creature;
}

const cases: Case[] = [
  {
    name: "Small  (~20 neurons)",
    mum: build(5, 3, [{ count: 8 }, { count: 4 }]),
    dad: build(5, 3, [{ count: 6 }, { count: 5 }]),
  },
  {
    name: "Medium (~200 neurons)",
    mum: build(20, 10, [{ count: 80 }, { count: 60 }, { count: 30 }]),
    dad: build(20, 10, [{ count: 70 }, { count: 50 }, { count: 40 }]),
  },
  {
    name: "Large  (~500 neurons)",
    mum: build(50, 20, [{ count: 200 }, { count: 150 }, { count: 100 }]),
    dad: build(50, 20, [{ count: 180 }, { count: 160 }, { count: 80 }]),
  },
];

const N = 30;

console.log(
  "=== Issue #3473: pre-fix export allocation on Offspring.breed ===",
);
console.log(`Samples per case: ${N}${maybeGc ? " (gc exposed)" : ""}\n`);

for (const { name, mum, dad } of cases) {
  console.log(
    `${name}: parents ${mum.neurons.length} neurons, ${mum.synapses.length} synapses`,
  );

  // (1) Per-breed heap delta on the current (deferred) code.
  for (let i = 0; i < 3; i++) Offspring.breed(mum, dad); // warm up JIT/caches
  maybeGc?.();
  const breedBefore = Deno.memoryUsage().heapUsed;
  for (let i = 0; i < N; i++) Offspring.breed(mum, dad);
  const breedAfter = Deno.memoryUsage().heapUsed;
  const perBreedKb = (breedAfter - breedBefore) / N / 1024;

  // (2) Isolated cost of the pre-fix export the deferral removes from the
  //     happy path. Bred offspring are similar in size to the parents, so a
  //     parent-sized export is a faithful proxy for the removed allocation.
  for (let i = 0; i < 3; i++) exportJSONUnchecked(mum); // warm up
  maybeGc?.();
  const expBefore = Deno.memoryUsage().heapUsed;
  const keep: unknown[] = [];
  for (let i = 0; i < N; i++) keep.push(exportJSONUnchecked(mum));
  const expAfter = Deno.memoryUsage().heapUsed;
  const perExportKb = (expAfter - expBefore) / N / 1024;
  if (keep.length !== N) throw new Error("unexpected sample count");

  console.log(
    `  breed heap delta (export deferred): ${perBreedKb.toFixed(1)} KB/breed`,
  );
  console.log(
    `  pre-fix export removed from happy path: ~${
      perExportKb.toFixed(1)
    } KB/breed\n`,
  );
}
