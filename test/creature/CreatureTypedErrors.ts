/**
 * Tests verifying Creature methods throw typed errors
 * instead of generic Error.
 *
 * Issue #1694
 */
import { assertIsError, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { ActivationError } from "@errors/ActivationError.ts";
import { TopologyError } from "@errors/TopologyError.ts";

Deno.test("Creature activate - throws ActivationError for NaN input", () => {
  const creature = new Creature(2, 1);
  const input = new Float32Array([1.0, NaN]);
  const err = assertThrows(() => creature.activate(input));
  assertIsError(err, ActivationError);
  const ae = err as ActivationError;
  if (ae.reason !== "NON_FINITE_INPUT") {
    throw new Error(`Expected reason NON_FINITE_INPUT, got ${ae.reason}`);
  }
});

Deno.test("Creature activateEphemeral - throws ActivationError for Infinity input", () => {
  const creature = new Creature(2, 1);
  const input = new Float32Array([Infinity, 0.5]);
  const err = assertThrows(() => creature.activateEphemeral(input));
  assertIsError(err, ActivationError);
});

Deno.test("Creature connectBatch - throws TopologyError for duplicate in batch", () => {
  const creature = new Creature(2, 1);
  const err = assertThrows(() =>
    creature.connectBatch([
      { from: 0, to: 2, weight: 0.5 },
      { from: 0, to: 2, weight: 0.3 },
    ])
  );
  assertIsError(err, TopologyError);
  const te = err as TopologyError;
  if (te.reason !== "INVALID_CONNECTION") {
    throw new Error(`Expected reason INVALID_CONNECTION, got ${te.reason}`);
  }
});

Deno.test("Creature connectBatch - throws TopologyError for existing connection", () => {
  const creature = new Creature(2, 1);
  // The creature already has connections from inputs to output.
  // Find an existing connection to attempt duplicate.
  const syn = creature.synapses[0];
  const err = assertThrows(() =>
    creature.connectBatch([
      { from: syn.from, to: syn.to, weight: 0.1 },
    ])
  );
  assertIsError(err, TopologyError);
  const te = err as TopologyError;
  if (te.reason !== "INVALID_CONNECTION") {
    throw new Error(`Expected reason INVALID_CONNECTION, got ${te.reason}`);
  }
});
