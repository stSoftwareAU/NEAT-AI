import { assertNotEquals } from "@std/assert";
import { Activations } from "@methods/activations/Activations.ts";

Deno.test("pickRandomSquash: never returns excluded squash type", () => {
  const excluded = "RELU";
  for (let i = 0; i < 100; i++) {
    const result = Activations.pickRandomSquash(excluded);
    assertNotEquals(result, excluded);
  }
});
