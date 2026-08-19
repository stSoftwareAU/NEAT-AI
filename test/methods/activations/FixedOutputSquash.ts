/**
 * Unit tests for the opt-in output-squash pin on the Activations registry
 * (Issue #3797).
 *
 * When a bounded training target (e.g. -1..1) requires the output neuron to
 * stay `TANH`, the pin keeps it there: every squash rewrite on an output
 * neuron resolves back to the pinned activation, while hidden neurons keep
 * evolving freely.
 *
 * The pin is a per-worker global (mirrors the RNG and the squash budget), so
 * every test resets it in a `finally` block.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Activations } from "@methods/activations/Activations.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import { Creature } from "../../../mod.ts";

Deno.test("setFixedOutputSquash: unset by default", () => {
  Activations.resetFixedOutputSquashForTesting();
  assertEquals(Activations.getFixedOutputSquash(), null);
  assert(Activations.matchesFixedOutputSquash("TANH"));
  assert(Activations.matchesFixedOutputSquash("LOGISTIC"));
  assert(Activations.matchesFixedOutputSquash(undefined));
});

Deno.test("setFixedOutputSquash: aliases canonicalise (RELU -> ReLU)", () => {
  try {
    Activations.setFixedOutputSquash("RELU");
    assertEquals(Activations.getFixedOutputSquash(), "ReLU");
    assert(Activations.matchesFixedOutputSquash("RELU"));
    assert(Activations.matchesFixedOutputSquash("ReLU"));
    assert(!Activations.matchesFixedOutputSquash("TANH"));
    assert(!Activations.matchesFixedOutputSquash(undefined));
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("setFixedOutputSquash: unknown name throws ActivationError (fail loud)", () => {
  try {
    assertThrows(
      () => Activations.setFixedOutputSquash("NOT_A_REAL_SQUASH"),
      ActivationError,
    );
    // A failed call must not partially apply a pin.
    assertEquals(Activations.getFixedOutputSquash(), null);
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("setFixedOutputSquash: null or blank clears the pin", () => {
  try {
    Activations.setFixedOutputSquash("TANH");
    assertEquals(Activations.getFixedOutputSquash(), "TANH");

    Activations.setFixedOutputSquash(null);
    assertEquals(Activations.getFixedOutputSquash(), null);

    Activations.setFixedOutputSquash("TANH");
    Activations.setFixedOutputSquash("   ");
    assertEquals(Activations.getFixedOutputSquash(), null);
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("fixed output squash: new creatures seed output neurons with the pin", () => {
  try {
    Activations.setFixedOutputSquash("TANH");
    const creature = new Creature(3, 2, { layers: [{ count: 2 }] });
    for (const neuron of creature.neurons) {
      if (neuron.type !== "output") continue;
      assertEquals(neuron.squash, "TANH");
    }
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("fixed output squash: an explicit conflicting outputLayer squash is normalised", () => {
  try {
    Activations.setFixedOutputSquash("TANH");
    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
      outputLayer: { squash: "LOGISTIC" },
    });
    const outputs = creature.neurons.filter((n) => n.type === "output");
    assertEquals(outputs.length, 1);
    assertEquals(outputs[0].squash, "TANH");
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("fixed output squash: setSquash cannot rewrite a pinned output neuron", () => {
  try {
    Activations.setFixedOutputSquash("TANH");
    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const output = creature.neurons.find((n) => n.type === "output");
    assert(output !== undefined);
    const hidden = creature.neurons.find((n) => n.type === "hidden");
    assert(hidden !== undefined);

    output.setSquash("LOGISTIC");
    assertEquals(output.squash, "TANH");

    // Hidden neurons are unaffected by the pin.
    hidden.setSquash("LOGISTIC");
    assertEquals(hidden.squash, "LOGISTIC");
  } finally {
    Activations.resetFixedOutputSquashForTesting();
  }
});

Deno.test("fixed output squash: no pin leaves output squash rewrites alone", () => {
  Activations.resetFixedOutputSquashForTesting();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const output = creature.neurons.find((n) => n.type === "output");
  assert(output !== undefined);
  output.setSquash("LOGISTIC");
  assertEquals(output.squash, "LOGISTIC");
});
