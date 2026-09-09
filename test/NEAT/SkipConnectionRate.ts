/**
 * Issue #3973: `skipConnectionRate` selects the targeted skip-connection
 * operator, and `0` — the default — must be indistinguishable from a build
 * without the operator.
 *
 * The golden sequence below was captured from base commit `e02d33af` (the
 * milestone branch tip before this change) by seeding the RNG and asking the
 * `Mutator` for 50 mutation methods, then reading the next three RNG draws. It
 * is pinned here rather than compared against a freshly computed value, so the
 * test measures new-versus-historical rather than default-versus-explicit-zero:
 * an operator that consumed even one RNG draw at rate `0` would shift the tail.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

/** Mutation methods commit `e02d33af` selects for seed 3973. */
const HISTORICAL_SELECTION: readonly string[] = [
  "SUB_NODE",
  "MOD_WEIGHT",
  "SUB_NODE",
  "MOD_BIAS",
  "MOD_WEIGHT",
  "SUB_CONN",
  "MOD_BIAS",
  "MOD_BIAS",
  "MOD_BIAS",
  "SUB_CONN",
  "SUB_CONN",
  "MOD_WEIGHT",
  "MOD_WEIGHT",
  "MOD_BIAS",
  "MOD_BIAS",
  "MOD_BIAS",
  "MOD_BIAS",
  "SUB_NODE",
  "MOD_BIAS",
  "MOD_WEIGHT",
  "MOD_WEIGHT",
  "MOD_BIAS",
  "ADD_CONN",
  "MOD_BIAS",
  "MOD_BIAS",
  "ADD_CONN",
  "MOD_WEIGHT",
  "SUB_CONN",
  "SWAP_NODES",
  "MOD_BIAS",
  "MOD_WEIGHT",
  "MOD_BIAS",
  "MOD_BIAS",
  "MOD_WEIGHT",
  "MOD_WEIGHT",
  "MOD_BIAS",
  "MOD_WEIGHT",
  "MOD_SQUASH",
  "MOD_WEIGHT",
  "MOD_WEIGHT",
  "MOD_BIAS",
  "ADD_NODE",
  "MOD_WEIGHT",
  "MOD_BIAS",
  "MOD_WEIGHT",
  "MOD_BIAS",
  "MOD_SQUASH",
  "MOD_WEIGHT",
  "MOD_WEIGHT",
  "MOD_BIAS",
];

/** The next three RNG draws after that selection, on the same commit. */
const HISTORICAL_TAIL: readonly number[] = [
  0.6856675485983662,
  0.9218067199684751,
  0.5312303564361699,
];

/** Draw 50 mutation methods for seed 3973, then read three RNG values. */
function selectionProbe(
  overrides: Record<string, unknown>,
): { names: string[]; tail: number[] } {
  const config = createNeatConfig({
    populationSize: 10,
    mutation: Mutation.ALL,
    ...overrides,
  });
  const mutator = new Mutator(config);
  const creature = new Creature(3, 2, { layers: [{ count: 4 }] });

  setRandomNumberGenerator(createSeededRng(3973));
  const names: string[] = [];
  for (let i = 0; i < HISTORICAL_SELECTION.length; i++) {
    names.push(mutator.selectMutationMethod(creature).name);
  }
  const rng = getRandomNumberGenerator();
  return { names, tail: [rng.random(), rng.random(), rng.random()] };
}

/** A creature whose tail is a single-file run of six hidden neurons. */
function chainCreature(): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  for (let i = 0; i < 6; i++) {
    neurons.push({
      type: "hidden",
      uuid: `run-${i}`,
      squash: "IDENTITY",
      bias: 0.1,
    });
    if (i === 0) {
      synapses.push({ fromUUID: "input-0", toUUID: "run-0", weight: 0.5 });
      synapses.push({ fromUUID: "input-1", toUUID: "run-0", weight: 0.25 });
    } else {
      synapses.push({
        fromUUID: `run-${i - 1}`,
        toUUID: `run-${i}`,
        weight: 0.5,
      });
    }
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  synapses.push({ fromUUID: "run-5", toUUID: "output-0", weight: 0.5 });
  return Creature.fromJSON({ input: 2, output: 1, neurons, synapses });
}

