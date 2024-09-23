import { assert, fail } from "@std/assert";
import { Creature } from "../../mod.ts";
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
      `Unexpected name: ${e.name}`,
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
      `Unexpected name: ${e.name}`,
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

Deno.test("output inward", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  creature.synapses.length = 0;
  creature.DEBUG = true;
  creature.clearCache();
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "NO_INWARD_CONNECTIONS",
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
    if (a.from == b.from) {
      return a.to - b.to;
    } else return a.from - b.from;
  });
  try {
    creatureValidate(creature, { feedbackLoop: false });
    console.info(creature.exportJSON());
    fail("Expected error");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "RECURSIVE_SYNAPSE",
      `Unexpected name: ${error.name}`,
    );
  }
});
