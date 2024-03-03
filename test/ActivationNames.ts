import { fail } from "https://deno.land/std@0.218.0/assert/fail.ts";
import { Activations } from "../src/methods/activations/Activations.ts";

Deno.test("ActivationNames", () => {
  Activations.NAMES.forEach((name) => {
    const activation = Activations.find(name);
    if (!activation) {
      throw new Error(`Could not find activation for ${name}`);
    }

    if (name == "INVERSE") {
      fail("INVERSE is not a valid activation");
    }
  });

  const inverse = Activations.find("INVERSE");
  if (!inverse) {
    throw new Error(`Could not find activation for INVERSE`);
  }
});
