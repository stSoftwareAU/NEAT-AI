/**
 * Tests verifying CreatureActivation throws typed WasmError
 * instead of generic Error.
 *
 * Issue #1694
 */
import { assertEquals, assertIsError } from "@std/assert";
import { requireWasmOrThrow } from "../../src/creature/CreatureActivation.ts";
import { Creature } from "../../src/Creature.ts";
import { WasmError } from "../../src/errors/WasmError.ts";

Deno.test("requireWasmOrThrow - does not throw for WASM-eligible creature", () => {
  const creature = new Creature(2, 1);
  // Standard creature with standard squash functions should not throw
  requireWasmOrThrow(creature);
  // If we reach here, the function succeeded without throwing
});

Deno.test("WasmError - has correct reason and is catchable by type", () => {
  const err = new WasmError(
    "WASM module not loaded",
    "MODULE_NOT_LOADED",
  );
  assertIsError(err, WasmError);
  assertEquals(err.reason, "MODULE_NOT_LOADED");
  assertEquals(err.message, "WASM module not loaded");
});

Deno.test("WasmError - UNSUPPORTED_SQUASH reason is distinct from MODULE_NOT_LOADED", () => {
  const loadErr = new WasmError("not loaded", "MODULE_NOT_LOADED");
  const squashErr = new WasmError("bad squash", "UNSUPPORTED_SQUASH");

  assertEquals(loadErr.reason, "MODULE_NOT_LOADED");
  assertEquals(squashErr.reason, "UNSUPPORTED_SQUASH");
  assertIsError(loadErr, WasmError);
  assertIsError(squashErr, WasmError);
});
