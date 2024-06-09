import { assertEquals } from "@std/assert";
import { NeatConfig } from "../../src/config/NeatConfig.ts";

Deno.test("NeatConfig debug", () => {
    const config = new NeatConfig({debug:true});
    assertEquals(config.debug, true);
    const config2 = new NeatConfig({debug:false});
    assertEquals(config2.debug, false);
});