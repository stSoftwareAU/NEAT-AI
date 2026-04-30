/**
 * DnaSharingPreset.ts - Inter-island DNA-sharing knob presets (Issue #2492).
 *
 * Bundles the five inter-island knobs (#2173, #2174, #2175, #2177, #2455)
 * into named presets so very-distant DNA sharing can be opted into with a
 * single `dnaSharingMode: "aggressive"` flag instead of hand-tuning each
 * knob in user code.
 *
 * The preset only changes the *defaults* applied by `createNeatConfig()`.
 * Any explicit user value for `diversityBreedingRate`,
 * `interSpeciesCrossoverThreshold`, `geneticCompatibilityThreshold`, or
 * `compatibilityGating.*` still wins — the preset never silently overrides
 * a value the caller set deliberately.
 */
/**
 * Named presets for the inter-island knob bundle.
 *
 * - `default` — backward-compatible defaults (current behaviour).
 * - `aggressive` — wider gating and more diversity-driven breeding for
 *   very-distant donors (e.g. Europa→production cluster import).
 */
export type DnaSharingMode = "default" | "aggressive";

/**
 * Concrete defaults for one preset. Mirrors the per-knob defaults applied
 * in `createNeatConfig()`, plus the soft compatibility-gating sub-config.
 */
export interface DnaSharingPresetValues {
  /** {@link NeatArguments.diversityBreedingRate} */
  diversityBreedingRate: number;
  /** {@link NeatArguments.interSpeciesCrossoverThreshold} */
  interSpeciesCrossoverThreshold: number;
  /** {@link NeatArguments.geneticCompatibilityThreshold} */
  geneticCompatibilityThreshold: number;
  /** Soft compatibility gate (Issue #2455). */
  compatibilityGating: {
    enabled: boolean;
    power: number;
    maxDraws: number;
  };
}

/**
 * Backward-compatible defaults — these values must equal the per-knob
 * defaults already applied in `createNeatConfig()` so the unit test in
 * `test/transfer/KnobTuningStrategy.ts` can verify nothing changed.
 */
export const DEFAULT_DNA_SHARING_PRESET: DnaSharingPresetValues = {
  diversityBreedingRate: 0,
  interSpeciesCrossoverThreshold: 0.1,
  geneticCompatibilityThreshold: 0.3,
  compatibilityGating: {
    enabled: true,
    power: 1.5,
    maxDraws: 3,
  },
};

/**
 * Aggressive preset for very-distant DNA sharing (Issue #2492).
 *
 * Knob choices:
 * - `diversityBreedingRate: 0.4` — raised from 0 so ~40% of breeding picks
 *   the genetically most-distant father, ensuring newcomers from a distant
 *   donor (e.g. Europa) participate in breeding instead of being filtered
 *   out by fitness-only selection.
 * - `interSpeciesCrossoverThreshold: 0.05` — lowered from 0.1 so the
 *   input-weight crossover path triggers only for the truly incompatible
 *   pairs; structurally-similar inter-island pairs can use standard
 *   neuron-level crossover, which preserves more of the donor topology.
 * - `geneticCompatibilityThreshold: 0.3` — unchanged so the invariant
 *   `interSpeciesCrossoverThreshold <= geneticCompatibilityThreshold`
 *   continues to hold (0.05 <= 0.3 ✓).
 * - `compatibilityGating.power: 0.75` — lowered from 1.5 so the soft gate's
 *   acceptance probability `compatibility ^ power` is closer to uniform,
 *   widening the acceptable distance band.
 * - `compatibilityGating.maxDraws: 6` — raised from 3 so the gate has more
 *   chances to find a moderately-compatible father before falling back to
 *   the lowest-compatibility candidate.
 *
 * Numbers were chosen as a starting point for the bake-off harness
 * (#2491). They keep the cross-field invariant
 * `interSpeciesCrossoverThreshold <= geneticCompatibilityThreshold`
 * and stay inside each knob's individual bounds.
 */
export const AGGRESSIVE_DNA_SHARING_PRESET: DnaSharingPresetValues = {
  diversityBreedingRate: 0.4,
  interSpeciesCrossoverThreshold: 0.05,
  geneticCompatibilityThreshold: 0.3,
  compatibilityGating: {
    enabled: true,
    power: 0.75,
    maxDraws: 6,
  },
};

/**
 * Look up the preset values for a {@link DnaSharingMode}. Unknown / falsy
 * values fall through to the backward-compatible default preset.
 */
export function getDnaSharingPreset(
  mode: DnaSharingMode | undefined,
): DnaSharingPresetValues {
  return mode === "aggressive"
    ? AGGRESSIVE_DNA_SHARING_PRESET
    : DEFAULT_DNA_SHARING_PRESET;
}
