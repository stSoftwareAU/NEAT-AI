/**
 * Regression + contract tests for the cost {@link TaskDescriptor} FFI wire
 * mapper (Issue #3012).
 *
 * The #2785 regression happened because the internal snake_case descriptor was
 * forwarded to NEAT-AI-Discovery unchanged, so Rust failed with
 * `unknown variant 'unbounded'`. These tests lock the *serialised* wire shape
 * — PascalCase field names and enum variants — for every built-in cost plus the
 * neutral `OTHER` descriptor, and mirror the canonical golden payloads from
 * Discovery `tests/ffi/issue_1314_task_descriptor_plumbing.rs`.
 */
import { assert, assertEquals } from "@std/assert";
import {
  costNameToTaskDescriptor,
  OTHER_TASK_DESCRIPTOR,
} from "@costs/CostTaskDescriptor.ts";
import {
  type RustWireTaskDescriptor,
  taskDescriptorToRustWire,
} from "@costs/TaskDescriptorRustWire.ts";

/** Every built-in cost name carried by a canonical descriptor. */
const BUILT_IN_COST_NAMES = [
  "MSE",
  "MAE",
  "MAPE",
  "MSLE",
  "BINARY_CROSS_ENTROPY",
  "CROSS_ENTROPY",
  "HINGE",
] as const;

/** Allowed PascalCase enum values on the wire (no snake_case permitted). */
const ALLOWED_TOPOLOGIES = new Set([
  "Independent",
  "Simplex",
  "Margin",
  "OneHot",
  "Unknown",
]);
const ALLOWED_RANGES = new Set([
  "Unbounded",
  "Positive",
  "Unit",
  "SignedUnit",
]);
const ALLOWED_SQUASH = new Set([
  "Unbounded",
  "Positive",
  "BoundedUnipolar",
  "BoundedBipolar",
  "Any",
]);

Deno.test("taskDescriptorToRustWire emits only the Discovery contract fields (Issue #3012)", () => {
  for (const costName of [...BUILT_IN_COST_NAMES, "OTHER"]) {
    const wire = taskDescriptorToRustWire(
      costNameToTaskDescriptor(costName),
      1,
    );

    // Exactly the four contract fields — no internal-only fields leak.
    assertEquals(
      Object.keys(wire).sort(),
      ["numOutputs", "outputSquashFamily", "targetRange", "targetTopology"],
      `${costName} wire must carry only the Discovery contract fields`,
    );

    const serialised = JSON.parse(JSON.stringify(wire));
    assertEquals(
      "topology" in serialised,
      false,
      `${costName} wire must not include internal 'topology'`,
    );
    assertEquals(
      "range" in serialised,
      false,
      `${costName} wire must not include internal 'range'`,
    );
    assertEquals(
      "costName" in serialised,
      false,
      `${costName} wire must not include internal 'costName'`,
    );

    // Enum values are PascalCase variants Discovery can deserialise.
    assert(
      ALLOWED_TOPOLOGIES.has(wire.targetTopology),
      `${costName} targetTopology '${wire.targetTopology}' must be PascalCase`,
    );
    assert(
      ALLOWED_RANGES.has(wire.targetRange),
      `${costName} targetRange '${wire.targetRange}' must be PascalCase`,
    );
    assert(
      ALLOWED_SQUASH.has(wire.outputSquashFamily),
      `${costName} outputSquashFamily '${wire.outputSquashFamily}' must be PascalCase`,
    );
  }
});

Deno.test("taskDescriptorToRustWire MSE never serialises the snake_case 'unbounded' (Issue #3012 regression)", () => {
  // This is the exact regression: MSE's internal range + squash are both
  // 'unbounded' (snake_case); the wire must use 'Unbounded' (PascalCase).
  const wire = taskDescriptorToRustWire(costNameToTaskDescriptor("MSE"), 1);
  const json = JSON.stringify({ taskDescriptor: wire });

  assert(
    !json.includes('"unbounded"'),
    `MSE wire must not contain snake_case "unbounded": ${json}`,
  );
  assert(
    json.includes('"Unbounded"'),
    `MSE wire must use PascalCase "Unbounded": ${json}`,
  );
});

Deno.test("taskDescriptorToRustWire matches Discovery #1314 golden fixtures (Issue #3012)", () => {
  // Golden payloads mirrored from NEAT-AI-Discovery
  // tests/ffi/issue_1314_task_descriptor_plumbing.rs. Field names and enum
  // casing must match byte-for-byte (modulo numOutputs).
  const golden: Record<string, RustWireTaskDescriptor> = {
    MSE: {
      targetTopology: "Independent",
      targetRange: "Unbounded",
      outputSquashFamily: "Unbounded",
      numOutputs: 1,
    },
    CROSS_ENTROPY: {
      targetTopology: "Simplex",
      targetRange: "Unit",
      outputSquashFamily: "BoundedUnipolar",
      numOutputs: 3,
    },
    HINGE: {
      targetTopology: "Margin",
      targetRange: "SignedUnit",
      outputSquashFamily: "BoundedBipolar",
      numOutputs: 1,
    },
    OTHER: {
      targetTopology: "Unknown",
      targetRange: "Unbounded",
      outputSquashFamily: "Any",
      numOutputs: 2,
    },
  };

  for (const [costName, expected] of Object.entries(golden)) {
    const wire = taskDescriptorToRustWire(
      costNameToTaskDescriptor(costName),
      expected.numOutputs,
    );
    assertEquals(
      JSON.parse(JSON.stringify(wire)),
      expected,
      `${costName} wire must match the Discovery #1314 golden fixture`,
    );
  }
});

Deno.test("taskDescriptorToRustWire maps the neutral OTHER descriptor (Issue #3012)", () => {
  const wire = taskDescriptorToRustWire(OTHER_TASK_DESCRIPTOR, 4);
  assertEquals(wire, {
    targetTopology: "Unknown",
    targetRange: "Unbounded",
    outputSquashFamily: "Any",
    numOutputs: 4,
  });
});

Deno.test("taskDescriptorToRustWire clamps invalid numOutputs to zero (Issue #3012)", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const wire = taskDescriptorToRustWire(
      costNameToTaskDescriptor("MSE"),
      bad,
    );
    assertEquals(
      wire.numOutputs,
      0,
      `numOutputs ${bad} must clamp to 0`,
    );
  }
  // Fractional counts floor to an integer.
  assertEquals(
    taskDescriptorToRustWire(costNameToTaskDescriptor("MSE"), 2.9).numOutputs,
    2,
  );
});
