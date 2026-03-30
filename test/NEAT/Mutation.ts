import { assert, assertEquals } from "@std/assert";
import { Mutation } from "@neat/Mutation.ts";

/**
 * Unit tests for Mutation.ts — mutation strategy definitions.
 *
 * Issue #1749: Verify that the Mutation object contains all expected
 * strategies, collections are correct subsets, and the object is
 * properly frozen for immutability.
 */

// ============================================================================
// Individual Mutation Strategies
// ============================================================================

Deno.test("Mutation: all individual strategies have correct names", () => {
  const expectedNames = [
    "ADD_NODE",
    "SUB_NODE",
    "ADD_CONN",
    "SUB_CONN",
    "MOD_WEIGHT",
    "MOD_BIAS",
    "MOD_SQUASH",
    "ADD_SELF_CONN",
    "SUB_SELF_CONN",
    "ADD_BACK_CONN",
    "SUB_BACK_CONN",
    "SWAP_NODES",
  ];

  for (const name of expectedNames) {
    const strategy = Mutation[name as keyof typeof Mutation] as {
      name: string;
    };
    assertEquals(
      strategy.name,
      name,
      `Strategy ${name} should have matching name property`,
    );
  }
});

Deno.test("Mutation: individual strategies are frozen", () => {
  assert(Object.isFrozen(Mutation.ADD_NODE), "ADD_NODE should be frozen");
  assert(Object.isFrozen(Mutation.SUB_NODE), "SUB_NODE should be frozen");
  assert(Object.isFrozen(Mutation.ADD_CONN), "ADD_CONN should be frozen");
  assert(Object.isFrozen(Mutation.SUB_CONN), "SUB_CONN should be frozen");
  assert(Object.isFrozen(Mutation.MOD_WEIGHT), "MOD_WEIGHT should be frozen");
  assert(Object.isFrozen(Mutation.MOD_BIAS), "MOD_BIAS should be frozen");
  assert(Object.isFrozen(Mutation.MOD_SQUASH), "MOD_SQUASH should be frozen");
  assert(
    Object.isFrozen(Mutation.ADD_SELF_CONN),
    "ADD_SELF_CONN should be frozen",
  );
  assert(
    Object.isFrozen(Mutation.SUB_SELF_CONN),
    "SUB_SELF_CONN should be frozen",
  );
  assert(
    Object.isFrozen(Mutation.ADD_BACK_CONN),
    "ADD_BACK_CONN should be frozen",
  );
  assert(
    Object.isFrozen(Mutation.SUB_BACK_CONN),
    "SUB_BACK_CONN should be frozen",
  );
  assert(
    Object.isFrozen(Mutation.SWAP_NODES),
    "SWAP_NODES should be frozen",
  );
});

// ============================================================================
// Mutation Object Immutability
// ============================================================================

Deno.test("Mutation: top-level object is frozen", () => {
  assert(Object.isFrozen(Mutation), "Mutation object should be frozen");
});

// ============================================================================
// FFW Collection
// ============================================================================

Deno.test("Mutation: FFW contains exactly 8 forward-feed strategies", () => {
  assertEquals(Mutation.FFW.length, 8, "FFW should have 8 strategies");
});

Deno.test("Mutation: FFW contains correct strategy names", () => {
  const ffwNames = Mutation.FFW.map((m) => m.name).sort();
  const expected = [
    "ADD_CONN",
    "ADD_NODE",
    "MOD_BIAS",
    "MOD_SQUASH",
    "MOD_WEIGHT",
    "SUB_CONN",
    "SUB_NODE",
    "SWAP_NODES",
  ];
  assertEquals(ffwNames, expected, "FFW should contain forward-feed mutations");
});

Deno.test("Mutation: FFW excludes self and back connection strategies", () => {
  const ffwNames = Mutation.FFW.map((m) => m.name);
  assert(
    !ffwNames.includes("ADD_SELF_CONN"),
    "FFW should not include ADD_SELF_CONN",
  );
  assert(
    !ffwNames.includes("SUB_SELF_CONN"),
    "FFW should not include SUB_SELF_CONN",
  );
  assert(
    !ffwNames.includes("ADD_BACK_CONN"),
    "FFW should not include ADD_BACK_CONN",
  );
  assert(
    !ffwNames.includes("SUB_BACK_CONN"),
    "FFW should not include SUB_BACK_CONN",
  );
});

Deno.test("Mutation: FFW is frozen", () => {
  assert(Object.isFrozen(Mutation.FFW), "FFW array should be frozen");
});

// ============================================================================
// ALL Collection
// ============================================================================

Deno.test("Mutation: ALL contains exactly 12 strategies", () => {
  assertEquals(Mutation.ALL.length, 12, "ALL should have 12 strategies");
});

Deno.test("Mutation: ALL contains all strategy names", () => {
  const allNames = Mutation.ALL.map((m) => m.name).sort();
  const expected = [
    "ADD_BACK_CONN",
    "ADD_CONN",
    "ADD_NODE",
    "ADD_SELF_CONN",
    "MOD_BIAS",
    "MOD_SQUASH",
    "MOD_WEIGHT",
    "SUB_BACK_CONN",
    "SUB_CONN",
    "SUB_NODE",
    "SUB_SELF_CONN",
    "SWAP_NODES",
  ];
  assertEquals(allNames, expected, "ALL should contain every mutation type");
});

Deno.test("Mutation: ALL is a superset of FFW", () => {
  const allNames = new Set(Mutation.ALL.map((m) => m.name));
  for (const ffw of Mutation.FFW) {
    assert(
      allNames.has(ffw.name),
      `ALL should contain FFW strategy ${ffw.name}`,
    );
  }
});

Deno.test("Mutation: ALL is frozen", () => {
  assert(Object.isFrozen(Mutation.ALL), "ALL array should be frozen");
});

// ============================================================================
// Unique Names
// ============================================================================

Deno.test("Mutation: ALL has no duplicate names", () => {
  const names = Mutation.ALL.map((m) => m.name);
  const unique = new Set(names);
  assertEquals(unique.size, names.length, "ALL should have no duplicate names");
});

Deno.test("Mutation: FFW has no duplicate names", () => {
  const names = Mutation.FFW.map((m) => m.name);
  const unique = new Set(names);
  assertEquals(unique.size, names.length, "FFW should have no duplicate names");
});
