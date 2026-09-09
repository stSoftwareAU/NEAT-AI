/**
 * Issue #3973: `AddSkipConnection` proposes a bypass around a deep serial run.
 *
 * The operator's whole content is its targeting — a randomly placed skip is
 * just `AddConnection` — so these tests assert **where** the synapse lands, not
 * merely that one was added.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { AddSkipConnection } from "@mutate/AddSkipConnection.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

/**
 * A creature whose tail is a single-file run of `runLength` hidden neurons.
 *
 * A second input joins the first chain member so depth 1 still holds exactly
 * one neuron, matching the shape #3972 found in the GRQ creature.
 */
function chainCreature(
  runLength: number,
  options: { forwardOnly?: boolean; extraWidth?: number } = {},
): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < runLength; i++) {
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

  // Optional extra breadth hanging off the inputs, so the run is not the only
  // structure a uniformly-drawn connection could land on.
  const width = options.extraWidth ?? 0;
  for (let i = 0; i < width; i++) {
    neurons.push({
      type: "hidden",
      uuid: `wide-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
    synapses.push({ fromUUID: "input-0", toUUID: `wide-${i}`, weight: 0.1 });
    synapses.push({ fromUUID: `wide-${i}`, toUUID: "output-0", weight: 0.1 });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  synapses.push({
    fromUUID: `run-${runLength - 1}`,
    toUUID: "output-0",
    weight: 0.5,
  });

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons,
    synapses,
  });
  if (options.forwardOnly) creature.forwardOnly = true;
  return creature;
}

/** Index of the neuron carrying `uuid`. */
function indexOf(creature: Creature, uuid: string): number {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  assert(neuron !== undefined, `creature should carry a neuron ${uuid}`);
  return neuron.index;
}

Deno.test("AddSkipConnection - bypasses the run from its entry to the neuron it feeds", () => {
  const creature = chainCreature(6);
  const before = creature.synapses.length;
  const operator = new AddSkipConnection(creature);

  assert(operator.mutate(), "a six-member run should attract a bypass");
  assertEquals(creature.synapses.length, before + 1, "exactly one synapse");

  const entry = indexOf(creature, "run-0");
  const output = indexOf(creature, "output-0");
  assert(
    creature.hasConnection(entry, output),
    "the bypass should run from the run's entry to the neuron the run feeds",
  );
});

Deno.test("AddSkipConnection - a run shorter than skipMinRunLength is left alone", () => {
  const creature = chainCreature(3);
  const before = creature.synapses.length;
  const operator = new AddSkipConnection(creature);

  assertEquals(
    operator.mutate(),
    false,
    "a three-member run is below the default minimum of four",
  );
  assertEquals(creature.synapses.length, before, "no synapse added");
  assertEquals(operator.candidates().length, 0, "and no candidate offered");
});

Deno.test("AddSkipConnection - skipMinRunLength lowers the bar", () => {
  const creature = chainCreature(3);
  const operator = new AddSkipConnection(creature, { skipMinRunLength: 3 });

  assert(operator.mutate(), "a three-member run qualifies at a minimum of 3");
  assert(
    creature.hasConnection(
      indexOf(creature, "run-0"),
      indexOf(creature, "output-0"),
    ),
  );
});

Deno.test("AddSkipConnection - prefers the longest run when several qualify", () => {
  // A four-member run feeding a seven-member run: one 11-member single-file
  // tail, which is what the candidate list must report.
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // The short run: input → s0 → s1 → s2 → s3 → output.
  for (let i = 0; i < 4; i++) {
    neurons.push({
      type: "hidden",
      uuid: `s-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
    synapses.push({
      fromUUID: i === 0 ? "input-0" : `s-${i - 1}`,
      toUUID: `s-${i}`,
      weight: 0.5,
    });
  }
  // The long run continues from the short one's tail, so its depths are deeper
  // and each of them is single-occupancy.
  for (let i = 0; i < 7; i++) {
    neurons.push({
      type: "hidden",
      uuid: `l-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
    synapses.push({
      fromUUID: i === 0 ? "s-3" : `l-${i - 1}`,
      toUUID: `l-${i}`,
      weight: 0.5,
    });
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  synapses.push({ fromUUID: "l-6", toUUID: "output-0", weight: 0.5 });

  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons,
    synapses,
  });

  // The whole tail is one 11-member run, so the entry is `s-0`; the candidate
  // list must be ordered by run length with that single longest run first.
  const operator = new AddSkipConnection(creature);
  const candidates = operator.candidates();
  assert(candidates.length > 0, "the tail should offer a bypass");
  assertEquals(candidates[0].runLength, 11);
  assertEquals(candidates[0].entry, indexOf(creature, "s-0"));
  assertEquals(candidates[0].target, indexOf(creature, "output-0"));
});

Deno.test("AddSkipConnection - targets the deep run, not a uniformly drawn pair", () => {
  // 40 wide neurons hang off the inputs, so a uniformly drawn pair would
  // almost never straddle the run. Every candidate this operator offers does.
  //
  // The breadth shares depth 1 with `run-0`, so the single-occupancy run starts
  // at `run-1` — the operator reports the run it can actually see, not the one
  // the fixture author had in mind.
  const creature = chainCreature(8, { extraWidth: 40 });
  const operator = new AddSkipConnection(creature);
  const candidates = operator.candidates();

  assert(candidates.length > 0, "the run should be found among the breadth");
  const entry = indexOf(creature, "run-1");
  for (const candidate of candidates) {
    assertEquals(
      candidate.entry,
      entry,
      "every bypass starts at the run's entry neuron",
    );
    assert(candidate.runLength >= 4, "and bypasses a run worth bypassing");
  }
});

Deno.test("AddSkipConnection - a forward-only creature stays forward-only", () => {
  const creature = chainCreature(6, { forwardOnly: true });
  const operator = new AddSkipConnection(creature);

  assert(operator.mutate(), "a forward-only creature still gets its bypass");
  assertEquals(creature.forwardOnly, true, "the lineage stays forward-only");
  for (const synapse of creature.synapses) {
    assert(
      synapse.from < synapse.to,
      `synapse ${synapse.from}->${synapse.to} must run forward`,
    );
  }
  creature.validate();
});

Deno.test("AddSkipConnection - the forward-only guard refuses a backward bypass", () => {
  // The guard is the constraint the operator relies on; exercise it directly on
  // a forward-only creature rather than trusting it.
  const creature = chainCreature(6, { forwardOnly: true });
  const entry = indexOf(creature, "run-0");
  const output = indexOf(creature, "output-0");
  assertThrows(
    () => creature.connect(output, entry, 0.1),
    Error,
    "Forward-only topology forbids backward connection",
  );
});

Deno.test("AddSkipConnection - the bypass weight honours structuralWeightScale", async () => {
  await withRngTestLock(() => {
    const previous = getRandomNumberGenerator();
    try {
      const scale = 0.01;
      setRandomNumberGenerator(createSeededRng(3973));
      const creature = chainCreature(6);
      const operator = new AddSkipConnection(creature, {
        structuralWeightScale: scale,
      });
      assert(operator.mutate());

      const entry = indexOf(creature, "run-0");
      const output = indexOf(creature, "output-0");
      const bypass = creature.getSynapses(entry, output);
      assertEquals(bypass.length, 1);
      const magnitude = Math.abs(bypass[0].weight);
      assert(
        magnitude <= 0.5 * scale,
        `a scaled bypass weight should not exceed ${
          0.5 * scale
        }, was ${magnitude}`,
      );
      assert(magnitude > 0, "and is never exactly zero");
    } finally {
      setRandomNumberGenerator(previous);
    }
  });
});

Deno.test("AddSkipConnection - adds one bypass per call and never a duplicate", () => {
  const creature = chainCreature(6);
  const exit = indexOf(creature, "run-5");
  const operator = new AddSkipConnection(creature);
  const first = creature.synapses.length;
  assert(operator.mutate());
  assertEquals(creature.synapses.length, first + 1);

  // The only consumer of the exit is the output, and that bypass now exists,
  // so a second call finds nothing left to propose for this run.
  assertEquals(
    operator.mutate(),
    false,
    "the same bypass must not be proposed twice",
  );
  assertEquals(creature.synapses.length, first + 1);
  assertEquals(creature.outwardConnections(exit).length, 1);
});

Deno.test("AddSkipConnection - a wide creature with no serial run is left alone", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "b", weight: 0.5 },
      { fromUUID: "a", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "b", toUUID: "output-0", weight: 0.5 },
    ],
  });
  const before = creature.synapses.length;
  const operator = new AddSkipConnection(creature);
  assertEquals(operator.mutate(), false);
  assertEquals(creature.synapses.length, before);
});

Deno.test("AddSkipConnection - focus list is preferred, then relaxed", () => {
  const creature = chainCreature(6);
  const entry = indexOf(creature, "run-0");
  const operator = new AddSkipConnection(creature);

  // A focus list naming a neuron nowhere near the run must not lose the
  // mutation — the candidate is offered anyway.
  const relaxed = operator.candidates([indexOf(creature, "run-3")]);
  assertEquals(relaxed.length, 1);
  assertEquals(relaxed[0].entry, entry);
});

Deno.test("AddSkipConnection - refuses an out-of-range skipMinRunLength", () => {
  const creature = chainCreature(6);
  assertThrows(
    () => new AddSkipConnection(creature, { skipMinRunLength: 1 }),
    ConfigurationError,
    "skipMinRunLength must be at least 2",
  );
  assertThrows(
    () => new AddSkipConnection(creature, { skipMinRunLength: 2.5 }),
    ConfigurationError,
    "skipMinRunLength must be a whole number",
  );
  assertThrows(
    () => new AddSkipConnection(creature, { structuralWeightScale: 0 }),
    ConfigurationError,
    "structuralWeightScale must be a finite number greater than zero",
  );
});
