import { assertEquals, assertThrows } from "@std/assert";
import { ActivationError } from "../../../src/errors/ActivationError.ts";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";
import { COMPLEMENT } from "../../../src/methods/activations/types/COMPLEMENT.ts";
import { HARD_TANH } from "../../../src/methods/activations/types/HARD_TANH.ts";
import { LeakyReLU } from "../../../src/methods/activations/types/LeakyReLU.ts";
import { LOGISTIC } from "../../../src/methods/activations/types/LOGISTIC.ts";
import { LogSigmoid } from "../../../src/methods/activations/types/LogSigmoid.ts";
import { Mish } from "../../../src/methods/activations/types/Mish.ts";
import { ReLU } from "../../../src/methods/activations/types/ReLU.ts";
import { ReLU6 } from "../../../src/methods/activations/types/ReLU6.ts";
import { SINE } from "../../../src/methods/activations/types/SINE.ts";
import { SOFTSIGN } from "../../../src/methods/activations/types/SOFTSIGN.ts";
import { Softplus } from "../../../src/methods/activations/types/Softplus.ts";
import { STEP } from "../../../src/methods/activations/types/STEP.ts";
import { TAN } from "../../../src/methods/activations/types/TAN.ts";
import { TANH } from "../../../src/methods/activations/types/TANH.ts";

// Tests verifying that activation functions throw ActivationError instead of
// generic Error for non-finite inputs.

const derivativeActivations = [
  { name: "ReLU", instance: new ReLU() },
  { name: "TANH", instance: new TANH() },
  { name: "Mish", instance: new Mish() },
  { name: "Softplus", instance: new Softplus() },
  { name: "TAN", instance: new TAN() },
  { name: "LogSigmoid", instance: new LogSigmoid() },
  { name: "COMPLEMENT", instance: new COMPLEMENT() },
  { name: "STEP", instance: new STEP() },
  { name: "SOFTSIGN", instance: new SOFTSIGN() },
  { name: "ReLU6", instance: new ReLU6() },
  { name: "HARD_TANH", instance: new HARD_TANH() },
  { name: "LeakyReLU", instance: new LeakyReLU() },
  { name: "LOGISTIC", instance: new LOGISTIC() },
  { name: "SINE", instance: new SINE() },
];

for (const { name, instance } of derivativeActivations) {
  Deno.test(`${name}.derivative(NaN) throws ActivationError`, () => {
    assertThrows(
      () => instance.derivative(NaN),
      ActivationError,
    );
  });

  Deno.test(`${name}.derivative(Infinity) throws ActivationError`, () => {
    assertThrows(
      () => instance.derivative(Infinity),
      ActivationError,
    );
  });

  Deno.test(`${name}.derivative(-Infinity) throws ActivationError`, () => {
    assertThrows(
      () => instance.derivative(-Infinity),
      ActivationError,
    );
  });
}

Deno.test("TAN.unSquash(NaN) throws ActivationError", () => {
  const tan = new TAN();
  assertThrows(
    () => tan.unSquash(NaN),
    ActivationError,
  );
});

Deno.test("TAN.unSquash(Infinity) throws ActivationError", () => {
  const tan = new TAN();
  assertThrows(
    () => tan.unSquash(Infinity),
    ActivationError,
  );
});

Deno.test("Activations.find() with unknown name throws ActivationError", () => {
  assertThrows(
    () => Activations.find("NONEXISTENT_ACTIVATION"),
    ActivationError,
  );
});

Deno.test("ActivationError from derivative has correct reason", () => {
  const relu = new ReLU();
  const error = assertThrows(
    () => relu.derivative(NaN),
    ActivationError,
  );
  assertEquals(error.reason, "NON_FINITE_INPUT");
  assertEquals(error.activation, "ReLU");
});

Deno.test("ActivationError from Activations.find has UNKNOWN_ACTIVATION reason", () => {
  const error = assertThrows(
    () => Activations.find("DOES_NOT_EXIST"),
    ActivationError,
  );
  assertEquals(error.reason, "UNKNOWN_ACTIVATION");
  assertEquals(error.activation, "DOES_NOT_EXIST");
});

Deno.test("ArcTan: derivative still works for finite inputs", () => {
  const arctan = new ArcTan();
  // ArcTan.derivative does not throw for non-finite (returns 0 via formula)
  // but should work normally for finite inputs
  assertEquals(arctan.derivative(0), 1);
});
