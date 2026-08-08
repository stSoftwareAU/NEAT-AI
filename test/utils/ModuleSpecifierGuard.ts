import { assert, assertStringIncludes, assertThrows } from "@std/assert";
import { ValidationError } from "@errors/ValidationError.ts";
import { assertLocalModuleSpecifier } from "@utils/ModuleSpecifierGuard.ts";

Deno.test("ModuleSpecifierGuard accepts relative specifiers", () => {
  assertLocalModuleSpecifier("./MyAdapter.ts", "adapter");
  assertLocalModuleSpecifier("../costs/MyCost.ts", "cost");
  assertLocalModuleSpecifier(".test/costs/customCost/cost.ts", "cost");
});

Deno.test("ModuleSpecifierGuard accepts absolute filesystem paths", () => {
  assertLocalModuleSpecifier("/tmp/adapters/MyAdapter.ts", "adapter");
  assertLocalModuleSpecifier("C:\\adapters\\MyAdapter.ts", "adapter");
});

Deno.test("ModuleSpecifierGuard accepts file: URLs", () => {
  assertLocalModuleSpecifier("file:///tmp/adapters/MyAdapter.ts", "adapter");
  assertLocalModuleSpecifier("FILE:///tmp/adapters/MyAdapter.ts", "adapter");
});

Deno.test("ModuleSpecifierGuard rejects remote schemes", () => {
  for (
    const specifier of [
      "https://evil.example/adapter.ts",
      "http://evil.example/adapter.ts",
      "data:text/javascript,export default class {}",
      "blob:https://evil.example/1234",
      "jsr:@evil/adapter",
      "npm:evil-adapter",
    ]
  ) {
    const error = assertThrows(
      () => assertLocalModuleSpecifier(specifier, "adapter"),
      ValidationError,
    );
    assertStringIncludes(error.message, "adapter");
  }
});

Deno.test("ModuleSpecifierGuard names the rejected scheme in the error", () => {
  const error = assertThrows(
    () => assertLocalModuleSpecifier("https://evil.example/a.ts", "adapter"),
    ValidationError,
  );
  assertStringIncludes(error.message, "https:");
});

Deno.test("ModuleSpecifierGuard rejects empty and blank specifiers", () => {
  for (const specifier of ["", "   "]) {
    assertThrows(
      () => assertLocalModuleSpecifier(specifier, "adapter"),
      ValidationError,
    );
  }
});

Deno.test("ModuleSpecifierGuard rejects non-string specifiers", () => {
  assertThrows(
    () =>
      assertLocalModuleSpecifier(
        undefined as unknown as string,
        "adapter",
      ),
    ValidationError,
  );
});

Deno.test("ModuleSpecifierGuard rejects a scheme hidden by surrounding whitespace", () => {
  assertThrows(
    () => assertLocalModuleSpecifier("  https://evil.example/a.ts ", "adapter"),
    ValidationError,
  );
});

Deno.test("ModuleSpecifierGuard error is a ValidationError with OTHER reason", () => {
  const error = assertThrows(
    () => assertLocalModuleSpecifier("https://evil.example/a.ts", "adapter"),
    ValidationError,
  );
  assert(error.reason === "OTHER");
});