Deno.test("skipConnectionRate - the default is identical to commit e02d33af", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const probe = selectionProbe({});
      assertEquals(probe.names, [...HISTORICAL_SELECTION]);
      assertEquals(probe.tail, [...HISTORICAL_TAIL]);
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("skipConnectionRate - an explicit 0 is identical to commit e02d33af", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const probe = selectionProbe({ skipConnectionRate: 0 });
      assertEquals(probe.names, [...HISTORICAL_SELECTION]);
      assertEquals(
        probe.tail,
        [...HISTORICAL_TAIL],
        "rate 0 must consume no randomness of its own",
      );
      assert(
        !probe.names.includes(Mutation.ADD_SKIP_CONN.name),
        "and must never select the operator",
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("skipConnectionRate - 1 selects the skip operator every time", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const probe = selectionProbe({ skipConnectionRate: 1 });
      assertEquals(
        new Set(probe.names),
        new Set([Mutation.ADD_SKIP_CONN.name]),
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("skipConnectionRate - a fractional rate mixes the operator in", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const probe = selectionProbe({ skipConnectionRate: 0.5 });
      const skips = probe.names.filter((n) =>
        n === Mutation.ADD_SKIP_CONN.name
      ).length;
      const fraction = skips / probe.names.length;
      assert(
        fraction > 0.25 && fraction < 0.75,
        `a rate of 0.5 should select the operator roughly half the time, got ${fraction}`,
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("skipConnectionRate - the operator stays out of Mutation.ALL and FFW", () => {
  const all = Mutation.ALL.map((m) => m.name);
  const ffw = Mutation.FFW.map((m) => m.name);
  assert(
    !all.includes(Mutation.ADD_SKIP_CONN.name),
    "an existing `mutation: ALL` config must not gain the operator",
  );
  assert(!ffw.includes(Mutation.ADD_SKIP_CONN.name));
});

Deno.test("skipConnectionRate - a full mutation batch adds the bypass and stays valid", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      setRandomNumberGenerator(createSeededRng(3973));
      const creature = chainCreature();
      const entry = creature.neurons.find((n) => n.uuid === "run-0")!.index;
      const output = creature.neurons.find((n) => n.uuid === "output-0")!.index;
      const before = creature.synapses.length;

      const config = createNeatConfig({
        populationSize: 10,
        mutation: Mutation.ALL,
        mutationRate: 1,
        mutationAmount: 1,
        skipConnectionRate: 1,
      });
      const mutator = new Mutator(config);
      mutator.mutate([creature]);

      assertEquals(creature.synapses.length, before + 1);
      assert(
        creature.hasConnection(entry, output),
        "the batch should have added the bypass around the run",
      );
      creature.validate();
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("skipConnectionRate - the config refuses values out of range", () => {
  assertThrows(
    () => createNeatConfig({ populationSize: 10, skipConnectionRate: 1.5 }),
    ConfigurationError,
    "Skip connection rate",
  );
  assertThrows(
    () => createNeatConfig({ populationSize: 10, skipMinRunLength: 1 }),
    ConfigurationError,
    "Skip minimum run length",
  );
  assertThrows(
    () => createNeatConfig({ populationSize: 10, skipMinRunLength: 2.5 }),
    ConfigurationError,
    "Skip minimum run length must be an integer",
  );
});

Deno.test("skipConnectionRate - skipMinRunLength reaches the operator", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      setRandomNumberGenerator(createSeededRng(3973));
      // A run of six is bypassed at the default minimum of four, and left alone
      // when the minimum is raised above it.
      const creature = chainCreature();
      const before = creature.synapses.length;
      const config = createNeatConfig({
        populationSize: 10,
        mutation: Mutation.ALL,
        mutationRate: 1,
        mutationAmount: 1,
        skipConnectionRate: 1,
        skipMinRunLength: 7,
      });
      new Mutator(config).mutate([creature]);
      assertEquals(
        creature.synapses.length,
        before,
        "a minimum above the run length must leave the creature alone",
      );
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});
