import { assert, fail } from "https://deno.land/std@0.220.1/assert/mod.ts";
import { Creature } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

Deno.test("Neuron length", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { neurons: 9 });
    fail("Expected error");
  } catch (e) {
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
  }
});

Deno.test("Neuron length", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { neurons: 9 });
    fail("Expected error");
  } catch (e) {
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
  }
});

Deno.test("Input", () => {
  const creature = new Creature(10, 2);
  creature.input = -1;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
  }
});

Deno.test("Output", () => {
  const creature = new Creature(10, 2);
  creature.output = -1;
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
  }
});

Deno.test("No UUID", () => {
  const creature = new Creature(10, 2);
  creature.neurons[0].uuid = "";
  try {
    creatureValidate(creature);
    fail("Expected error");
  } catch (e) {
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
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
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
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
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
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
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
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
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
  }
});

Deno.test("connections length", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { connections: 9 });
    fail("Expected error");
  } catch (e) {
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
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
    assert(e.name === "NO_INWARD_CONNECTIONS", `Unexpected name: ${e.name}`);
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
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
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
    assert(e.name === "OTHER", `Unexpected name: ${e.name}`);
  }
});
