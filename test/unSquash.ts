import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { fail } from "https://deno.land/std@0.210.0/assert/mod.ts";
import { ActivationInterface } from "../src/methods/activations/ActivationInterface.ts";
import { Activations } from "../src/methods/activations/Activations.ts";
import { UnSquashInterface } from "../src/methods/activations/UnSquashInterface.ts";
import { BIPOLAR_SIGMOID } from "../src/methods/activations/types/BIPOLAR_SIGMOID.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";
import { INVERSE } from "../src/methods/activations/types/INVERSE.ts";
import { LOGISTIC } from "../src/methods/activations/types/LOGISTIC.ts";
import { Mish } from "../src/methods/activations/types/Mish.ts";
import { TANH } from "../src/methods/activations/types/TANH.ts";

function makeValues() {
  const values: number[] = [];
  values.push(0);
  values.push(-1);
  values.push(1);

  for (let i = 0; i < 1000; i++) {
    values.push(Math.random() * 3 - 1.5);
  }

  return values;
}

function check(squashName: string, values: number[]) {
  const squash = Activations.find(squashName);

  if ((squash as ActivationInterface).squash !== undefined) {
    const tmpSquash = squash as ActivationInterface;

    values.forEach((v) => {
      const activation = tmpSquash.squash(v);

      let tmpValue = activation;
      if ((squash as UnSquashInterface).unSquash != undefined) {
        tmpValue = (squash as UnSquashInterface).unSquash(activation);
      }

      const percentage = Math.abs((tmpValue - v) / (v + Number.EPSILON)) * 100;
      assert(
        percentage < 1,
        `${tmpSquash.getName()} Value ${v.toFixed(3)} -> Squash ${
          activation.toFixed(3)
        } -> UnSquashed ${tmpValue.toFixed(3)} error of ${
          percentage.toFixed(2)
        }%`,
      );
    });
  } else {
    fail("Not done yet");
  }
}

Deno.test("Mish", () => {
  const activation = Activations.find(Mish.NAME) as UnSquashInterface;
  const values = [1000, -1000];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(Number.isFinite(tmpValue), `Mish ${v} not finite ${tmpValue}`);
  });
});

Deno.test("unSquash", () => {
  const list = [
    // BENT_IDENTITY.NAME,
    LOGISTIC.NAME,
    INVERSE.NAME,
    IDENTITY.NAME,
    BIPOLAR_SIGMOID.NAME,
    TANH.NAME,
    // Mish.NAME,
  ];

  const values = makeValues();

  list.forEach((name) => {
    check(name, values);
  });
});
