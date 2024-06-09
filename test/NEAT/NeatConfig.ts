import { assertEquals } from "@std/assert";
import { NeatConfig } from "../../src/config/NeatConfig.ts";
import { Selection } from "../../mod.ts";

Deno.test("NeatConfig debug", () => {
    const config = new NeatConfig({debug:true});
    assertEquals(config.debug, true);
    const config2 = new NeatConfig({debug:false});
    assertEquals(config2.debug, false);
});

Deno.test("NeatConfig mutationAmount", () => {
    const config = new NeatConfig({mutationAmount:-2});
    assertEquals(config.mutationAmount, 1);
});

Deno.test("NeatConfig selection", () => {
    const config = new NeatConfig({selection:Selection.FITNESS_PROPORTIONATE});
    assertEquals(config.selection, Selection.FITNESS_PROPORTIONATE);
});


Deno.test("NeatConfig verbose", () => {
    const config = new NeatConfig({verbose:true});
    assertEquals(config.verbose, true);
});