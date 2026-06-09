import { assert, assertStringIncludes, assertThrows } from "@std/assert";
import { assertNever } from "@utils/assertNever.ts";

Deno.test("assertNever - throws with the offending value embedded", () => {
  // Cast through `never`: this is the runtime escape-hatch path that fires when
  // malformed data slips past the compiler's exhaustiveness check.
  const rogue = { type: "eighthVariant", payload: 42 } as unknown as never;
  const err = assertThrows(
    () => assertNever(rogue),
    Error,
  );
  assertStringIncludes(err.message, "Unhandled variant");
  assertStringIncludes(err.message, "eighthVariant");
  assertStringIncludes(err.message, "42");
});

Deno.test("assertNever - exhaustive switch never reaches the guard", () => {
  type Op = { type: "a" } | { type: "b" };

  function handle(op: Op): string {
    switch (op.type) {
      case "a":
        return "handled-a";
      case "b":
        return "handled-b";
      default:
        return assertNever(op);
    }
  }

  assert(handle({ type: "a" }) === "handled-a");
  assert(handle({ type: "b" }) === "handled-b");
});

Deno.test("assertNever - serialises a string-only value safely", () => {
  const err = assertThrows(
    () => assertNever("ninthVariant" as unknown as never),
    Error,
  );
  assertStringIncludes(err.message, "ninthVariant");
});
