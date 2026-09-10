/**
 * Offspring pre-selection configuration (Issue #3932).
 *
 * The defaults are the load-bearing case: `ratio: 1` / `screen: "none"` must
 * resolve to a stage that does nothing, because that is what every build
 * before this issue did. Everything else here is the refusal to clamp — a
 * quietly corrected ratio changes how many creatures a generation throws away.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  DEFAULT_PRE_SELECTION_CONFIG,
  MAX_PRE_SELECTION_RATIO,
  PRE_SELECTION_SCREENS,
  resolvePreSelectionConfig,
} from "@config/PreSelectionConfig.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";

Deno.test("pre-selection config — the default is the stage switched off", () => {
  const config = resolvePreSelectionConfig();
  assertEquals(config, DEFAULT_PRE_SELECTION_CONFIG);
  assertEquals(config.ratio, 1);
  assertEquals(config.screen, "none");
});

Deno.test("pre-selection config — an explicit ratio of 1 is still off", () => {
  assertEquals(resolvePreSelectionConfig({ ratio: 1 }).screen, "none");
});

Deno.test("pre-selection config — overrides layer over the defaults", () => {
  const config = resolvePreSelectionConfig({
    ratio: 3,
    screen: "surrogate",
    randomSurvivorFraction: 0.5,
    surrogateWindow: 64,
    surrogateNeighbours: 3,
  });
  assertEquals(config.ratio, 3);
  assertEquals(config.screen, "surrogate");
  assertEquals(config.randomSurvivorFraction, 0.5);
  assertEquals(config.surrogateWindow, 64);
  assertEquals(config.surrogateNeighbours, 3);
});

Deno.test("pre-selection config — a fractional ratio is accepted", () => {
  assertEquals(
    resolvePreSelectionConfig({ ratio: 2.5, screen: "surrogate" }).ratio,
    2.5,
  );
});

Deno.test("pre-selection config — every named screen resolves", () => {
  for (const screen of PRE_SELECTION_SCREENS) {
    const ratio = screen === "none" ? 1 : 2;
    assertEquals(resolvePreSelectionConfig({ screen, ratio }).screen, screen);
  }
});

Deno.test("pre-selection config — an unknown screen is refused", () => {
  const error = assertThrows(
    () =>
      resolvePreSelectionConfig(
        { screen: "magic" as never, ratio: 2 },
      ),
    ConfigurationError,
  );
  assertEquals(error.reason, "INVALID_TYPE");
});

Deno.test("pre-selection config — a ratio below 1 or past the cap is refused", () => {
  for (const ratio of [0, 0.5, -1, MAX_PRE_SELECTION_RATIO + 0.5, NaN]) {
    const error = assertThrows(
      () => resolvePreSelectionConfig({ ratio, screen: "surrogate" }),
      ConfigurationError,
      undefined,
      `ratio ${ratio} must be refused`,
    );
    assertEquals(error.reason, "OUT_OF_RANGE");
  }
});

Deno.test("pre-selection config — a random-survivor fraction outside [0, 1] is refused", () => {
  for (const fraction of [-0.1, 1.1, Infinity]) {
    assertThrows(
      () =>
        resolvePreSelectionConfig({
          ratio: 2,
          screen: "surrogate",
          randomSurvivorFraction: fraction,
        }),
      ConfigurationError,
    );
  }
});

Deno.test("pre-selection config — the boundary fractions 0 and 1 are accepted", () => {
  for (const fraction of [0, 1]) {
    assertEquals(
      resolvePreSelectionConfig({
        ratio: 2,
        screen: "surrogate",
        randomSurvivorFraction: fraction,
      }).randomSurvivorFraction,
      fraction,
    );
  }
});

Deno.test("pre-selection config — surrogate window and neighbours must be integers in range", () => {
  assertThrows(
    () =>
      resolvePreSelectionConfig({
        ratio: 2,
        screen: "surrogate",
        surrogateWindow: 2,
      }),
    ConfigurationError,
  );
  assertThrows(
    () =>
      resolvePreSelectionConfig({
        ratio: 2,
        screen: "surrogate",
        surrogateWindow: 12.5,
      }),
    ConfigurationError,
  );
  assertThrows(
    () =>
      resolvePreSelectionConfig({
        ratio: 2,
        screen: "surrogate",
        surrogateNeighbours: 0,
      }),
    ConfigurationError,
  );
});

Deno.test("pre-selection config — over-generating without a screen is refused", () => {
  const error = assertThrows(
    () => resolvePreSelectionConfig({ ratio: 3 }),
    ConfigurationError,
  );
  assertEquals(error.reason, "CROSS_FIELD_VALIDATION");
});

Deno.test("pre-selection config — a screen with no surplus to screen is refused", () => {
  assertThrows(
    () => resolvePreSelectionConfig({ screen: "sampled" }),
    ConfigurationError,
  );
});
