/**
 * Unit tests for the costName -> TaskDescriptor mapping helper
 * introduced for Issue #2787 (which depends on Issue #2786).
 *
 * The helper is intentionally pure: given a cost name string it returns the
 * canonical descriptor (topology, range, output squash family). Custom or
 * unrecognised names map to the sentinel `OTHER` + a neutral descriptor and
 * never echo the caller-supplied name back to the descriptor.
 */

import { assertEquals, assertNotStrictEquals } from "@std/assert";
import {
  costNameToTaskDescriptor,
  isCostAware,
  type TaskDescriptor,
} from "@costs/CostDescriptor.ts";
import { BUILT_IN_COST_NAMES } from "@costs";

Deno.test("costNameToTaskDescriptor - MSE maps to independent / unbounded / unbounded", () => {
  const descriptor = costNameToTaskDescriptor("MSE");
  assertEquals(
    descriptor,
    {
      costName: "MSE",
      topology: "independent",
      range: "unbounded",
      outputSquashFamily: "unbounded",
    } satisfies TaskDescriptor,
  );
});

Deno.test("costNameToTaskDescriptor - MAE maps to independent / unbounded / unbounded", () => {
  const descriptor = costNameToTaskDescriptor("MAE");
  assertEquals(descriptor.topology, "independent");
  assertEquals(descriptor.range, "unbounded");
  assertEquals(descriptor.outputSquashFamily, "unbounded");
});

Deno.test("costNameToTaskDescriptor - MAPE maps to independent / positive / positive", () => {
  const descriptor = costNameToTaskDescriptor("MAPE");
  assertEquals(descriptor.topology, "independent");
  assertEquals(descriptor.range, "positive");
  assertEquals(descriptor.outputSquashFamily, "positive");
});

Deno.test("costNameToTaskDescriptor - MSLE maps to independent / positive / positive", () => {
  const descriptor = costNameToTaskDescriptor("MSLE");
  assertEquals(descriptor.topology, "independent");
  assertEquals(descriptor.range, "positive");
  assertEquals(descriptor.outputSquashFamily, "positive");
});

Deno.test("costNameToTaskDescriptor - CROSS_ENTROPY maps to simplex / unit / bounded_unipolar", () => {
  const descriptor = costNameToTaskDescriptor("CROSS_ENTROPY");
  assertEquals(descriptor.topology, "simplex");
  assertEquals(descriptor.range, "unit");
  assertEquals(descriptor.outputSquashFamily, "bounded_unipolar");
});

Deno.test("costNameToTaskDescriptor - BINARY_CROSS_ENTROPY maps to independent / unit / bounded_unipolar", () => {
  // BINARY_CROSS_ENTROPY is not implemented as a Cost class in this repo, but
  // the mapping helper is the canonical place for its descriptor (Issue
  // #2786). When the cost is added later, the descriptor must already be in
  // sync.
  const descriptor = costNameToTaskDescriptor("BINARY_CROSS_ENTROPY");
  assertEquals(descriptor.topology, "independent");
  assertEquals(descriptor.range, "unit");
  assertEquals(descriptor.outputSquashFamily, "bounded_unipolar");
});

Deno.test("costNameToTaskDescriptor - HINGE maps to margin / signed_unit / bounded_bipolar", () => {
  const descriptor = costNameToTaskDescriptor("HINGE");
  assertEquals(descriptor.topology, "margin");
  assertEquals(descriptor.range, "signed_unit");
  assertEquals(descriptor.outputSquashFamily, "bounded_bipolar");
});

Deno.test("costNameToTaskDescriptor - CATEGORICAL_ERROR maps to one_hot / unit / bounded_unipolar", () => {
  const descriptor = costNameToTaskDescriptor("CATEGORICAL_ERROR");
  assertEquals(descriptor.topology, "one_hot");
  assertEquals(descriptor.range, "unit");
  assertEquals(descriptor.outputSquashFamily, "bounded_unipolar");
});

Deno.test("costNameToTaskDescriptor - unknown/custom cost maps to OTHER + neutral descriptor", () => {
  const descriptor = costNameToTaskDescriptor("MY_USER_DEFINED_COST");
  assertEquals(descriptor.costName, "OTHER");
  assertEquals(descriptor.topology, "unknown");
  assertEquals(descriptor.range, "unbounded");
  assertEquals(descriptor.outputSquashFamily, "any");
});

Deno.test("costNameToTaskDescriptor - the original custom name is never echoed back", () => {
  const descriptor = costNameToTaskDescriptor(
    "LEAKY_NAME_THAT_REVEALS_STRUCTURE",
  );
  assertNotStrictEquals(
    descriptor.costName,
    "LEAKY_NAME_THAT_REVEALS_STRUCTURE",
  );
  assertEquals(descriptor.costName, "OTHER");
});

Deno.test("costNameToTaskDescriptor - empty/unset name maps to OTHER", () => {
  assertEquals(costNameToTaskDescriptor("").costName, "OTHER");
  assertEquals(costNameToTaskDescriptor(undefined).costName, "OTHER");
});

Deno.test("costNameToTaskDescriptor - every built-in maps to a non-OTHER descriptor", () => {
  for (const name of BUILT_IN_COST_NAMES) {
    const descriptor = costNameToTaskDescriptor(name);
    assertEquals(
      descriptor.costName,
      name,
      `Built-in ${name} should map to its own descriptor, not OTHER`,
    );
  }
});

Deno.test("isCostAware - built-ins are cost-aware; OTHER is not", () => {
  assertEquals(isCostAware("MSE"), true);
  assertEquals(isCostAware("CATEGORICAL_ERROR"), true);
  assertEquals(isCostAware("CROSS_ENTROPY"), true);
  assertEquals(isCostAware("HINGE"), true);
  // Custom JS cost — must fall back to current ("OTHER") behaviour.
  assertEquals(isCostAware("MY_USER_DEFINED_COST"), false);
  assertEquals(isCostAware(undefined), false);
});
