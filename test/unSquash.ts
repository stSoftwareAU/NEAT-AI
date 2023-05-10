import {
  assertAlmostEquals,
  fail,
} from "https://deno.land/std@0.186.0/testing/asserts.ts";
import { ActivationInterface } from "../src/methods/activations/ActivationInterface.ts";
import { Activations } from "../src/methods/activations/Activations.ts";
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";
import { UnSquashInterface } from "../src/methods/activations/UnSquashInterface.ts";
import { INVERSE } from "../src/methods/activations/types/INVERSE.ts";
import { LOGISTIC } from "../src/methods/activations/types/LOGISTIC.ts";

function makeValues() {
  const values: number[] = [];
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

      assertAlmostEquals(
        v,
        tmpValue,
        0.0000001,
        `${tmpSquash.getName()} ${v} != ${tmpValue}`,
      );
    });
  } else {
    fail("Not done yet");
  }
}

Deno.test("unSquash", () => {
  const list = [
    // BENT_IDENTITY.NAME,
    LOGISTIC.NAME,
    INVERSE.NAME,
    IDENTITY.NAME,
  ];

  const values = makeValues();

  list.forEach((name) => {
    check(name, values);
  });
});
