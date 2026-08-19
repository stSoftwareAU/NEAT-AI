/**
 * Unit tests for weighted soft-bias squash selection on the Activations
 * registry (Issue #3796).
 *
 * The weights map expresses a *preference* rather than a hard allow-list: a
 * listed squash is drawn proportionally to its weight, `"*"` supplies the
 * default weight for unlisted squashes, and `0` excludes. These tests assert
 * the proportions are honoured, the wildcard behaves, invalid maps fail loud,
 * and the map composes with the existing hard allow-list.
 *
 * The budget and the RNG are per-worker globals, so every test restores them
 * in a `finally` block.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { Activations } from "@methods/activations/Activations.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import {
  createSeededRng,
  resetGlobalRandomNumberGeneratorForTesting,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";

/** Draw `count` squashes with a deterministic RNG and tally the names. */
function tally(count: number, exclude?: string): Map<string, number> {
  setRandomNumberGenerator(createSeededRng(20260819));
  const counts = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const name = Activations.pickRandomSquash(exclude);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function restoreGlobals(): void {
  Activations.resetAllowedSquashesForTesting();
  resetGlobalRandomNumberGeneratorForTesting();
}

Deno.test("setSquashWeights: draws are proportional to the configured weights", () => {
  try {
    Activations.setSquashWeights({ TANH: 9, LOGISTIC: 1 });
    const draws = 4000;
    const counts = tally(draws);

    assertEquals(
      [...counts.keys()].sort(),
      ["LOGISTIC", "TANH"],
      "only weighted squashes may be drawn",
    );
    // 9:1 — allow a generous sampling band so the test is not flaky.
    assertAlmostEquals((counts.get("TANH") ?? 0) / draws, 0.9, 0.05);
    assertAlmostEquals((counts.get("LOGISTIC") ?? 0) / draws, 0.1, 0.05);
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: wildcard supplies the default weight for unlisted squashes", () => {
  try {
    // IF/MINIMUM/MAXIMUM strongly preferred, everything else still reachable.
    Activations.setSquashWeights({
      IF: 10,
      MINIMUM: 10,
      MAXIMUM: 10,
      "*": 1,
    });
    const draws = 4000;
    const counts = tally(draws);

    const preferred = ["IF", "MINIMUM", "MAXIMUM"].reduce(
      (sum, name) => sum + (counts.get(name) ?? 0),
      0,
    );
    assert(
      preferred / draws > 0.4,
      `aggregate squashes should dominate, got ${preferred / draws}`,
    );
    assert(
      counts.size > 4,
      "unlisted squashes must remain reachable under a wildcard weight",
    );
    assert(
      (counts.get("TANH") ?? 0) > 0,
      "TANH should still be drawn at the wildcard weight",
    );
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: without a wildcard, unlisted squashes are excluded", () => {
  try {
    Activations.setSquashWeights({ IF: 1, TANH: 2 });
    const counts = tally(500);
    assertEquals([...counts.keys()].sort(), ["IF", "TANH"]);
    assert(!Activations.isSquashAllowed("LOGISTIC"));
    assert(Activations.isSquashAllowed("TANH"));
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: a zero weight excludes a squash the wildcard would allow", () => {
  try {
    Activations.setSquashWeights({ TANH: 0, "*": 1 });
    const counts = tally(2000);
    assertEquals(counts.get("TANH"), undefined, "zero weight must exclude");
    assert(counts.size > 4, "other squashes remain reachable");
    assert(!Activations.isSquashAllowed("TANH"));
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: aliases canonicalise (RELU -> ReLU)", () => {
  try {
    Activations.setSquashWeights({ RELU: 1 });
    assertEquals(Activations.pickRandomSquash(), "ReLU");
    assert(Activations.isSquashAllowed("RELU"));
    assert(Activations.isSquashAllowed("ReLU"));
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: unknown squash name fails loud without partial application", () => {
  try {
    assertThrows(
      () => Activations.setSquashWeights({ TANH: 1, NOT_A_REAL_SQUASH: 2 }),
      ActivationError,
    );
    assertEquals(Activations.getSquashWeights(), null);
    // Selection is untouched — the free mix still applies.
    const name = Activations.pickRandomSquash();
    assertEquals(Activations.find(name).getName(), name);
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: negative, NaN and non-numeric weights fail loud", () => {
  try {
    assertThrows(
      () => Activations.setSquashWeights({ TANH: -1 }),
      ValidationError,
    );
    assertThrows(
      () => Activations.setSquashWeights({ TANH: Number.NaN }),
      ValidationError,
    );
    assertThrows(
      () =>
        Activations.setSquashWeights(
          { TANH: "heavy" } as unknown as Record<string, number>,
        ),
      ValidationError,
    );
    assertEquals(Activations.getSquashWeights(), null);
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: conflicting duplicate names fail loud", () => {
  try {
    assertThrows(
      () => Activations.setSquashWeights({ RELU: 10, ReLU: 1 }),
      ValidationError,
    );
    // Identical weights for the same canonical squash are harmless.
    Activations.setSquashWeights({ RELU: 4, ReLU: 4 });
    assertEquals(Activations.pickRandomSquash(), "ReLU");
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: an all-zero map fails loud", () => {
  try {
    assertThrows(
      () => Activations.setSquashWeights({ TANH: 0, LOGISTIC: 0 }),
      ValidationError,
    );
    assertEquals(Activations.getSquashWeights(), null);
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: null or empty map restores the free mix", () => {
  try {
    Activations.setSquashWeights({ TANH: 1 });
    assert(Activations.getSquashWeights() !== null);

    Activations.setSquashWeights({});
    assertEquals(Activations.getSquashWeights(), null);

    Activations.setSquashWeights({ TANH: 1 });
    Activations.setSquashWeights(null);
    assertEquals(Activations.getSquashWeights(), null);

    // Free mix again — more than the single weighted name is reachable.
    const counts = tally(500);
    assert(counts.size > 5, "the free mix should be restored");
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: weights apply within the hard allow-list", () => {
  try {
    Activations.setAllowedSquashes(["TANH", "LOGISTIC", "IDENTITY"]);
    // SINE is outside the allow-list — the allow-list wins.
    Activations.setSquashWeights({ TANH: 9, LOGISTIC: 1, SINE: 50, "*": 1 });

    const draws = 3000;
    const counts = tally(draws);
    assertEquals(
      [...counts.keys()].sort(),
      ["IDENTITY", "LOGISTIC", "TANH"],
      "the allow-list must still be a hard boundary",
    );
    assert(
      (counts.get("TANH") ?? 0) / draws > 0.6,
      "TANH should dominate its allow-listed peers",
    );
    assert(!Activations.isSquashAllowed("SINE"));
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: applying the allow-list after the weights composes the same way", () => {
  try {
    Activations.setSquashWeights({ TANH: 9, LOGISTIC: 1, SINE: 50 });
    Activations.setAllowedSquashes(["TANH", "LOGISTIC"]);
    const counts = tally(1000);
    assertEquals([...counts.keys()].sort(), ["LOGISTIC", "TANH"]);
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: an allow-list that zeroes every weight fails loud", () => {
  try {
    Activations.setSquashWeights({ TANH: 5 });
    assertThrows(
      () => Activations.setAllowedSquashes(["LOGISTIC"]),
      ValidationError,
    );
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: exclude is honoured under weighted selection", () => {
  try {
    Activations.setSquashWeights({ TANH: 9, LOGISTIC: 1 });
    const counts = tally(300, "TANH");
    assertEquals([...counts.keys()], ["LOGISTIC"]);
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: excluding the only weighted squash still returns it", () => {
  try {
    Activations.setSquashWeights({ TANH: 1 });
    for (let i = 0; i < 20; i++) {
      assertEquals(Activations.pickRandomSquash("TANH"), "TANH");
    }
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: an explicit weight can name a zero-mutation squash", () => {
  try {
    // SOFTMAX has mutationProbability 0, so it never appears in the free mix;
    // an explicit weight opts it back in.
    Activations.setSquashWeights({ SOFTMAX: 1 });
    assertEquals(Activations.pickRandomSquash(), "SOFTMAX");
  } finally {
    restoreGlobals();
  }
});

Deno.test("setSquashWeights: the wildcard never introduces a zero-mutation squash", () => {
  try {
    Activations.setSquashWeights({ "*": 1 });
    const weights = Activations.getSquashWeights();
    assert(weights !== null);
    for (let i = 0; i < 2000; i++) {
      const name = Activations.pickRandomSquash();
      assert(
        Activations.find(name).mutationProbability > 0,
        `wildcard drew a zero-mutation squash: ${name}`,
      );
    }
  } finally {
    restoreGlobals();
  }
});

Deno.test("resetAllowedSquashesForTesting: clears the weights as well", () => {
  Activations.setSquashWeights({ TANH: 1 });
  Activations.resetAllowedSquashesForTesting();
  assertEquals(Activations.getSquashWeights(), null);
  assertEquals(Activations.getAllowedSquashes(), null);
});
