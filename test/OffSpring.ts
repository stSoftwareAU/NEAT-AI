import { Neat } from "../src/Neat.ts";
import { Network } from "../src/architecture/Network.ts";
import { Offspring } from "../src/architecture/Offspring.ts";
import { assertEquals } from "https://deno.land/std@0.170.0/testing/asserts.ts";
import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("OffSpring", async () => {
  const creature = Network.fromJSON({
    "nodes": [{
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 0,
    }, {
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 1,
    }, {
      "bias": -0.49135010426905,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "index": 2,
    }],
    "connections": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
    }, { "weight": 0.96864643541, "from": 0, "to": 2 }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "error", value: "0.5" },
    ],
  });

  const neat = new Neat(1, 1, {}, []);

  await neat.populatePopulation(creature);
  for (let i = 0; i < neat.config.popSize; i++) {
    const kid = neat.offspring();
    await neat.populatePopulation(kid as Network);
  }
});

Deno.test("CrossOver", () => {
  const a = Network.fromJSON({
    "nodes": [
      {
        "bias": 0.1,
        "index": 2,
        "type": "hidden",
        "squash": "LOGISTIC",
      },
      {
        "bias": 0.2,
        "index": 3,
        "type": "hidden",
        "squash": "LOGISTIC",
      },
      {
        "bias": 0.4,
        "index": 4,
        "type": "output",
        "squash": "IF",
      },
      {
        "bias": -0.3,
        "index": 5,
        "type": "output",
        "squash": "LOGISTIC",
      },
    ],
    "connections": [
      {
        "weight": -0.05643947781091945,
        "from": 0,
        "to": 2,
      },
      {
        "weight": -0.05312834974349934,
        "from": 0,
        "to": 3,
      },
      {
        "weight": -0.0859998264827734,
        "from": 1,
        "to": 3,
      },
      {
        "weight": 0.0306819508373688,
        "from": 1,
        "to": 4,
        "type": "negative",
      },
      {
        "weight": -0.09636098569100936,
        "from": 2,
        "to": 4,
        "type": "positive",
      },
      {
        "weight": 0.08808051749556417,
        "from": 2,
        "to": 5,
      },
      {
        "weight": 0.07164477773299338,
        "from": 3,
        "to": 3,
      },
      {
        "weight": -0.03496077324134794,
        "from": 3,
        "to": 4,
        "type": "condition",
      },
    ],
    "input": 2,
    "output": 2,
  });

  a.fix();
  a.validate();

  const b = new Network(2, 2, {
    layers: [
      { count: 50 },
    ],
  });

  for (let i = 0; i < 100; i++) {
    const c = Offspring.bread(a, b);

    const n = c.nodes[c.nodes.length - 2];
    assertEquals(n.type, "output");

    if (n.squash == "IF") {
      Deno.writeTextFileSync(
        ".cross_over.json",
        JSON.stringify(c.toJSON(), null, 2),
      );

      // const list = c.toConnections(n.index);
      // list.forEach((c) => {
      //   console.info(c);
      //   switch (c.type) {
      //     case "condition":
      //       assertEquals(c.from, n.index - 1);
      //       break;
      //     case "positive":
      //       assertEquals(c.from, n.index - 2);
      //       break;
      //     case "negative":
      //       assertEquals(c.from, 1);
      //       break;
      //     default:
      //       fail("unknown type: " + c.type);
      //   }
      // });
      break;
    }
  }
});

Deno.test(
  "Match on UUID",
  () => {
    for (let i = 0; i < 12; i++) {
      check();
    }
  },
);

function check() {
  const creature: NetworkInterface = {
    nodes: [
      {
        uuid: crypto.randomUUID(),
        bias: 0,
        index: 5,
        type: "hidden",
        squash: "IDENTITY",
      },
      {
        uuid: crypto.randomUUID(),
        bias: 0.1,
        index: 6,
        type: "hidden",
        squash: "MAXIMUM",
      },
      {
        uuid: crypto.randomUUID(),
        bias: 0.2,
        index: 7,
        type: "output",
        squash: "MINIMUM",
      },
    ],
    connections: [
      {
        weight: -0.1,
        from: 1,
        to: 5,
      },
      {
        weight: -0.2,
        from: 2,
        to: 7,
      },
      {
        weight: -0.3,
        from: 3,
        to: 5,
      },
      {
        weight: 0.2,
        from: 4,
        to: 7,
      },
      {
        weight: 0.1,
        from: 5,
        to: 6,
      },
      {
        weight: 0.3,
        from: 6,
        to: 7,
      },
    ],
    input: 5,
    output: 1,
  };

  const n1 = Network.fromJSON(creature);
  n1.validate();
  n1.fix();
  console.info(JSON.stringify(n1.toJSON(), null, 2));
  const n2 = Network.fromJSON(creature);
  n2.validate();
  n2.fix();

  const toList2 = n2.toConnections(7);
  console.info(toList2);
  const UUIDs = new Set<string>();
  toList2.forEach((c) => {
    if (n2.nodes[c.from].type == "output") {
      const uuid = n2.nodes[c.from].uuid;
      UUIDs.add(uuid ? uuid : "unknown");
    }
  });

  for (let i = 0; i < 20; i++) {
    n2.addNode();
  }

  const n3 = Offspring.bread(n1, n2);

  console.info("N3", JSON.stringify(n3.toJSON(), null, 2));

  const outputUUID = creature.nodes[2].uuid;

  let outputIndex = -1;
  n3.nodes.forEach((n, idx) => {
    if (n.uuid == outputUUID) {
      outputIndex = idx;
    }
  });

  const toList3 = n3.toConnections(outputIndex);
  console.info(toList3);
  toList3.forEach((c) => {
    const uuid = n3.nodes[c.from].uuid;
    if (uuid) {
      UUIDs.delete(uuid);
    }
  });

  if (UUIDs.size > 0) {
    const missingUUID = UUIDs.keys().next().value;

    throw "Did not find " + missingUUID;
  }
}
