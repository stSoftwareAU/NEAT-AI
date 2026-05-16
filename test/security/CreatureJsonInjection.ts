/**
 * Issue #2704 - security regression test.
 *
 * `Creature` activation compilers build JavaScript source strings by
 * template-interpolating `neuron.bias` and synapse `weight` directly into
 * `new Function()` bodies. The default JSON-load path
 * (`CreatureSerialization.fromJSON` -> `Neuron.fromJSON`) must therefore
 * reject any creature JSON whose `bias` or `weight` is not a finite number
 * so attacker-crafted strings cannot reach the function compiler.
 *
 * These tests exercise the load path directly with payloads that, prior to
 * the fix, would have flowed unvalidated into `new Function(...)` and run
 * arbitrary JS in the host process.
 */

import { assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { fromJSON } from "@creature/CreatureSerialization.ts";
import { TopologyError } from "@errors/TopologyError.ts";

/** Build a minimal but well-formed creature export skeleton (2 inputs, 1 output, 1 hidden). */
function buildSkeleton(): Record<string, unknown> {
  return {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-test-1",
        bias: 0.1,
        squash: "TANH",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0.2,
        squash: "IDENTITY",
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-test-1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-test-1", weight: -0.25 },
      { fromUUID: "hidden-test-1", toUUID: "output-0", weight: 0.75 },
    ],
  };
}

Deno.test("CreatureSerialization.fromJSON rejects non-number bias (string injection payload)", () => {
  const json = buildSkeleton();
  // Attacker payload: closes the `const value = ${neuron.bias}` template
  // and appends arbitrary JS.
  (json.neurons as Array<Record<string, unknown>>)[0].bias =
    "0); maliciousJsCode(); //" as unknown as number;

  assertThrows(
    () => fromJSON(json as never, false, Creature),
    TopologyError,
    "bias",
  );
});

Deno.test("CreatureSerialization.fromJSON rejects non-number bias on output neuron", () => {
  const json = buildSkeleton();
  (json.neurons as Array<Record<string, unknown>>)[1].bias =
    "0); throw new Error('pwned'); //" as unknown as number;

  assertThrows(
    () => fromJSON(json as never, false, Creature),
    TopologyError,
    "bias",
  );
});

Deno.test("CreatureSerialization.fromJSON rejects NaN bias", () => {
  const json = buildSkeleton();
  (json.neurons as Array<Record<string, unknown>>)[0].bias = Number.NaN;

  assertThrows(
    () => fromJSON(json as never, false, Creature),
    TopologyError,
    "bias",
  );
});

Deno.test("CreatureSerialization.fromJSON rejects Infinity bias", () => {
  const json = buildSkeleton();
  (json.neurons as Array<Record<string, unknown>>)[0].bias =
    Number.POSITIVE_INFINITY;

  assertThrows(
    () => fromJSON(json as never, false, Creature),
    TopologyError,
    "bias",
  );
});

Deno.test("CreatureSerialization.fromJSON rejects non-number synapse weight (string injection payload)", () => {
  const json = buildSkeleton();
  (json.synapses as Array<Record<string, unknown>>)[0].weight =
    "0; throw 1" as unknown as number;

  assertThrows(
    () => fromJSON(json as never, false, Creature),
    TopologyError,
    "weight",
  );
});

Deno.test("CreatureSerialization.fromJSON rejects NaN synapse weight", () => {
  const json = buildSkeleton();
  (json.synapses as Array<Record<string, unknown>>)[2].weight = Number.NaN;

  assertThrows(
    () => fromJSON(json as never, false, Creature),
    TopologyError,
    "weight",
  );
});

Deno.test("CreatureSerialization.fromJSON accepts missing bias on non-input neuron (normalised to 0)", () => {
  // `bias` is optional in `NeuronInternal` / `NeuronAbstract` and has always
  // been normalised to 0 by `Neuron.fromJSON` (`json.bias ? json.bias : 0`).
  // `undefined` is therefore a safe "no bias set" state — not an attack vector —
  // so the load path must accept it rather than reject it.
  const json = buildSkeleton();
  delete (json.neurons as Array<Record<string, unknown>>)[0].bias;

  // Must NOT throw; loads cleanly with the missing bias defaulted to 0.
  fromJSON(json as never, false, Creature);
});

Deno.test("CreatureSerialization.fromJSON rejects missing weight on synapse", () => {
  const json = buildSkeleton();
  delete (json.synapses as Array<Record<string, unknown>>)[0].weight;

  assertThrows(
    () => fromJSON(json as never, false, Creature),
    TopologyError,
    "weight",
  );
});

Deno.test("Neuron constructor rejects non-finite bias (defence in depth)", async () => {
  const { Neuron } = await import("@architecture/Neuron.ts");
  const creature = new Creature(1, 1);

  assertThrows(
    () => new Neuron(123456, "hidden", Number.NaN, creature, "IDENTITY"),
    TopologyError,
    "bias",
  );
  assertThrows(
    () =>
      new Neuron(
        123457,
        "hidden",
        "0); evil(); //" as unknown as number,
        creature,
        "IDENTITY",
      ),
    TopologyError,
    "bias",
  );
});
