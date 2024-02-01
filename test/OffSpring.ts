import { Neat } from "../src/architecture/Neat.ts";
import { Creature } from "../src/Creature.ts";
import { Offspring } from "../src/architecture/Offspring.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.214.0/assert/mod.ts";
import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { assertFalse } from "https://deno.land/std@0.214.0/assert/assert_false.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("OffSpring", async () => {
  const creature = Creature.fromJSON({
    "neurons": [{
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
    "synapses": [{
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
  creature.validate();
  const neat = new Neat(1, 1, {}, []);

  await neat.populatePopulation(creature);
  for (let i = 0; i < neat.config.populationSize; i++) {
    const kid = neat.offspring();
    await neat.populatePopulation(kid as Creature);
  }
});

Deno.test("CrossOver", () => {
  const a = Creature.fromJSON({
    "neurons": [
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
    "synapses": [
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

  const b = new Creature(2, 2, {
    layers: [
      { count: 50 },
    ],
  });

  b.fix();
  b.validate();

  for (let i = 0; i < 100; i++) {
    const c = Offspring.bread(a, b);

    const n = c.neurons[c.neurons.length - 2];
    assertEquals(n.type, "output");

    if (n.squash == "IF") {
      Deno.writeTextFileSync(
        ".cross_over.json",
        JSON.stringify(c.exportJSON(), null, 2),
      );

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
  const creature: CreatureInternal = {
    neurons: [
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
    synapses: [
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

  const n1 = Creature.fromJSON(creature);
  n1.validate();
  n1.fix();

  const n2 = Creature.fromJSON(creature);
  n2.validate();
  n2.fix();

  const toList2 = n2.toConnections(7);

  const UUIDs = new Set<string>();
  toList2.forEach((c) => {
    if (n2.neurons[c.from].type == "output") {
      const uuid = n2.neurons[c.from].uuid;
      UUIDs.add(uuid ? uuid : "unknown");
    }
  });

  for (let i = 0; i < 20; i++) {
    n2.addNode();
  }

  const n3 = Offspring.bread(n1, n2);

  const outputUUID = creature.neurons[2].uuid;

  let outputIndex = -1;
  n3.neurons.forEach((n, idx) => {
    if (n.uuid == outputUUID) {
      outputIndex = idx;
    }
  });

  const toList3 = n3.toConnections(outputIndex);

  toList3.forEach((c) => {
    const uuid = n3.neurons[c.from].uuid;
    if (uuid) {
      UUIDs.delete(uuid);
    }
  });

  if (UUIDs.size > 0) {
    const missingUUID = UUIDs.keys().next().value;

    throw "Did not find " + missingUUID;
  }
}

Deno.test(
  "Many Outputs",
  () => {
    const creature: CreatureInternal = {
      neurons: [
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
        {
          uuid: crypto.randomUUID(),
          bias: 0.08,
          index: 8,
          type: "output",
          squash: "IDENTITY",
        },
        {
          uuid: crypto.randomUUID(),
          bias: 0.09,
          index: 9,
          type: "output",
          squash: "IDENTITY",
        },
        {
          uuid: crypto.randomUUID(),
          bias: 0.10,
          index: 10,
          type: "output",
          squash: "IDENTITY",
        },
        {
          uuid: crypto.randomUUID(),
          bias: 0.11,
          index: 11,
          type: "output",
          squash: "IDENTITY",
        },

        {
          uuid: crypto.randomUUID(),
          bias: 0.12,
          index: 12,
          type: "output",
          squash: "IDENTITY",
        },
        {
          uuid: crypto.randomUUID(),
          bias: 0.13,
          index: 13,
          type: "output",
          squash: "IDENTITY",
        },
        {
          uuid: crypto.randomUUID(),
          bias: 0.14,
          index: 14,
          type: "output",
          squash: "IDENTITY",
        },
      ],
      synapses: [
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
      output: 8,
    };

    const n1 = Creature.fromJSON(creature);
    n1.fix();
    n1.validate();

    const n2 = Creature.fromJSON(n1.exportJSON());

    n2.validate();

    for (let i = 0; i < 20; i++) {
      n2.addNode();
      n2.addConnection();
      // n1.addConnection();
    }

    n2.validate();

    for (let i = 0; i < 20; i++) {
      const child = Offspring.bread(n1, n2);
      child.validate();
    }

    for (let i = 0; i < 20; i++) {
      const child = Offspring.bread(n2, n1);
      child.validate();
    }
  },
);

Deno.test(
  "Copy Required Nodes",
  () => {
    const left = Creature.fromJSON(
      {
        neurons: [
          {
            type: "hidden",
            uuid: "A0",
            bias: 0.1,
            squash: "IDENTITY",
          },
          {
            type: "hidden",
            uuid: "A1",
            bias: 0.11,
            squash: "IDENTITY",
          },
          {
            type: "hidden",
            uuid: "B",
            bias: 0.2,
            squash: "IDENTITY",
          },
          {
            type: "output",
            uuid: "output-0",
            bias: -0.1,
            squash: "IDENTITY",
          },
          {
            type: "output",
            uuid: "output-1",
            bias: -0.2,
            squash: "IDENTITY",
          },
        ],
        synapses: [
          {
            weight: 1,
            fromUUID: "input-0",
            toUUID: "A0",
          },
          {
            weight: 1,
            fromUUID: "input-1",
            toUUID: "B",
          },
          {
            weight: 1,
            fromUUID: "A0",
            toUUID: "A1",
          },
          {
            weight: 1,
            fromUUID: "A1",
            toUUID: "output-0",
          },
          {
            weight: 1,
            fromUUID: "B",
            toUUID: "output-1",
          },
        ],
        input: 3,
        output: 2,
      },
    );

    left.validate();

    const right = Creature.fromJSON(
      {
        neurons: [
          {
            type: "hidden",
            uuid: "C0",
            bias: 0.211,
            squash: "IDENTITY",
          },
          {
            type: "hidden",
            uuid: "C1",
            bias: 0.221,
            squash: "IDENTITY",
          },
          {
            type: "hidden",
            uuid: "B",
            bias: 0.21,
            squash: "IDENTITY",
          },
          {
            type: "output",
            uuid: "output-0",
            bias: -0.11,
            squash: "IDENTITY",
          },
          {
            type: "output",
            uuid: "output-1",
            bias: -0.21,
            squash: "IDENTITY",
          },
        ],
        synapses: [
          {
            weight: 1,
            fromUUID: "input-2",
            toUUID: "C0",
          },
          {
            weight: 0.9,
            fromUUID: "input-1",
            toUUID: "B",
          },
          {
            weight: 1,
            fromUUID: "C0",
            toUUID: "C1",
          },
          {
            weight: 1,
            fromUUID: "C1",
            toUUID: "output-0",
          },
          {
            weight: 1,
            fromUUID: "B",
            toUUID: "output-1",
          },
        ],
        input: 3,
        output: 2,
      },
    );

    right.validate();

    for (let i = 0; i < 20; i++) {
      const child = Offspring.bread(left, right);

      checkChild(child);
    }

    for (let i = 0; i < 20; i++) {
      const child = Offspring.bread(right, left);

      checkChild(child);
    }
  },
);

function checkChild(child: Creature) {
  child.validate();

  const json = child.exportJSON();

  let aBranchFound = false;
  let bBranchFound = false;
  let cBranchFound = false;
  json.neurons.forEach((n) => {
    if (n.uuid == "A1" || n.uuid == "A0") {
      aBranchFound = true;
    }
    if (n.uuid == "B") {
      bBranchFound = true;
    }
    if (n.uuid == "C1" || n.uuid == "C0") {
      cBranchFound = true;
    }
  });

  assert(bBranchFound);
  assert(aBranchFound || cBranchFound);
  assertFalse(aBranchFound && cBranchFound);
}
