import { Neat } from "../src/Neat.ts";
import { Network } from "../src/architecture/Network.ts";
import { Offspring } from "../src/architecture/Offspring.ts";
import {
  assertEquals,
  fail,
} from "https://deno.land/std@0.170.0/testing/asserts.ts";

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
    const kid = neat.getOffspring();
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

      const list = c.toConnections(n.index);
      list.forEach((c) => {
        console.info(c);
        switch (c.type) {
          case "condition":
            assertEquals(c.from, n.index - 1);
            break;
          case "positive":
            assertEquals(c.from, n.index - 2);
            break;
          case "negative":
            assertEquals(c.from, 1);
            break;
          default:
            fail("unknown type: " + c.type);
        }
      });
      break;
    }
  }
});
