import { assertEquals, assertThrows } from "@std/assert";
import { mapRustCoordinatedOp } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverAnalysis.ts";
import type { RustCoordinatedStructuralOperation } from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

// Issue #3190: the `default` branch of `mapRustCoordinatedOp` previously cast
// silently (`op as CoordinatedStructuralOperation`). It now calls the project's
// exhaustiveness guard `assertNever`, so an unmapped Rust variant that escapes
// the type system (malformed wire data) fails loudly at runtime instead of
// being blessed through the boundary unmapped.

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

Deno.test("mapRustCoordinatedOp throws on an unmapped variant instead of casting silently", () => {
  // Simulate malformed wire data / a new Rust variant that escaped the type
  // system. The `default` branch must now assert rather than pass it through.
  const rogue = { type: "setWeight", fromNeuronUuid: "a", toNeuronUuid: "b" };

  assertThrows(
    () =>
      mapRustCoordinatedOp(
        rogue as unknown as RustCoordinatedStructuralOperation,
      ),
    Error,
    "Unhandled variant",
  );
});
