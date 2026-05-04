import { assertEquals, assertExists, assertThrows } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { TopologyError } from "@errors/TopologyError.ts";

Deno.test("forward-only: connect() rejects self-connection", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.forwardOnly = true;
  const h = creature.input;
  assertThrows(
    () => creature.connect(h, h, 0.1),
    TopologyError,
    "self-connection",
  );
});

Deno.test("forward-only: connect() rejects backward connection", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;
  const h0 = creature.input;
  const h1 = creature.input + 1;
  assertThrows(
    () => creature.connect(h1, h0, 0.1),
    TopologyError,
    "backward connection",
  );
});

Deno.test("forward-only: connectBatch() rejects backward connection", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.forwardOnly = true;
  const h0 = creature.input;
  const h1 = creature.input + 1;
  assertThrows(
    () =>
      creature.connectBatch([
        { from: h0, to: h1, weight: 0.1 },
        { from: h1, to: h0, weight: 0.2 },
      ]),
    TopologyError,
    "backward connection",
  );
});

// Issue #2514: the load-side throw is now the default for forward-only
// recurrent edges. The two strip-and-keep tests below intentionally
// exercise the legacy strip path (which still must work for repair
// tools), so they opt back into `throwOnRecurrent: "never"`. New
// throw-default coverage lives in
// `test/creature/LoadFromForwardOnlyThrow.ts`.
const REPAIR_LOAD: { throwOnRecurrent: "never" } = {
  throwOnRecurrent: "never",
};

Deno.test(
  "forward-only: loadFrom strips backward synapse when json.forwardOnly is true",
  () => {
    const json: CreatureExport = {
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.1 },
        { fromUUID: "h0", toUUID: "h1", weight: 0.1 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.2 },
        { fromUUID: "h1", toUUID: "h0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json, false, "fromJSON", REPAIR_LOAD);
    assertEquals(creature.synapses.length, 3);
    for (const s of creature.synapses) {
      if (s.from >= s.to) {
        throw new Error(`Unexpected recurrent synapse: ${s.from}->${s.to}`);
      }
    }
  },
);

Deno.test(
  "forward-only: loadFrom strips self-connection when json.forwardOnly is true",
  () => {
    const json: CreatureExport = {
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.1 },
        { fromUUID: "h0", toUUID: "h0", weight: 0.2 },
        { fromUUID: "h0", toUUID: "output-0", weight: 0.3 },
      ],
    };

    const creature = Creature.fromJSON(json, false, "fromJSON", REPAIR_LOAD);
    assertEquals(creature.synapses.length, 2);
  },
);

Deno.test("feedback creature: connect() still allows self-connection", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
  creature.forwardOnly = false;
  const h = creature.input;
  creature.connect(h, h, 0.1);
  assertExists(creature.getSynapse(h, h));
});
