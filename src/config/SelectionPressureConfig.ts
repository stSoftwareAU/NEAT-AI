/**
 * SelectionPressureConfig.ts - Configuration for selection-pressure knobs
 * (Issue #2929).
 *
 * Selection pressure is one of the most direct levers on convergence speed:
 * stronger pressure exploits good genomes faster (quicker convergence, more
 * risk of premature convergence); weaker pressure explores longer. These
 * parameters were previously hardcoded in `src/methods/Selection.ts` and
 * `src/breed/AdaptiveTournamentSize.ts`; this config exposes them through the
 * standard `NeatOptions`/`NeatConfig` surface.
 *
 * Every default reproduces the prior hardcoded behaviour exactly, so existing
 * runs are unchanged unless a knob is overridden.
 */

import { Selection } from "@methods/Selection.ts";

/**
 * Configuration for selection pressure (POWER exponent, tournament size and
 * probability, and adaptive-tournament bounds).
 */
export interface SelectionPressureConfig {
  /**
   * Exponent applied in POWER selection: a uniform random number is raised to
   * this power before indexing the fitness-sorted population, so higher values
   * bias selection more strongly towards the top-ranked creatures. Must be
   * greater than 0. Default: `4` (the prior `Selection.POWER.power`).
   */
  power?: number;

  /**
   * Fixed tournament size used when adaptive tournament sizing is disabled
   * (`adaptiveTournament: false`). When adaptive sizing is enabled this value
   * is ignored. Default: `5` (the prior `Selection.TOURNAMENT.size`).
   */
  tournamentSize?: number;

  /**
   * Probability of selecting the best participant in a tournament (otherwise
   * the next best is considered, and so on). Higher values increase selection
   * pressure. Default: `0.5` (the prior `Selection.TOURNAMENT.probability`).
   */
  tournamentProbability?: number;

  /**
   * Whether tournament size scales adaptively with population size. When
   * `true` (default) the size is derived from `calculateAdaptiveTournamentSize`
   * using the bounds below; when `false` the fixed `tournamentSize` is used.
   * Default: `true` (the prior behaviour from Issue #1019).
   */
  adaptiveTournament?: boolean;

  /**
   * Minimum adaptive tournament size, ensuring meaningful selection pressure
   * even for small populations. Must be a positive integer. Default: `3`.
   */
  adaptiveTournamentMinSize?: number;

  /**
   * Exponent governing how adaptive tournament size scales with population:
   * `floor(population ^ exponent)`. The prior behaviour used square-root
   * scaling, so the default `0.5` reproduces it exactly. Higher values raise
   * selection pressure for large populations. Must be greater than 0.
   * Default: `0.5`.
   */
  adaptiveTournamentSqrtExponent?: number;

  /**
   * Cap on adaptive tournament size as a fraction of the population, applied
   * as `floor(population * fraction)` and taken as the minimum against the
   * exponent-scaled size. Prevents excessive pressure in large populations.
   * Must be greater than 0 and at most 1. Default: `0.1` (10%).
   */
  adaptiveTournamentCapFraction?: number;
}

/**
 * Required version of {@link SelectionPressureConfig} with every field
 * populated. Produced by `parseSelectionPressure` after defaults are applied.
 */
export type RequiredSelectionPressureConfig = Required<
  SelectionPressureConfig
>;

/**
 * Default selection-pressure values. Each default is sourced from the prior
 * hardcoded literal so behaviour is unchanged unless overridden:
 * - `power`, `tournamentSize`, `tournamentProbability` come from the
 *   `Selection` strategy singletons.
 * - `adaptiveTournament*` reproduce the `calculateAdaptiveTournamentSize`
 *   formula `max(3, min(floor(sqrt(pop)), floor(pop * 0.1)))`.
 */
export const DEFAULT_SELECTION_PRESSURE_CONFIG:
  RequiredSelectionPressureConfig = {
    power: Selection.POWER.power,
    tournamentSize: Selection.TOURNAMENT.size,
    tournamentProbability: Selection.TOURNAMENT.probability,
    adaptiveTournament: true,
    adaptiveTournamentMinSize: 3,
    adaptiveTournamentSqrtExponent: 0.5,
    adaptiveTournamentCapFraction: 0.1,
  };
