/**
 * SelectionParsers.ts - Sub-config parser for selection pressure (Issue #2929).
 *
 * Parses and validates the selection-pressure knobs (POWER exponent,
 * tournament size and probability, and adaptive-tournament bounds). Defaults
 * reproduce the prior hardcoded behaviour exactly.
 */

import {
  DEFAULT_SELECTION_PRESSURE_CONFIG,
  type RequiredSelectionPressureConfig,
} from "@config/SelectionPressureConfig.ts";
import { parseNumber } from "@config/ParseOptions.ts";

/** Parse selection-pressure configuration (Issue #2929). */
export function parseSelectionPressure(
  overrides: Record<string, unknown> | undefined,
): RequiredSelectionPressureConfig {
  const d = DEFAULT_SELECTION_PRESSURE_CONFIG;
  return {
    power: parseNumber(
      "Selection pressure power",
      overrides?.power,
      d.power,
      { minExclusive: 0 },
    ),
    tournamentSize: parseNumber(
      "Selection pressure tournamentSize",
      overrides?.tournamentSize,
      d.tournamentSize,
      { integer: true, min: 1 },
    ),
    tournamentProbability: parseNumber(
      "Selection pressure tournamentProbability",
      overrides?.tournamentProbability,
      d.tournamentProbability,
      { min: 0, max: 1 },
    ),
    adaptiveTournament: typeof overrides?.adaptiveTournament === "boolean"
      ? overrides.adaptiveTournament
      : d.adaptiveTournament,
    adaptiveTournamentMinSize: parseNumber(
      "Selection pressure adaptiveTournamentMinSize",
      overrides?.adaptiveTournamentMinSize,
      d.adaptiveTournamentMinSize,
      { integer: true, min: 1 },
    ),
    adaptiveTournamentSqrtExponent: parseNumber(
      "Selection pressure adaptiveTournamentSqrtExponent",
      overrides?.adaptiveTournamentSqrtExponent,
      d.adaptiveTournamentSqrtExponent,
      { minExclusive: 0 },
    ),
    adaptiveTournamentCapFraction: parseNumber(
      "Selection pressure adaptiveTournamentCapFraction",
      overrides?.adaptiveTournamentCapFraction,
      d.adaptiveTournamentCapFraction,
      { minExclusive: 0, max: 1 },
    ),
  } as RequiredSelectionPressureConfig;
}
