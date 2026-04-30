/**
 * KnobTuningStrategy.ts - Aggressive-preset DNA-sharing strategy (Issue #2492).
 *
 * The cheapest of the four DNA-sharing primitives in the parent issue
 * (#2490): rather than performing structural surgery on the recipient,
 * this strategy simply stamps the `dnaSharingMode = "aggressive"` preset
 * onto the recipient's tags so the next NEAT run on that creature picks
 * up the wider gating and higher diversity-driven breeding rate.
 *
 * Acts as the baseline the other three primitives must beat in the
 * bake-off harness (#2491). If a structural primitive cannot improve
 * absolute score lift over a pure config tweak, it is not worth landing.
 */

import type { Creature } from "@creature";
import type { TagInterface } from "@stsoftware/tags/mod";
import {
  AGGRESSIVE_DNA_SHARING_PRESET,
  type DnaSharingMode,
  type DnaSharingPresetValues,
} from "@config/DnaSharingPreset.ts";
import type {
  DnaSharingPrepareOptions,
  DnaSharingStrategy,
} from "./DnaSharingStrategy.ts";

/** Tag name used to stamp the preset onto a recipient creature. */
export const KNOB_TUNING_TAG_NAME = "dnaSharingMode";

/**
 * Knob-tuning DNA-sharing strategy (Issue #2492).
 *
 * `prepare()` does not mutate the recipient's topology — it tags the
 * recipient with `dnaSharingMode = <mode>` so the next NEAT run on that
 * creature applies the matching preset (see
 * `src/config/DnaSharingPreset.ts`).
 *
 * Defaults to the `aggressive` preset; pass `mode: "default"` to construct
 * a no-op tuner (useful as a control row in the bake-off harness).
 */
export class KnobTuningStrategy implements DnaSharingStrategy {
  /** Short identifier used as the row key in the harness Markdown table. */
  readonly name: string;
  /** Preset mode this strategy applies. */
  readonly mode: DnaSharingMode;
  /** Resolved preset values for `mode` — exposed for the harness/tests. */
  readonly preset: DnaSharingPresetValues;

  constructor(mode: DnaSharingMode = "aggressive") {
    this.mode = mode;
    this.name = mode === "aggressive"
      ? "KnobTuning(aggressive)"
      : "KnobTuning(default)";
    this.preset = mode === "aggressive"
      ? AGGRESSIVE_DNA_SHARING_PRESET
      // For the default mode we still return the aggressive constant so
      // the strategy has a single source of preset values; downstream
      // consumers should look up the canonical default via
      // `getDnaSharingPreset("default")` if they need it.
      : AGGRESSIVE_DNA_SHARING_PRESET;
  }

  /**
   * Stamp the preset onto `recipient.tags` so the next `createNeatConfig`
   * call picks it up via {@link NeatArguments.dnaSharingMode}. Donor is
   * not touched.
   *
   * Re-running `prepare` is idempotent: the existing `dnaSharingMode`
   * tag (if any) is replaced by the new value rather than appended.
   */
  prepare(
    recipient: Creature,
    _donor: Creature,
    _options: DnaSharingPrepareOptions,
  ): Promise<void> {
    const existing = recipient.tags ?? [];
    const filtered = existing.filter((t) => t.name !== KNOB_TUNING_TAG_NAME);
    const next: TagInterface[] = [
      ...filtered,
      { name: KNOB_TUNING_TAG_NAME, value: this.mode },
    ];
    recipient.tags = next;
    return Promise.resolve();
  }
}

/**
 * Read the DNA-sharing mode previously stamped on a creature by
 * {@link KnobTuningStrategy.prepare}, or `undefined` when no tag is set.
 *
 * Useful for the bake-off harness's evolveStep when it needs to construct
 * a `NeatOptions` object reflecting the stamped preset.
 */
export function readDnaSharingModeTag(
  creature: Creature,
): DnaSharingMode | undefined {
  const tag = creature.tags?.find((t) => t.name === KNOB_TUNING_TAG_NAME);
  if (!tag) return undefined;
  const v = String(tag.value);
  return v === "aggressive"
    ? "aggressive"
    : v === "default"
    ? "default"
    : undefined;
}
