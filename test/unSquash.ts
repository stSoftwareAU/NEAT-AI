import { assert, assertAlmostEquals, fail } from "@std/assert";
import type { ActivationInterface } from "../src/methods/activations/ActivationInterface.ts";
import { Activations } from "../src/methods/activations/Activations.ts";
import type { UnSquashInterface } from "../src/methods/activations/UnSquashInterface.ts";
import { HYPOT } from "../src/methods/activations/aggregate/HYPOT.ts";
import { IF } from "../src/methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "../src/methods/activations/aggregate/MAXIMUM.ts";
import { MEAN } from "../src/methods/activations/aggregate/MEAN.ts";
import { MINIMUM } from "../src/methods/activations/aggregate/MINIMUM.ts";
import { BIPOLAR } from "../src/methods/activations/types/BIPOLAR.ts";
import { BIPOLAR_SIGMOID } from "../src/methods/activations/types/BIPOLAR_SIGMOID.ts";
import { Cosine } from "../src/methods/activations/types/Cosine.ts";
import { ELU } from "../src/methods/activations/types/ELU.ts";
import { GELU } from "../src/methods/activations/types/GELU.ts";
import { Mish } from "../src/methods/activations/types/Mish.ts";
import { RELU } from "../src/methods/activations/types/RELU.ts";
import { ReLU6 } from "../src/methods/activations/types/ReLU6.ts";
import { SELU } from "../src/methods/activations/types/SELU.ts";
import { SOFTSIGN } from "../src/methods/activations/types/SOFTSIGN.ts";
import { STEP } from "../src/methods/activations/types/STEP.ts";
import { Swish } from "../src/methods/activations/types/Swish.ts";
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
      let tolerancePercent = 0.01;
      let expected = v;
      let hint: number | undefined = undefined;
      switch (squashName) {
        case "ABSOLUTE":
          if (v < 0) {
            hint = -1;
          } else if (v > 1) {
            hint = 1;
          }
          break;
        case "BIPOLAR":
          expected = v > 0 ? 1 : -1;
          break;
        case "CLIPPED":
          if (v < -1) {
            expected = -1;
          } else if (v > 1) {
            expected = 1;
          }
          break;
        case "Cosine":
          if (v < 0) {
            hint = -1;
          } else {
            hint = 1;
          }
          break;
        case GELU.NAME:
          tolerancePercent = 90;
          break;
        case "GAUSSIAN":
          if (v < 0) {
            hint = -1;
          } else {
            hint = 1;
          }
          break;
        case "HARD_TANH":
          if (v < -1) {
            expected = -1;
          } else if (v > 1) {
            expected = 1;
          }
          break;
        case "Mish":
          tolerancePercent = 50;
          if (v < 0) {
            hint = v - Number.EPSILON;
          }
          break;
        case RELU.NAME:
        case ReLU6.NAME:
          if (v < 0) {
            hint = v;
          }
          break;
        case "STEP":
          expected = v > 0 ? 1 : 0;
          break;
        case "Swish":
          if (v < 0) {
            hint = v - Number.EPSILON;
          }
          tolerancePercent = 1;
          break;

        default:
          tolerancePercent = 1;
      }

      const activation = tmpSquash.squash(v);

      let tmpValue = activation;
      if ((squash as UnSquashInterface).unSquash != undefined) {
        tmpValue = (squash as UnSquashInterface).unSquash(activation, hint);
      }

      const percentage = Math.abs(
        (tmpValue - expected) < 0.0001
          ? 0
          : (tmpValue - expected) / (expected + Number.EPSILON),
      ) * 100;

      const options = hint === undefined ? "" : " hint=" + hint.toFixed(3);
      assert(
        percentage <= tolerancePercent + 1e-7,
        `Activation '${tmpSquash.getName()}' Value ${v.toFixed(3)} -> Squash ${
          activation.toFixed(3)
        } -> UnSquashed ${tmpValue.toFixed(3)}${options} error of ${
          percentage.toFixed(2)
        }% is greater than tolerance of ${tolerancePercent}%`,
      );
    });
  } else {
    fail(`${squashName} not implemented yet`);
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

Deno.test("STEP unSquash", () => {
  const step = Activations.find(STEP.NAME) as UnSquashInterface;

  // For slight positive activations close to 1, expect a value above the threshold
  assertAlmostEquals(step.unSquash(0.2), 0.2);
  assertAlmostEquals(step.unSquash(0.2, -0.2), 0.2); // Negative hint is ignored because activation suggests a positive input

  // For negative activations, if hint aligns (less than threshold), use the hint
  // assertAlmostEquals(step.unSquash(-0.1, -0.3), -0.3);
  // For clear activations of 1, and a positive hint, use the hint
  assertAlmostEquals(step.unSquash(1, 0.3), 0.3);
});

Deno.test("SELU", () => {
  const activation = Activations.find(SELU.NAME) as UnSquashInterface;
  const values = [-1.7580993408473766];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(Number.isFinite(tmpValue), `SELU ${v} not finite ${tmpValue}`);
  });
});

Deno.test("BIPOLAR_SIGMOID", () => {
  const activation = Activations.find(
    BIPOLAR_SIGMOID.NAME,
  ) as UnSquashInterface;
  const values = [1];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(
      Number.isFinite(tmpValue),
      `BIPOLAR_SIGMOID ${v} not finite ${tmpValue}`,
    );
  });

  const v = activation.unSquash(1, 0.3);

  assert(v === 0.3, `BIPOLAR_SIGMOID hint not working ${v}`);
});

