import { assert, fail } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";

Deno.test("Neuron length", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { neurons: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("Neuron length", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { neurons: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("Input", () => {
  const creature = new Creature(10, 2);
  creature.input = -1;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("Output", () => {
  const creature = new Creature(10, 2);
  creature.output = -1;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("IF", () => {
  const tmp: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
        type: "output",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: -0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 3,
    output: 1,
  };

  const creature = Creature.fromJSON(tmp);

  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "IF_CONDITIONS",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("IF conditions", () => {
  const tmp: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IF", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: -0.3,
        type: "positive",
      },
      {
        fromUUID: "input-1",
        toUUID: "hidden-0",
        weight: -0.3,
        type: "condition",
      },
      {
        fromUUID: "input-2",
        toUUID: "hidden-0",
        weight: -0.3,
        type: "negative",
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 3,
    output: 1,
  };

  Creature.fromJSON(tmp).validate();

  try {
    tmp.synapses[0].type = "negative";
    Creature.fromJSON(tmp).validate();
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "IF_CONDITIONS",
      `Unexpected name: ${error.name}`,
    );
  }

  try {
    tmp.synapses[0].type = "positive";
    tmp.synapses[1].type = "positive";
    Creature.fromJSON(tmp).validate();
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "IF_CONDITIONS",
      `Unexpected name: ${error.name}`,
    );
  }

  try {
    tmp.synapses[1].type = "condition";
    tmp.synapses[2].type = "positive";
    Creature.fromJSON(tmp).validate();
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "IF_CONDITIONS",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("No UUID", () => {
  const creature = new Creature(10, 2);
  creature.neurons[0].uuid = "";
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("Duplicate UUID", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[10].uuid = "A";
  creature.neurons[11].uuid = "A";
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("invalid input UUID", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[0].uuid = "input-1000";

  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("Bias", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[10].bias = Infinity;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("Output Index", () => {
  const creature = new Creature(10, 2);
  creature.DEBUG = true;
  creature.neurons[11].uuid = "output-10";
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("connections length", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { connections: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("expected index", () => {
  const creature = new Creature(10, 2);
  creature.DEBUG = true;
  creatureValidate(creature);
  creature.neurons[0].index = 10;
  try {
    creatureValidate(creature, { connections: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("expected index", () => {
  const creature = new Creature(10, 2);
  creature.DEBUG = true;
  creatureValidate(creature);
  creature.neurons[0].index = 10;
  try {
    creatureValidate(creature, { connections: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("expected index", () => {
  const creature = new Creature(10, 2);
  creature.DEBUG = true;
  creatureValidate(creature);
  creature.neurons[0].index = 10;
  try {
    creatureValidate(creature, { connections: 9 });
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "OTHER",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("Recursive", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 5 }] });
  creature.DEBUG = true;
  creature.synapses.push(new Synapse(12, 11, 0.5));
  creature.synapses.sort((a, b) => {
    if (a.from === b.from) {
      return a.to - b.to;
    } else return a.from - b.from;
  });
  try {
    creatureValidate(creature, { feedbackLoop: false });

    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "RECURSIVE_SYNAPSE",
      `Unexpected name: ${error.name}`,
    );
  }
});
