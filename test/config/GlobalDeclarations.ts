import { assertEquals } from "@std/assert";
import {
  getGlobalDebug,
  getSkipWasmAutoInit,
  setGlobalDebug,
  setSkipWasmAutoInit,
} from "../../src/globalAccessors.ts";

Deno.test("getGlobalDebug / setGlobalDebug round-trips correctly", () => {
  const original = getGlobalDebug();

  setGlobalDebug(true);
  assertEquals(getGlobalDebug(), true);

  setGlobalDebug(false);
  assertEquals(getGlobalDebug(), false);

  // Restore
  setGlobalDebug(original || undefined);
});

Deno.test("getSkipWasmAutoInit / setSkipWasmAutoInit round-trips correctly", () => {
  const original = getSkipWasmAutoInit();

  setSkipWasmAutoInit(true);
  assertEquals(getSkipWasmAutoInit(), true);

  setSkipWasmAutoInit(false);
  assertEquals(getSkipWasmAutoInit(), false);

  // Restore
  setSkipWasmAutoInit(original);
});
