import { assert, assertEquals } from "@std/assert";
import { BUILT_IN_COST_NAMES } from "@costs";
import {
  costNameToTaskDescriptor,
  OTHER_COST_NAME,
  OTHER_TASK_DESCRIPTOR,
  type TaskDescriptor,
} from "@costs/CostTaskDescriptor.ts";

/** Expected descriptors per the table in Issue #2786. */
const EXPECTED: ReadonlyArray<TaskDescriptor> = [
  {
    costName: "MSE",
    topology: "independent",
    range: "unbounded",
    outputSquashFamily: "unbounded",
  },
  {
    costName: "MAE",
    topology: "independent",
    range: "unbounded",
    outputSquashFamily: "unbounded",
  },
  {
    costName: "MAPE",
    topology: "independent",
    range: "positive",
    outputSquashFamily: "positive",
  },
  {
    costName: "MSLE",
    topology: "independent",
    range: "positive",
    outputSquashFamily: "positive",
  },
  {
    costName: "BINARY_CROSS_ENTROPY",
    topology: "independent",
    range: "unit",
    outputSquashFamily: "bounded_unipolar",
  },
  {
    costName: "CROSS_ENTROPY",
    topology: "simplex",
    range: "unit",
    outputSquashFamily: "bounded_unipolar",
  },
  {
    costName: "HINGE",
    topology: "margin",
    range: "signed_unit",
    outputSquashFamily: "bounded_bipolar",
  },
  {
    costName: "CATEGORICAL_ERROR",
    topology: "one_hot",
    range: "unit",
    outputSquashFamily: "bounded_unipolar",
  },
];

for (const expected of EXPECTED) {
  Deno.test(`costNameToTaskDescriptor - maps ${expected.costName} per the table`, () => {
    assertEquals(costNameToTaskDescriptor(expected.costName), expected);
  });
}

Deno.test("costNameToTaskDescriptor - every registered built-in maps to a non-OTHER descriptor with its own name", () => {
  for (const name of BUILT_IN_COST_NAMES) {
    const descriptor = costNameToTaskDescriptor(name);
    assertEquals(
      descriptor.costName,
      name,
      `built-in ${name} should echo its canonical name`,
    );
    assert(
      descriptor.topology !== "unknown",
      `built-in ${name} should not collapse to the unknown topology`,
    );
  }
});

Deno.test("costNameToTaskDescriptor - unknown cost returns the neutral OTHER descriptor", () => {
  const descriptor = costNameToTaskDescriptor("NOT_A_REAL_COST");
  assertEquals(descriptor, OTHER_TASK_DESCRIPTOR);
  assertEquals(descriptor.costName, OTHER_COST_NAME);
  assertEquals(descriptor.topology, "unknown");
  assertEquals(descriptor.range, "unbounded");
  assertEquals(descriptor.outputSquashFamily, "any");
});

Deno.test("costNameToTaskDescriptor - custom cost name is never reflected back", () => {
  const secretName = "topSecretProprietaryLoss_v42";
  const descriptor = costNameToTaskDescriptor(secretName);

  assertEquals(descriptor.costName, OTHER_COST_NAME);
  // The real custom name must not appear anywhere in the emitted descriptor.
  assert(
    !JSON.stringify(descriptor).includes(secretName),
    "custom cost name leaked into the descriptor",
  );
});

Deno.test("costNameToTaskDescriptor - empty string maps to OTHER", () => {
  assertEquals(costNameToTaskDescriptor(""), OTHER_TASK_DESCRIPTOR);
});

Deno.test("costNameToTaskDescriptor - prototype member names do not resolve to descriptors", () => {
  for (
    const key of ["toString", "constructor", "hasOwnProperty", "__proto__"]
  ) {
    const descriptor = costNameToTaskDescriptor(key);
    assertEquals(
      descriptor,
      OTHER_TASK_DESCRIPTOR,
      `lookup of prototype member ${key} should be OTHER`,
    );
  }
});

Deno.test("costNameToTaskDescriptor - returned descriptor is immutable", () => {
  const descriptor = costNameToTaskDescriptor("MSE");
  assert(Object.isFrozen(descriptor), "built-in descriptor should be frozen");
  assert(
    Object.isFrozen(OTHER_TASK_DESCRIPTOR),
    "OTHER descriptor should be frozen",
  );
});

Deno.test("costNameToTaskDescriptor - non-string input maps to OTHER", () => {
  // deno-lint-ignore no-explicit-any
  const descriptor = costNameToTaskDescriptor(undefined as any);
  assertEquals(descriptor, OTHER_TASK_DESCRIPTOR);
});
