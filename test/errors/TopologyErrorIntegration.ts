import { assertIsError, assertThrows } from "@std/assert";
import { TopologyError } from "@errors/TopologyError.ts";
import { Creature } from "../../src/Creature.ts";
import { Neuron } from "@architecture/Neuron.ts";

Deno.test("Neuron constructor throws TopologyError for invalid type", () => {
  const creature = new Creature(2, 1);
  const error = assertThrows(
    () =>
      new Neuron(
        "test-1" as unknown as number,
        "bogus" as "hidden",
        0,
        creature,
      ),
    TopologyError,
  );
  assertIsError(error, TopologyError);
});

Deno.test("Neuron constructor throws TopologyError for constant with squash", () => {
  const creature = new Creature(2, 1);
  const error = assertThrows(
    () =>
      new Neuron(
        "test-1" as unknown as number,
        "constant",
        0,
        creature,
        "TANH",
      ),
    TopologyError,
  );
  assertIsError(error, TopologyError);
});

Deno.test("Neuron.validate throws TopologyError for missing squash on hidden", () => {
  const creature = new Creature(2, 1);
  const neuron = new Neuron(
    "test-1" as unknown as number,
    "hidden",
    0,
    creature,
    "TANH",
  );
  neuron.index = 2;
  // Force squash to be undefined to trigger validation error
  (neuron as unknown as { squash: undefined }).squash = undefined;
  const error = assertThrows(
    () => neuron.validate(),
    TopologyError,
  );
  assertIsError(error, TopologyError);
});

Deno.test("Neuron.exportJSON throws TopologyError for input type", () => {
  const creature = new Creature(2, 1);
  const neuron = new Neuron(
    "input-0" as unknown as number,
    "input",
    Infinity,
    creature,
  );
  neuron.index = 0;
  const error = assertThrows(
    () => neuron.exportJSON(),
    TopologyError,
  );
  assertIsError(error, TopologyError);
});

Deno.test("Neuron.mutate throws TopologyError for input node", () => {
  const creature = new Creature(2, 1);
  const neuron = new Neuron(
    "input-0" as unknown as number,
    "input",
    Infinity,
    creature,
  );
  neuron.index = 0;
  const error = assertThrows(
    () => neuron.mutate("SUB_NODE"),
    TopologyError,
  );
  assertIsError(error, TopologyError);
});
