import { assertStringIncludes, assertThrows } from "@std/assert";
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

Deno.test("assertNever - serialises a string-only value safely", () => {
  const err = assertThrows(
    () => assertNever("ninthVariant" as unknown as never),
    Error,
  );
  assertStringIncludes(err.message, "ninthVariant");
});
