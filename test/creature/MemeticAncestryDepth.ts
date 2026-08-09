/**
 * Issue #3682 — the memetic load path must bound `ancestry` nesting.
 *
 * `convertMemeticToIntIds` used to recurse through `memetic.ancestry` with no
 * depth cap, re-cloning the whole remaining subtree at every level, so a
 * compact model JSON with a deeply nested ancestry chain burned super-linear
 * CPU and then overflowed the stack. The write side (`addToAncestry`) has
 * always bounded ancestry to `DEFAULT_ANCESTRY_DEPTH`; these tests assert the
 * read side enforces the same bound on untrusted JSON.
 *
 * These are "what" tests: they assert on the loaded `creature.memetic` and on
 * the exported wire JSON, never on how the conversion is implemented.
 */
import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "@creature";
import {
  DEFAULT_ANCESTRY_DEPTH,
  type MemeticInterface,
} from "@blackbox/MemeticInterface.ts";
import type { MemeticWireData } from "@blackbox/MemeticWireData.ts";

function baseCreatureJSON(): CreatureExport {
  return {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 3 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.3 },
      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: -0.5 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
  };
}

/** One memetic snapshot in wire format (UUID bias keys, wire weight rows). */
function wireSnapshot(generation: number): MemeticWireData {
  return {
    generation,
    score: -generation,
    biases: { "hidden-3": generation + 0.1, "hidden-4": generation + 0.2 },
    weights: [
      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: generation + 0.3 },
    ],
  };
}

/** A chain of `depth` nested `ancestry` levels below the returned root. */
function nestedAncestry(depth: number): MemeticWireData {
  let node = wireSnapshot(0);
  for (let generation = 1; generation <= depth; generation++) {
    node = { ...wireSnapshot(generation), ancestry: [node] };
  }
  return node;
}

/** Length of the `ancestry` chain hanging below `root` (iterative, no recursion). */
function ancestryChainDepth(root: MemeticWireData): number {
  let depth = 0;
  let node: MemeticWireData | undefined = root;
  while (node?.ancestry && node.ancestry.length > 0) {
    depth++;
    node = node.ancestry[0];
  }
  return depth;
}

function loadWithMemetic(memetic: MemeticWireData): Creature {
  const json = baseCreatureJSON() as CreatureExport & {
    memetic: MemeticInterface;
  };
  json.memetic = memetic as unknown as MemeticInterface;
  return Creature.fromJSON(json);
}

Deno.test("deeply nested memetic ancestry loads without a stack overflow", () => {
  const creature = loadWithMemetic(nestedAncestry(10_000));

  const memetic = creature.memetic as unknown as MemeticWireData | undefined;
  assert(memetic, "memetic should survive the load");
  assertEquals(
    ancestryChainDepth(memetic),
    DEFAULT_ANCESTRY_DEPTH,
    "ancestry nesting must be truncated to the shared write-side cap",
  );
});

Deno.test("deeply nested memetic ancestry still converts UUID keys to int ids", () => {
  const creature = loadWithMemetic(nestedAncestry(10_000));

  const memetic = creature.memetic as unknown as MemeticWireData;
  const idOf = (uuid: string): number =>
    creature.neurons.find((n) => n.uuid === uuid)!.id;

  assertEquals(memetic.biases?.[`${idOf("hidden-3")}`], 10_000.1);
  assertEquals(memetic.ancestry?.length, 1);
  assertEquals(memetic.ancestry?.[0].biases?.[`${idOf("hidden-3")}`], 9999.1);
});

Deno.test("memetic within the ancestry depth cap round-trips unchanged", () => {
  const memetic: MemeticWireData = {
    ...wireSnapshot(9),
    ancestry: [wireSnapshot(8), wireSnapshot(7), wireSnapshot(6)],
  };
  const expected = structuredClone(memetic);

  const creature = loadWithMemetic(structuredClone(memetic));
  const exported = creature.exportJSON();

  assertEquals(
    exported.memetic as unknown as MemeticWireData,
    expected,
    "a well-formed memetic block must survive load/export untouched",
  );
});

Deno.test("ancestry nesting at the depth cap is preserved", () => {
  const creature = loadWithMemetic(nestedAncestry(DEFAULT_ANCESTRY_DEPTH));

  const memetic = creature.memetic as unknown as MemeticWireData;
  assertEquals(ancestryChainDepth(memetic), DEFAULT_ANCESTRY_DEPTH);
});