Deno.test("BIPOLAR", () => {
  const activation = Activations.find(
    BIPOLAR.NAME,
  ) as UnSquashInterface;
  const values = [1];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(
      Number.isFinite(tmpValue),
      `${activation.getName()} ${v} not finite ${tmpValue}`,
    );
  });

  const v = activation.unSquash(1, 0.3);

  assert(v === 0.3, `${activation.getName()} hint not working ${v}`);
});

// Deno.test("CLIPPED", () => {
//   const activation = Activations.find(
//     CLIPPED.NAME,
//   ) as UnSquashInterface;

//   const v = activation.unSquash(1, 1.3);

//   assert(v === 1.3, `${activation.getName()} hint not working ${v}`);
//   const v2 = activation.unSquash(-1, -1.3);

//   assert(v2 === -1.3, `${activation.getName()} hint not working ${v2}`);
// });

Deno.test("ELU", () => {
  const activation = Activations.find(
    ELU.NAME,
  ) as UnSquashInterface;
  const values = [-1, -1.2026306030839375];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(
      Number.isFinite(tmpValue),
      `${activation.getName()} ${v} not finite ${tmpValue}`,
    );
  });
});

Deno.test("Cosine", () => {
  const activation = Activations.find(
    Cosine.NAME,
  ) as UnSquashInterface;
  const values = [-1, 0, 1];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(
      Number.isFinite(tmpValue),
      `${activation.getName()} ${v} not finite ${tmpValue}`,
    );
  });
});

Deno.test("SOFTSIGN", () => {
  const activation = Activations.find(
    SOFTSIGN.NAME,
  ) as UnSquashInterface;
  const range = activation.range;
  const values = [range.high, range.low];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(
      Number.isFinite(tmpValue),
      `${activation.getName()} ${v} not finite ${tmpValue}`,
    );
  });
});

Deno.test("TANH", () => {
  const activation = Activations.find(
    TANH.NAME,
  ) as UnSquashInterface;

  const values = [1, -1];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(
      Number.isFinite(tmpValue),
      `${activation.getName()} ${v} not finite ${tmpValue}`,
    );
  });
});

Deno.test("Swish", () => {
  const activation = Activations.find(
    Swish.NAME,
  ) as UnSquashInterface;

  const values = [-38662.65331045061];
  values.forEach((v) => {
    const tmpValue = activation.unSquash(v);
    assert(
      Number.isFinite(tmpValue),
      `${activation.getName()} ${v} not finite ${tmpValue}`,
    );
  });
});

Deno.test("unSquash", () => {
  const values = makeValues();

  Activations.NAMES.forEach((name) => {
    if (
      name == MINIMUM.NAME ||
      name == MAXIMUM.NAME ||
      name == HYPOT.NAME ||
      name == MEAN.NAME ||
      name == IF.NAME
    ) {
      return;
    }
    check(name, values);
    checkKnownActivations(name);
    checkKnownValues(name);
  });
});

function checkKnownActivations(squashName: string) {
  const squash = Activations.find(squashName) as UnSquashInterface;
  const range = squash.range;
  const activations = [
    -1000,
    0,
    -0,
    1000,
    Number.EPSILON,
    Number.EPSILON * -1,
    -1,
    1,
    2,
    -2,
    10,
    -10,
    23.214287510522993,
    0.6411813868085767,
    -0.6411813868085767,
    1e-15,
    -1e-15,
    1e-16,
    -1e-16,
    3.7853263272041134e+306,
    Number.MAX_VALUE,
    Number.MIN_VALUE,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    Math.PI,
    Math.E,
    Math.PI * -1,
    Math.E * -1,
    Math.SQRT2,
    Math.SQRT2 * -1,
    Math.SQRT1_2,
    Math.SQRT1_2 * -1,
    Math.LN2,
    Math.LN2 * -1,
    Math.LN10,
    Math.LN10 * -1,
    Math.LOG2E,
    Math.LOG2E * -1,
    Math.LOG10E,
    Math.LOG10E * -1,

    range.high,
    range.low,
  ];
  activations.forEach((activation) => {
    if (
      Number.isFinite(activation) && activation >= range.low &&
      activation <= range.high
    ) {
      squash.range.validate(activation);
      const tmpValue = squash.unSquash(activation);
      assert(
        Number.isFinite(tmpValue),
        `${squashName} unSquash ${activation} not finite ${tmpValue}`,
      );
    }

    const squasher = (squash as unknown) as ActivationInterface;
    if (squasher.squash !== undefined) {
      const squashedValue = squasher.squash(activation);
      squasher.range.validate(squashedValue);
      squash.unSquash(squashedValue);
    }
  });
}

function checkKnownValues(squashName: string) {
  const squasher = Activations.find(squashName) as ActivationInterface;
  const values = [
    -10_000,
    0,
    10_000,
    1.3662467824954013e+304,
    -1.3662467824954013e+304,
  ];
  values.forEach((value) => {
    const tmpValue = squasher.squash(value);
    assert(
      Number.isFinite(tmpValue),
      `${squashName} ${value} not finite was: ${tmpValue}`,
    );
  });
}
