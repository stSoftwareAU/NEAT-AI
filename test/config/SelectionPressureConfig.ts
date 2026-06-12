/**
 * Unit tests for selection-pressure configuration (Issue #2929).
 *
 * Verifies that the POWER exponent, tournament size/probability, and
 * adaptive-tournament bounds are exposed through `createNeatConfig`, default
 * to the prior hardcoded values, and reject out-of-range input with a clear
 * error.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { DEFAULT_SELECTION_PRESSURE_CONFIG } from "@config/SelectionPressureConfig.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";
import { Selection } from "@methods/Selection.ts";

Deno.test("SelectionPressureConfig - defaults reproduce prior hardcoded values", () => {
  const config = createNeatConfig({});
  const sp = config.selectionPressure;

  // Sourced from the Selection strategy singletons.
  assertEquals(sp.power, Selection.POWER.power);
  assertEquals(sp.power, 4);
  assertEquals(sp.tournamentSize, Selection.TOURNAMENT.size);
  assertEquals(sp.tournamentSize, 5);
  assertEquals(sp.tournamentProbability, Selection.TOURNAMENT.probability);
  assertEquals(sp.tournamentProbability, 0.5);

  // Adaptive-tournament bounds reproduce the prior formula.
  assertEquals(sp.adaptiveTournament, true);
  assertEquals(sp.adaptiveTournamentMinSize, 3);
  assertEquals(sp.adaptiveTournamentSqrtExponent, 0.5);
  assertEquals(sp.adaptiveTournamentCapFraction, 0.1);

  // Mirror the exported default constant.
  assertEquals(sp, DEFAULT_SELECTION_PRESSURE_CONFIG);
});

Deno.test("SelectionPressureConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    selectionPressure: {
      power: 8,
      tournamentSize: 12,
      tournamentProbability: 0.9,
      adaptiveTournament: false,
      adaptiveTournamentMinSize: 4,
      adaptiveTournamentSqrtExponent: 0.75,
      adaptiveTournamentCapFraction: 0.2,
    },
  });
  const sp = config.selectionPressure;
  assertEquals(sp.power, 8);
  assertEquals(sp.tournamentSize, 12);
  assertEquals(sp.tournamentProbability, 0.9);
  assertEquals(sp.adaptiveTournament, false);
  assertEquals(sp.adaptiveTournamentMinSize, 4);
  assertEquals(sp.adaptiveTournamentSqrtExponent, 0.75);
  assertEquals(sp.adaptiveTournamentCapFraction, 0.2);
});

Deno.test("SelectionPressureConfig - partial overrides merge with defaults", () => {
  const config = createNeatConfig({
    selectionPressure: { power: 6 },
  });
  const sp = config.selectionPressure;
  assertEquals(sp.power, 6);
  // Unspecified knobs keep their defaults.
  assertEquals(
    sp.tournamentSize,
    DEFAULT_SELECTION_PRESSURE_CONFIG.tournamentSize,
  );
  assertEquals(
    sp.adaptiveTournamentCapFraction,
    DEFAULT_SELECTION_PRESSURE_CONFIG.adaptiveTournamentCapFraction,
  );
});

Deno.test("SelectionPressureConfig - numeric fields coerced from string (CLI)", () => {
  const config = createNeatConfig({
    selectionPressure: {
      power: "7",
      tournamentSize: "9",
      adaptiveTournamentCapFraction: "0.15",
    },
  });
  const sp = config.selectionPressure;
  assertEquals(sp.power, 7);
  assertEquals(sp.tournamentSize, 9);
  assertEquals(sp.adaptiveTournamentCapFraction, 0.15);
});

Deno.test("SelectionPressureConfig - rejects non-positive power", () => {
  assertThrows(
    () => createNeatConfig({ selectionPressure: { power: 0 } }),
    ConfigurationError,
    "Selection pressure power",
  );
  assertThrows(
    () => createNeatConfig({ selectionPressure: { power: -2 } }),
    ConfigurationError,
    "Selection pressure power",
  );
});

Deno.test("SelectionPressureConfig - rejects out-of-range tournament probability", () => {
  assertThrows(
    () =>
      createNeatConfig({ selectionPressure: { tournamentProbability: 1.5 } }),
    ConfigurationError,
    "Selection pressure tournamentProbability",
  );
  assertThrows(
    () =>
      createNeatConfig({ selectionPressure: { tournamentProbability: -0.1 } }),
    ConfigurationError,
    "Selection pressure tournamentProbability",
  );
});

Deno.test("SelectionPressureConfig - rejects non-integer / non-positive tournament size", () => {
  assertThrows(
    () => createNeatConfig({ selectionPressure: { tournamentSize: 2.5 } }),
    ConfigurationError,
    "Selection pressure tournamentSize",
  );
  assertThrows(
    () => createNeatConfig({ selectionPressure: { tournamentSize: 0 } }),
    ConfigurationError,
    "Selection pressure tournamentSize",
  );
});

Deno.test("SelectionPressureConfig - rejects out-of-range adaptive bounds", () => {
  assertThrows(
    () =>
      createNeatConfig({
        selectionPressure: { adaptiveTournamentSqrtExponent: 0 },
      }),
    ConfigurationError,
    "Selection pressure adaptiveTournamentSqrtExponent",
  );
  assertThrows(
    () =>
      createNeatConfig({
        selectionPressure: { adaptiveTournamentCapFraction: 1.5 },
      }),
    ConfigurationError,
    "Selection pressure adaptiveTournamentCapFraction",
  );
  assertThrows(
    () =>
      createNeatConfig({
        selectionPressure: { adaptiveTournamentMinSize: 0 },
      }),
    ConfigurationError,
    "Selection pressure adaptiveTournamentMinSize",
  );
});
