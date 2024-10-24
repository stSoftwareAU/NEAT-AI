import { assertEquals } from "@std/assert";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Selection } from "../../mod.ts";

Deno.test("NeatConfig debug", () => {
  const config = createNeatConfig({ debug: true });
  assertEquals(config.debug, true);
  const config2 = createNeatConfig({ debug: false });
  assertEquals(config2.debug, false);
});

Deno.test("NeatConfig mutationAmount", () => {
  const config = createNeatConfig({ mutationAmount: -2 });
  assertEquals(config.mutationAmount, 1);
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
