import { fail } from "https://deno.land/std@0.220.1/assert/fail.ts";
import { Creature } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

Deno.test("Neuron length", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { neurons: 9 });
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});

Deno.test("Input", () => {
  const creature = new Creature(10, 2);
  creature.input = -1;
  try {
    creatureValidate(creature);
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});

Deno.test("Output", () => {
  const creature = new Creature(10, 2);
  creature.output = -1;
  try {
    creatureValidate(creature);
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});

Deno.test("No UUID", () => {
  const creature = new Creature(10, 2);
  creature.neurons[0].uuid = "";
  try {
    creatureValidate(creature);
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});

Deno.test("Duplicate UUID", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[10].uuid = "A";
  creature.neurons[11].uuid = "A";
  try {
    creatureValidate(creature);
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});

Deno.test("invalid input UUID", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[0].uuid = "input-1000";

  try {
    creatureValidate(creature);
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});

Deno.test("Bias", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.DEBUG = true;
  creature.neurons[10].bias = Infinity;
  try {
    creatureValidate(creature);
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});

Deno.test("Output Index", () => {
  const creature = new Creature(10, 2);
  creature.DEBUG = true;
  creature.neurons[11].uuid = "output-10";
  try {
    creatureValidate(creature);
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});

Deno.test("connections length", () => {
  const creature = new Creature(10, 2);
  creatureValidate(creature);
  try {
    creatureValidate(creature, { connections: 9 });
  } catch (e) {
    if (e.name !== "OTHER") {
      console.log(e);
      fail("Expected error name to be OTHER");
    }
  }
});
