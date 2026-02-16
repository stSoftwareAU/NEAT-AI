import { assert, assertEquals, assertIsError, assertThrows } from "@std/assert";
import {
  ActivationError,
  type ActivationErrorReason,
} from "../../src/errors/ActivationError.ts";

Deno.test("ActivationError - NON_FINITE_INPUT reason", () => {
  const error = new ActivationError(
    "Non-finite input to ReLU.derivative: NaN",
    "NON_FINITE_INPUT",
    "ReLU",
    NaN,
  );
  assertIsError(error, ActivationError);
  assertEquals(error.message, "Non-finite input to ReLU.derivative: NaN");
  assertEquals(error.reason, "NON_FINITE_INPUT");
  assertEquals(error.activation, "ReLU");
  assertEquals(Number.isNaN(error.input), true);
  assertEquals(error.name, "ActivationError");
});

Deno.test("ActivationError - NON_FINITE_RESULT reason", () => {
  const error = new ActivationError(
    "ArcTan unSquash produced non-finite result",
    "NON_FINITE_RESULT",
    "ArcTan",
    1.5,
  );
  assertIsError(error, ActivationError);
  assertEquals(error.reason, "NON_FINITE_RESULT");
  assertEquals(error.activation, "ArcTan");
  assertEquals(error.input, 1.5);
});

Deno.test("ActivationError - UNKNOWN_ACTIVATION reason", () => {
  const error = new ActivationError(
    "Unknown activation: FOO",
    "UNKNOWN_ACTIVATION",
    "FOO",
    0,
  );
  assertIsError(error, ActivationError);
  assertEquals(error.reason, "UNKNOWN_ACTIVATION");
  assertEquals(error.activation, "FOO");
});

Deno.test("ActivationError - is instanceof Error", () => {
  const error = new ActivationError(
    "test",
    "NON_FINITE_INPUT",
    "TANH",
    Infinity,
  );
  assert(error instanceof Error);
  assert(error instanceof ActivationError);
});

Deno.test("ActivationError - can be caught selectively", () => {
  const fn = () => {
    throw new ActivationError(
      "non-finite input",
      "NON_FINITE_INPUT",
      "Mish",
      NaN,
    );
  };

  assertThrows(fn, ActivationError);
});

Deno.test("ActivationError - reason is typed", () => {
  const reasons: ActivationErrorReason[] = [
    "NON_FINITE_INPUT",
    "NON_FINITE_RESULT",
    "UNKNOWN_ACTIVATION",
  ];

  for (const reason of reasons) {
    const error = new ActivationError(`test: ${reason}`, reason, "test", 0);
    assertEquals(error.reason, reason);
  }
});

Deno.test("ActivationError - distinguishable from generic Error", () => {
  try {
    throw new ActivationError(
      "bad input",
      "NON_FINITE_INPUT",
      "ReLU",
      Infinity,
    );
  } catch (e) {
    if (e instanceof ActivationError) {
      assertEquals(e.reason, "NON_FINITE_INPUT");
      assertEquals(e.activation, "ReLU");
      assertEquals(e.input, Infinity);
    } else {
      throw new Error("Expected ActivationError instance");
    }
  }
});

Deno.test("ActivationError - input can be array of numbers", () => {
  const error = new ActivationError(
    "Non-finite inputs",
    "NON_FINITE_INPUT",
    "MAXIMUM",
    [1, NaN, 3],
  );
  assertIsError(error, ActivationError);
  assertEquals(error.input, [1, NaN, 3]);
});
