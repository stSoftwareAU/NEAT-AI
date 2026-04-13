/**
 * Benchmark for serialisation cost vs mutation cost analysis.
 *
 * Issue #2279: Estimate whether mutation parallelisation across workers
 * is viable by comparing the cost of serialising a creature (for IPC)
 * against the cost of mutating it.
 *
 * If serialisation cost > mutation cost, parallelisation is counterproductive
 * due to the serialisation wall (see docs/PERFORMANCE_RESEARCH.md).
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/MutationSerialisationCost.ts
 */
import { Creature } from "@creature";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

const config = createNeatConfig({
  mutation: Mutation.FFW,
  mutationRate: 1.0,
  mutationAmount: 5,
});

const mutator = new Mutator(config);

// Pre-create creatures of various sizes for consistent benchmarking
const smallCreature = new Creature(5, 3, { layers: [{ count: 5 }] });
const mediumCreature = new Creature(10, 5, { layers: [{ count: 20 }] });
const largeCreature = new Creature(20, 10, {
  layers: [{ count: 50 }, { count: 30 }],
});

// Pre-validate creatures
smallCreature.validate();
mediumCreature.validate();
largeCreature.validate();

// ============================================
// Small creature: serialisation vs mutation
// ============================================

Deno.bench({
  name: "serialise small creature (JSON stringify + parse)",
  group: "small creature",
  baseline: true,
  fn() {
    const json = smallCreature.exportJSON();
    const str = JSON.stringify(json);
    const _parsed: CreatureExport = JSON.parse(str);
  },
});

Deno.bench({
  name: "mutate small creature (5 mutations)",
  group: "small creature",
  fn() {
    const clone = smallCreature.shallowClone();
    mutator.mutate([clone]);
  },
});

Deno.bench({
  name: "full round-trip small creature (serialise + deserialise)",
  group: "small creature",
  fn() {
    const json = smallCreature.exportJSON();
    const str = JSON.stringify(json);
    const parsed: CreatureExport = JSON.parse(str);
    Creature.fromJSON(parsed);
  },
});

// ============================================
// Medium creature: serialisation vs mutation
// ============================================

Deno.bench({
  name: "serialise medium creature (JSON stringify + parse)",
  group: "medium creature",
  baseline: true,
  fn() {
    const json = mediumCreature.exportJSON();
    const str = JSON.stringify(json);
    const _parsed: CreatureExport = JSON.parse(str);
  },
});

Deno.bench({
  name: "mutate medium creature (5 mutations)",
  group: "medium creature",
  fn() {
    const clone = mediumCreature.shallowClone();
    mutator.mutate([clone]);
  },
});

Deno.bench({
  name: "full round-trip medium creature (serialise + deserialise)",
  group: "medium creature",
  fn() {
    const json = mediumCreature.exportJSON();
    const str = JSON.stringify(json);
    const parsed: CreatureExport = JSON.parse(str);
    Creature.fromJSON(parsed);
  },
});

// ============================================
// Large creature: serialisation vs mutation
// ============================================

Deno.bench({
  name: "serialise large creature (JSON stringify + parse)",
  group: "large creature",
  baseline: true,
  fn() {
    const json = largeCreature.exportJSON();
    const str = JSON.stringify(json);
    const _parsed: CreatureExport = JSON.parse(str);
  },
});

Deno.bench({
  name: "mutate large creature (5 mutations)",
  group: "large creature",
  fn() {
    const clone = largeCreature.shallowClone();
    mutator.mutate([clone]);
  },
});

Deno.bench({
  name: "full round-trip large creature (serialise + deserialise)",
  group: "large creature",
  fn() {
    const json = largeCreature.exportJSON();
    const str = JSON.stringify(json);
    const parsed: CreatureExport = JSON.parse(str);
    Creature.fromJSON(parsed);
  },
});
