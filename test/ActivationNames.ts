import { assertNotEquals } from "@std/assert";
import { Activations } from "../src/methods/activations/Activations.ts";

// Deno.test("ActivationNames", () => {
//   Activations.NAMES.forEach((name) => {
//     const activation = Activations.find(name);

//     assert(activation !== undefined, `Could not find activation for ${name}`);
//     assertNotEquals(name, "INVERSE", "INVERSE is not a valid activation");
//   });

//   const inverse = Activations.find("INVERSE");
//   assert(inverse !== undefined, `Could not find activation for INVERSE`);
// });

// Deno.test("pickRandomWeighted always returns valid squash", () => {
//   for (let i = 0; i < 100; i++) {
//     const name = Activations.pickRandomWeighted();
//     assert(Activations.NAMES.includes(name));
//   }
// });

Deno.test("pickRandomWeighted never returns excluded squash", () => {
  const excluded = "RELU";
  for (let i = 0; i < 100; i++) {
    const result = Activations.pickRandomSquash(excluded);
    assertNotEquals(result, excluded);
  }
});
