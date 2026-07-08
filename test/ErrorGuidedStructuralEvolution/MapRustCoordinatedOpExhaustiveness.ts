import { assertEquals, assertThrows } from "@std/assert";
import { mapRustCoordinatedOp } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverAnalysis.ts";
import type { RustCoordinatedStructuralOperation } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

// Issue #3190: the `default` branch of `mapRustCoordinatedOp` previously cast
// silently (`op as CoordinatedStructuralOperation`). It now calls the project's
// exhaustiveness guard `assertNever`, so an unmapped Rust variant that escapes
// the type system (malformed wire data) fails loudly at runtime instead of
// being blessed through the boundary unmapped.
//
// Issue #3250: the Rust discovery engine emits the full coordinated-op set
// (setWeight/addNeuron/removeNeuron/changeSquash/setBias), not just the two
// synapse ops. `mapRustCoordinatedOp` must map every variant the engine emits
// — previously an emitted `setBias` hit `assertNever` and threw at runtime.

Deno.test("mapRustCoordinatedOp maps a removeSynapse operation", () => {
  const op: RustCoordinatedStructuralOperation = {
    type: "removeSynapse",
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
  };

  const mapped = mapRustCoordinatedOp(op);
  assertEquals(mapped, {
    type: "removeSynapse",
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
  });
});

Deno.test("mapRustCoordinatedOp maps an addSynapse operation with its weight", () => {
  const op: RustCoordinatedStructuralOperation = {
    type: "addSynapse",
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
    weight: 0.75,
  };

  const mapped = mapRustCoordinatedOp(op);
  assertEquals(mapped, {
    type: "addSynapse",
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
    weight: 0.75,
  });
});

Deno.test("mapRustCoordinatedOp maps a setWeight operation with its weight", () => {
  const op: RustCoordinatedStructuralOperation = {
    type: "setWeight",
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
    weight: -0.25,
  };

  const mapped = mapRustCoordinatedOp(op);
  assertEquals(mapped, {
    type: "setWeight",
    fromNeuronUuid: "input-0",
    toNeuronUuid: "output-0",
    weight: -0.25,
  });
});

Deno.test("mapRustCoordinatedOp maps a setBias operation (Issue #3250)", () => {
  const op: RustCoordinatedStructuralOperation = {
    type: "setBias",
    neuronUuid: "L1-a",
    bias: -0.80727166,
  };

  const mapped = mapRustCoordinatedOp(op);
  assertEquals(mapped, {
    type: "setBias",
    neuronUuid: "L1-a",
    bias: -0.80727166,
  });
});

Deno.test("mapRustCoordinatedOp maps a changeSquash operation", () => {
  const op: RustCoordinatedStructuralOperation = {
    type: "changeSquash",
    neuronUuid: "L1-a",
    squash: "TANH",
  };

  const mapped = mapRustCoordinatedOp(op);
  assertEquals(mapped, {
    type: "changeSquash",
    neuronUuid: "L1-a",
    squash: "TANH",
  });
});

Deno.test("mapRustCoordinatedOp maps a removeNeuron operation", () => {
  const op: RustCoordinatedStructuralOperation = {
    type: "removeNeuron",
    neuronUuid: "L1-a",
  };

  const mapped = mapRustCoordinatedOp(op);
  assertEquals(mapped, {
    type: "removeNeuron",
    neuronUuid: "L1-a",
  });
});

Deno.test("mapRustCoordinatedOp maps an addNeuron operation preserving optional placement hint", () => {
  const op: RustCoordinatedStructuralOperation = {
    type: "addNeuron",
    neuronUuid: "L1-a",
    neuronType: "hidden",
    squash: "TANH",
    bias: 0.1,
    insertBeforeNeuronUuid: "output-0",
  };

  const mapped = mapRustCoordinatedOp(op);
  assertEquals(mapped, {
    type: "addNeuron",
    neuronUuid: "L1-a",
    neuronType: "hidden",
    squash: "TANH",
    bias: 0.1,
    insertBeforeNeuronUuid: "output-0",
  });
});

Deno.test("mapRustCoordinatedOp maps an addNeuron operation without a placement hint", () => {
  const op: RustCoordinatedStructuralOperation = {
    type: "addNeuron",
    neuronUuid: "L1-a",
    neuronType: "output",
    squash: "IDENTITY",
    bias: 0,
  };

  const mapped = mapRustCoordinatedOp(op);
  assertEquals(mapped, {
    type: "addNeuron",
    neuronUuid: "L1-a",
    neuronType: "output",
    squash: "IDENTITY",
    bias: 0,
    insertBeforeNeuronUuid: undefined,
  });
});

Deno.test("mapRustCoordinatedOp throws on an unmapped variant instead of casting silently", () => {
  // Simulate malformed wire data / a genuinely-unknown variant that escaped the
  // type system. The `default` branch must still assert rather than pass it
  // through. (`setWeight` is now a real, mapped variant — see Issue #3250 — so
  // an unmistakably-bogus discriminant is used here.)
  const rogue = { type: "teleportNeuron", neuronUuid: "a" };

  assertThrows(
    () =>
      mapRustCoordinatedOp(
        rogue as unknown as RustCoordinatedStructuralOperation,
      ),
    Error,
    "Unhandled variant",
  );
});
