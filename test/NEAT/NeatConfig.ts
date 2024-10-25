import { assertEquals, fail } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Selection } from "../../mod.ts";

Deno.test("NeatConfig debug", () => {
  const config = createNeatConfig({ debug: true });
  assertEquals(config.debug, true);
  const config2 = createNeatConfig({ debug: false });
  assertEquals(config2.debug, false);
});

Deno.test("NeatConfig mutationAmount", () => {
  try {
    createNeatConfig({ mutationAmount: -2 });
    fail("Should not reach here");
  } // deno-lint-ignore no-empty
  catch (_e) {
  }
});

Deno.test("NeatConfig selection", () => {
  const config = createNeatConfig({
    selection: Selection.FITNESS_PROPORTIONATE,
  });
  assertEquals(config.selection, Selection.FITNESS_PROPORTIONATE);
});

Deno.test("NeatConfig verbose", () => {
  const config = createNeatConfig({ verbose: true });
  assertEquals(config.verbose, true);
});
