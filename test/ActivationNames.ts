import { assert, assertNotEquals } from "@std/assert";
import { Activations } from "../src/methods/activations/Activations.ts";

Deno.test("ActivationNames", () => {
  Activations.NAMES.forEach((name) => {
    const activation = Activations.find(name);

    assert(activation !== undefined, `Could not find activation for ${name}`);
    assertNotEquals(name, "INVERSE", "INVERSE is not a valid activation");
  });

  const inverse = Activations.find("INVERSE");
  assert(inverse !== undefined, `Could not find activation for INVERSE`);
});
