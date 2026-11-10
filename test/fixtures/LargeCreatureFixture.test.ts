import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import {
  buildLargeCreatureJSON,
  ISSUE_4146_SHAPE,
  type LargeCreatureShape,
} from "./LargeCreatureFixture.ts";

function edges(json: ReturnType<typeof buildLargeCreatureJSON>) {
  return json.synapses.map((s) => {
    assert(s.fromUUID !== undefined && s.toUUID !== undefined);
    return { from: s.fromUUID, to: s.toUUID, weight: s.weight };
  });
}

const SMALL: LargeCreatureShape = {
  inputs: 4,
  outputs: 3,
  hidden: 40,
  synapses: 150,
  seed: 7,
};

Deno.test("LargeCreatureFixture: the issue shape is the size reported in #4146", () => {
  assertEquals(ISSUE_4146_SHAPE.inputs, 50);
  assertEquals(ISSUE_4146_SHAPE.outputs, 5);
  assertEquals(ISSUE_4146_SHAPE.hidden, 9630);
  assertEquals(ISSUE_4146_SHAPE.synapses, 63317);
});

Deno.test("LargeCreatureFixture: carries the requested neurons and metadata", () => {
  const json = buildLargeCreatureJSON(SMALL);
  assertEquals(json.semanticVersion, "4.0.0");
  assertEquals(json.forwardOnly, true);
  assertEquals(json.input, 4);
  assertEquals(json.output, 3);

  const hidden = json.neurons.filter((n) => n.type === "hidden");
  const output = json.neurons.filter((n) => n.type === "output");
  assertEquals(hidden.length, 40);
  assertEquals(output.length, 3);
  assertEquals(hidden[0].uuid, "h-0");
  assertEquals(output[2].uuid, "output-2");
  for (const n of json.neurons) {
    assertEquals(n.squash, "TANH");
    assert(n.bias !== undefined && n.bias >= -0.5 && n.bias < 0.5);
    assert(typeof n.uuid === "string" && n.uuid.length > 0);
  }
});

Deno.test("LargeCreatureFixture: synapses are unique, bounded and reach the minimum", () => {
  const json = buildLargeCreatureJSON(SMALL);
  assert(json.synapses.length >= 150);

  const keys = new Set<string>();
  for (const s of edges(json)) {
    assert(s.weight >= -0.3 && s.weight <= 0.3);
    assertNotEquals(s.from, s.to);
    keys.add(`${s.from}>${s.to}`);
  }
  assertEquals(keys.size, json.synapses.length);
});

Deno.test("LargeCreatureFixture: wiring is feed-forward and every hidden neuron is connected", () => {
  const json = buildLargeCreatureJSON(SMALL);
  const index = (uuid: string): number =>
    uuid.startsWith("input-")
      ? -1
      : uuid.startsWith("output-")
      ? 1_000_000
      : Number(uuid.slice(2));

  const outward = new Set<string>();
  const inward = new Set<string>();
  const inputsUsed = new Set<string>();
  for (const s of edges(json)) {
    outward.add(s.from);
    inward.add(s.to);
    if (s.from.startsWith("input-")) inputsUsed.add(s.from);
    assert(!s.to.startsWith("input-"));
    assert(index(s.from) < index(s.to), `${s.from}>${s.to}`);
  }
  for (let i = 0; i < 40; i++) {
    assert(outward.has(`h-${i}`), `h-${i} has no outward synapse`);
    assert(inward.has(`h-${i}`), `h-${i} has no inward synapse`);
  }
  for (let o = 0; o < 3; o++) assert(inward.has(`output-${o}`));
  // The first five hidden neurons read inputs, wrapping over the input count.
  for (let i = 0; i < 4; i++) assert(inputsUsed.has(`input-${i}`));
  const first = (i: number) => edges(json).find((s) => s.to === `h-${i}`)!.from;
  assertEquals(first(0), "input-0");
  assertEquals(first(4), "input-0");
  // The last hidden neurons feed the outputs.
  for (let o = 0; o < 3; o++) {
    assert(
      edges(json).some((s) =>
        s.from === `h-${40 - 1 - o}` && s.to === `output-${o}`
      ),
    );
  }
});

Deno.test("LargeCreatureFixture: same seed rebuilds the same creature, another seed differs", () => {
  const a = buildLargeCreatureJSON(SMALL);
  const b = buildLargeCreatureJSON(SMALL);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  const c = buildLargeCreatureJSON({ ...SMALL, seed: 8 });
  assertNotEquals(JSON.stringify(a), JSON.stringify(c));
  // Building twice does not share RNG state across calls.
  assertEquals(
    JSON.stringify(buildLargeCreatureJSON(SMALL)),
    JSON.stringify(a),
  );
});

Deno.test("LargeCreatureFixture: the creature loads and round-trips through the library", () => {
  const json = buildLargeCreatureJSON(SMALL);
  const creature = Creature.fromJSON(json);
  const exported = creature.exportJSON();
  assertEquals(exported.input, 4);
  assertEquals(exported.output, 3);
  assertEquals(exported.neurons.length, json.neurons.length);
  assertEquals(exported.synapses.length, json.synapses.length);
  assertEquals(
    Creature.fromJSON(exported).exportJSON().synapses.length,
    json.synapses.length,
  );
});
