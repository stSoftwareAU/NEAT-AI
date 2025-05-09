import { Activations } from "../src/methods/activations/Activations.ts";
import type { UnSquashInterface } from "../src/methods/activations/UnSquashInterface.ts";

const TEST_INPUTS = [0, 0.5, -0.5, 5, -5, 1e-8, -1e-8];

Activations.NAMES.forEach((name) => {
  const activation = Activations.find(name);

  const unSquashActivation = activation as UnSquashInterface;

  if (unSquashActivation.unSquash && unSquashActivation.derivative) {
    const limitedInputs = TEST_INPUTS.map((input) =>
      Math.max(
        Math.min(input, unSquashActivation.range.high),
        unSquashActivation.range.low,
      )
    );
    Deno.bench(`${name} - unSquash`, () => {
      for (const input of limitedInputs) {
        unSquashActivation.unSquash(input, input);
      }
    });

    Deno.bench(`${name} - derivative`, () => {
      for (const input of limitedInputs) {
        unSquashActivation.derivative!(input);
      }
    });
  }
});
