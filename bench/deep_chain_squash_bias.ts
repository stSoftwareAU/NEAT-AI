/**
 * The matched-baseline comparison for the depth-aware squash bias
 * (Issue #3974).
 *
 * The bias claims two things, and each has a way of being wrong:
 *
 * - **It works** — fewer gradient-blocking activations land inside the deep
 *   serial run, and #3972's probe sees the run's zero-gradient fraction fall.
 *   If the fraction does not move, the bias is not doing what it claims and any
 *   score change is coincidence.
 * - **It costs diversity** — a bias that narrows the squash mix has shrunk the
 *   search space, and the score finds that out later than the diagnostics do.
 *   So every run reports the population squash histogram
 *   (`src/NEAT/SquashHistogram.ts`) and species diversity
 *   (`src/NEAT/SpeciesDiversity.ts`) for both arms, on the same seed.
 *
 * Both arms mutate the same creature from the same seed; the only difference is
 * `deepChainSquashBias`. `--focus chain` aims every draw at the run, which is
 * where the mechanism is; `--focus any` draws uniformly, which is what
 * production does and what shows whether the whole-creature mix moved.
 *
 * ```bash
 * # The GRQ creature, draws aimed at the depth-34 run.
 * deno task bench:squash-bias -- --creature test/data/grq-23-forests-constants.json \
 *   --focus chain --mutations 40 --population 8 --samples 16
 *
 * # The same creature, uniform draws — the diversity cost at production odds.
 * deno task bench:squash-bias -- --creature test/data/grq-23-forests-constants.json \
 *   --focus any --mutations 400 --population 8 --profile-only true
 * ```
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { isGradientBlockingSquash } from "@methods/activations/GradientBlocking.ts";
import { ModActivation } from "@mutate/ModSquash.ts";
import { DEFAULT_SQUASH_EFFECTIVENESS_CONFIG } from "@config/SquashEffectivenessConfig.ts";
import { Genus } from "@neat/Genus.ts";
import { SquashEffectivenessTracker } from "@neat/SquashEffectivenessTracker.ts";
import { computeSpeciesDiversity } from "@neat/SpeciesDiversity.ts";
import {
  computeSquashHistogram,
  type SquashHistogram,
} from "@neat/SquashHistogram.ts";
import type { ZeroGradientCause } from "@propagate/GradientDepthBuckets.ts";
import { probeGradientDepth } from "@propagate/GradientDepthProbe.ts";
import { longestSerialChain } from "@propagate/SerialChains.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import {
  chainZeroGradient,
  pooledZeroGradient,
  type ZeroGradientPool,
} from "./skip_connection_null_comparison.ts";
import {
  numericFlag,
  parseFlags,
  syntheticObservations,
} from "../scripts/gradientDepthReport.ts";

/**
 * Which arm produced a row.
 *
 * `ceiling` takes no draws at all: every member of the run is set to `TANH`,
 * which bounds what *any* squash-level intervention can achieve on this
 * creature. If the run's zero-gradient fraction does not move even there, the
 * zeros are not coming from the members' own activations and no bias on the
 * squash pool can remove them.
 */
export type BiasArm = "baseline" | "biased" | "ceiling";

/** Everything one run needs. */
export interface SquashBiasConfig {
  /** Creature JSON to measure. */
  creaturePath: string;
  /** Bias the `biased` arm runs at; the baseline arm always runs at 0. */
  bias: number;
  /** Run length at which the bias applies, shared with #3973. */
  minLength: number;
  /** Squash mutations applied to each creature in each arm. */
  mutations: number;
  /** Creatures per arm — the population the histogram and diversity cover. */
  population: number;
  /** Aim every draw at the run (`chain`) or draw uniformly (`any`). */
  focus: "chain" | "any";
  /** Seed for the mutation draws and the probe observations. */
  seed: number;
  /** Probe samples per arm. */
  samples: number;
  /** Half-width of the seeded probe observations. */
  observationScale: number;
  /** Skip the gradient probe — for a diversity-only run. */
  profileOnly: boolean;
}

/** The defaults every flag falls back to. */
export const SQUASH_BIAS_DEFAULTS: SquashBiasConfig = {
  creaturePath: "test/data/grq-23-forests-constants.json",
  bias: 1,
  minLength: 4,
  mutations: 40,
  population: 8,
  focus: "chain",
  seed: 3974,
  samples: 16,
  observationScale: 1,
  profileOnly: false,
};

/** What one arm measured. */
export interface BiasArmResult {
  arm: BiasArm;
  /** The bias the arm ran at. */
  bias: number;
  /** Squash mutations that actually landed across the population. */
  applied: number;
  /** Of those, how many settled on a gradient-blocking activation. */
  blocking: number;
  /** Squash histogram over the whole population. */
  histogram: SquashHistogram;
  /** Distinct squashes present across the population. */
  distinctSquashes: number;
  /** Shannon entropy of the histogram, in bits — the diversity regression. */
  entropyBits: number;
  /** Species diversity of the population, `Genus` speciation. */
  speciesDiversity: number;
  /** Distinct species in the population. */
  speciesCount: number;
  /** Blocking activations sitting in the run, first creature of the arm. */
  chainBlockingMembers: number;
  /** Members of that run. */
  chainMembers: number;
  /** The run's own zero-gradient aggregate, when the probe ran. */
  chain?: ZeroGradientPool;
  /** Everything at or above the run's entry depth, when the probe ran. */
  upstream?: ZeroGradientPool;
  /** What the probe blamed the run's zero gradients on. */
  chainCauses?: Record<ZeroGradientCause, number>;
}

/** A whole run. */
export interface SquashBiasReport {
  config: SquashBiasConfig;
  provenance: string;
  /** Depth of the run's first member. */
  chainStartDepth: number;
  /** Members of the run found in the unmutated creature. */
  chainLength: number;
  arms: BiasArmResult[];
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

/** How much of one `SquashEffectivenessTracker` role the run accounts for. */
export interface RoleVisibility {
  /** `layer|fanIn`, the role key the tracker buckets by. */
  role: string;
  /** Mutable neurons in that role across the whole creature. */
  neurons: number;
  /** Of those, how many are members of the run. */
  runMembers: number;
}

/**
 * Step 1 of Issue #3974: what share of each tracker role the deep run is.
 *
 * The tracker buckets a neuron by `layer × fan-in` and nothing else, so this
 * is the most the existing mechanism could ever see of the run: the fraction
 * of each role's samples that came from inside it. Every role is computed with
 * the tracker's own `computeRole`, which runs a full layer pass per neuron —
 * slow by design, because a reimplementation here would answer a different
 * question than the one production asks.
 *
 * @param creature - The creature to measure.
 * @returns One row per role the run touches, busiest first.
 */
export function measureRoleVisibility(creature: Creature): RoleVisibility[] {
  const tracker = new SquashEffectivenessTracker(
    DEFAULT_SQUASH_EFFECTIVENESS_CONFIG,
  );
  const runMembers = new Set(
    longestSerialChain(creature)?.members.map((m) => m.index) ?? [],
  );

  const roleOf = (index: number) => {
    const role = tracker.computeRole(creature, index);
    return `${role.layer}|${role.fanIn}`;
  };

  const runRoles = new Set<string>();
  for (const index of runMembers) runRoles.add(roleOf(index));

  const counts = new Map<string, RoleVisibility>();
  for (const role of runRoles) {
    counts.set(role, { role, neurons: 0, runMembers: 0 });
  }

  for (let index = creature.input; index < creature.neurons.length; index++) {
    const type = creature.neurons[index].type;
    if (type !== "hidden" && type !== "output") continue;
    const role = roleOf(index);
    const row = counts.get(role);
    if (row === undefined) continue;
    row.neurons++;
    if (runMembers.has(index)) row.runMembers++;
  }

  return [...counts.values()].sort((a, b) => b.neurons - a.neurons);
}

/** Render the Step 1 role-visibility measurement as Markdown. */
export function renderRoleVisibility(
  creaturePath: string,
  rows: readonly RoleVisibility[],
): string {
  const lines = [
    "# Step 1 — what `SquashEffectivenessTracker` can see of the deep run " +
    "(Issue #3974)",
    "",
    `- Creature: \`${creaturePath}\``,
    "- Roles are the tracker's own `layer bucket × fan-in bucket`, computed " +
    "with `SquashEffectivenessTracker.computeRole`.",
    "",
    "| Role | Mutable neurons | In the run | Run share |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      // The role key itself contains a pipe, which would end the cell.
      // Escape every pipe, not just the first.
      `| ${
        row.role.replaceAll("|", "\\|")
      } | ${row.neurons} | ${row.runMembers} | ` +
        `${pct(row.neurons === 0 ? 0 : row.runMembers / row.neurons)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Fill in every unset field with its default. */
export function withSquashBiasDefaults(
  partial: Partial<SquashBiasConfig>,
): SquashBiasConfig {
  const config = { ...SQUASH_BIAS_DEFAULTS, ...partial };
  assertValidSquashBiasConfig(config);
  return config;
}

/**
 * Refuse a configuration that cannot produce a meaningful comparison.
 *
 * @throws {RangeError} On any out-of-range field.
 */
export function assertValidSquashBiasConfig(config: SquashBiasConfig): void {
  if (!Number.isFinite(config.bias) || config.bias <= 0 || config.bias > 1) {
    throw new RangeError(
      `bias must be greater than 0 and at most 1, got ${config.bias}`,
    );
  }
  if (!Number.isInteger(config.minLength) || config.minLength < 2) {
    throw new RangeError(
      `minLength must be an integer of at least 2, got ${config.minLength}`,
    );
  }
  if (!Number.isInteger(config.mutations) || config.mutations < 1) {
    throw new RangeError(
      `mutations must be a positive integer, got ${config.mutations}`,
    );
  }
  if (!Number.isInteger(config.population) || config.population < 1) {
    throw new RangeError(
      `population must be a positive integer, got ${config.population}`,
    );
  }
  if (!Number.isInteger(config.samples) || config.samples < 1) {
    throw new RangeError(
      `samples must be a positive integer, got ${config.samples}`,
    );
  }
  if (config.focus !== "chain" && config.focus !== "any") {
    throw new RangeError(`focus must be "chain" or "any", got ${config.focus}`);
  }
}

/**
 * Shannon entropy of a squash histogram, in bits.
 *
 * A bias that improves the gradient profile while collapsing the activation mix
 * has narrowed the search space; entropy is the single number that shows it.
 *
 * @param histogram - Squash name → neuron count.
 * @returns Entropy in bits; `0` for an empty or single-valued histogram.
 */
export function histogramEntropyBits(histogram: SquashHistogram): number {
  const counts = Object.values(histogram);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * The squash the `ceiling` arm puts on every run member.
 *
 * `IDENTITY` and not a smooth saturating activation: `TANH`'s derivative is
 * `1 - tanh(x)²`, which underflows to **exactly zero** in float64 beyond
 * |x| ≈ 20, and the run's entry neuron has a fan-in of 1,265, so a `TANH`
 * ceiling would carry the very fault it is supposed to exclude. `IDENTITY`
 * has a derivative of 1 everywhere, so the arm really is the bound it claims:
 * whatever zero gradient survives it cannot be blamed on the run's own
 * activations.
 */
export const CEILING_SQUASH = "IDENTITY";

/** Measure one arm. */
function runArm(
  arm: BiasArm,
  json: CreatureExport,
  config: SquashBiasConfig,
): BiasArmResult {
  const bias = arm === "biased" ? config.bias : 0;
  // Both arms start from the same seed, so any difference between them is the
  // bias and nothing else.
  setRandomNumberGenerator(createSeededRng(config.seed));

  const population: Creature[] = [];
  let applied = 0;
  let blocking = 0;

  for (let member = 0; member < config.population; member++) {
    if (arm === "ceiling") {
      const creature = Creature.fromJSON(json);
      for (const runMember of longestSerialChain(creature)?.members ?? []) {
        creature.neurons[runMember.index].setSquash(CEILING_SQUASH);
        creature.neurons[runMember.index].fix();
      }
      population.push(creature);
      continue;
    }

    // Two copies. `driver` takes every draw the operator makes — that is the
    // stream production sees. `subject` takes only the draws that landed on a
    // run member, so it stays the GRQ creature with a re-squashed run rather
    // than a creature whose every neuron has been re-squashed 30 times, which
    // is what it takes for ~1% of uniform draws to reach a 28-member run.
    // `focus: any` measures the stream itself, so the two are the same copy.
    const driver = Creature.fromJSON(json);
    const subject = config.focus === "chain" ? Creature.fromJSON(json) : driver;
    // Squash mutation never changes the topology, so the run is found once.
    const runMembers = new Set(
      longestSerialChain(driver)?.members.map((m) => m.index) ?? [],
    );
    const operator = new ModActivation(driver, undefined, {
      deepChainSquashBias: bias,
      deepChainMinLength: config.minLength,
    });

    const wanted = config.mutations;
    // A draw can decline (the operator refuses an output neuron under a
    // squash pin, or redraws the squash it already had), so even `any` needs
    // slack over the number of draws asked for.
    const attemptCap = config.focus === "chain" ? wanted * 1000 : wanted * 4;
    let kept = 0;
    let attempts = 0;

    while (kept < wanted && attempts < attemptCap) {
      attempts++;
      const before = driver.neurons.map((n) => n.squash);
      if (!operator.mutate()) continue;

      const changed: number[] = [];
      for (let n = 0; n < driver.neurons.length; n++) {
        const squash = driver.neurons[n].squash;
        if (squash !== undefined && squash !== before[n]) changed.push(n);
      }
      const counted = config.focus === "chain"
        ? changed.filter((index) => runMembers.has(index))
        : changed;
      if (counted.length === 0) continue;

      kept++;
      for (const index of counted) {
        const squash = driver.neurons[index].squash as string;
        applied++;
        if (isGradientBlockingSquash(squash)) blocking++;
        if (subject !== driver) {
          subject.neurons[index].setSquash(squash);
          subject.neurons[index].fix();
        }
      }
    }

    if (kept < wanted) {
      throw new RangeError(
        `only ${kept} of ${wanted} draws landed in the run after ${attempts} ` +
          `attempts — raise the attempt budget or lower --mutations`,
      );
    }
    population.push(subject);
  }

  const histogram = computeSquashHistogram(population);
  const genus = new Genus();
  for (const creature of population) {
    CreatureUtil.makeUUID(creature);
    genus.addCreature(creature);
  }

  const first = population[0];
  const chain = longestSerialChain(first);
  const chainMembers = chain?.members.length ?? 0;
  const chainBlockingMembers = chain === undefined ? 0 : chain.members.filter(
    (m) =>
      first.neurons[m.index].squash !== undefined &&
      isGradientBlockingSquash(first.neurons[m.index].squash as string),
  ).length;

  const result: BiasArmResult = {
    arm,
    bias,
    applied,
    blocking,
    histogram,
    distinctSquashes: Object.keys(histogram).length,
    entropyBits: histogramEntropyBits(histogram),
    speciesCount: genus.speciesMap.size,
    speciesDiversity: computeSpeciesDiversity(
      genus.speciesMap.size,
      population.length,
    ),
    chainBlockingMembers,
    chainMembers,
  };

  if (!config.profileOnly && chain !== undefined) {
    const rows = syntheticObservations(
      first.input,
      config.samples,
      config.seed,
      config.observationScale,
    );
    const profile = probeGradientDepth(first, rows);
    const startDepth = chain.startDepth;
    // #3973's harness already owns both readings; reuse rather than copy.
    result.chain = chainZeroGradient(profile);
    result.upstream = pooledZeroGradient(profile, startDepth);
    result.chainCauses = profile.serialChainProfile?.aggregate.zeroCauses;
  }

  return result;
}

/** Run both arms of the comparison. */
export async function runSquashBiasComparison(
  config: SquashBiasConfig,
): Promise<SquashBiasReport> {
  const json = JSON.parse(
    await Deno.readTextFile(config.creaturePath),
  ) as CreatureExport;
  const creature = Creature.fromJSON(json);
  const chain = longestSerialChain(creature);
  if (chain === undefined) {
    throw new RangeError(
      `${config.creaturePath} has no serial run — nothing for the bias to act on`,
    );
  }

  return {
    config,
    provenance: `${config.creaturePath}; SYNTHETIC seeded uniform ` +
      `[-${config.observationScale}, ${config.observationScale}) probe rows, ` +
      `seed ${config.seed} — not production data`,
    chainStartDepth: chain.startDepth,
    chainLength: chain.members.length,
    arms: [
      runArm("baseline", json, config),
      runArm("biased", json, config),
      runArm("ceiling", json, config),
    ],
  };
}

/** Render the report as the Markdown committed under `docs/evidence/`. */
export function renderSquashBiasReport(report: SquashBiasReport): string {
  const { config } = report;
  const lines: string[] = [
    "# Depth-aware squash bias — matched baseline (Issue #3974)",
    "",
    `- Creature: \`${config.creaturePath}\``,
    `- Serial run: ${report.chainLength} members from depth ` +
    `${report.chainStartDepth}`,
    `- Draws: ${config.mutations} squash mutations × ${config.population} ` +
    `creatures, focus \`${config.focus}\`, seed ${config.seed}`,
    `- Bias arm: \`deepChainSquashBias: ${config.bias}\`, ` +
    `\`deepChainMinLength: ${config.minLength}\``,
    `- Probe rows: ${
      config.profileOnly ? "none (profile skipped)" : config.samples
    }`,
    `- Provenance: ${report.provenance}`,
    "",
    "## What the draws proposed",
    "",
    "| Arm | Squash mutations | Blocking | Share |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const arm of report.arms) {
    lines.push(
      `| ${arm.arm} | ${arm.applied} | ${arm.blocking} | ` +
        `${pct(arm.applied === 0 ? 0 : arm.blocking / arm.applied)} |`,
    );
  }

  lines.push(
    "",
    "## Diversity, against the matched baseline",
    "",
    "The `ceiling` arm takes no draws, so its population is one creature " +
      "repeated: its species count is 1 by construction and is not a diversity " +
      "reading. Compare `baseline` against `biased`.",
    "",
    "| Arm | Distinct squashes | Entropy (bits) | Species | Species diversity |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const arm of report.arms) {
    lines.push(
      `| ${arm.arm} | ${arm.distinctSquashes} | ` +
        `${arm.entropyBits.toFixed(3)} | ${arm.speciesCount} | ` +
        `${arm.speciesDiversity.toFixed(3)} |`,
    );
  }

  lines.push(
    "",
    "## The run itself",
    "",
    "| Arm | Blocking members | Members | Run zero-gradient | Depths 1→entry |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const arm of report.arms) {
    lines.push(
      `| ${arm.arm} | ${arm.chainBlockingMembers} | ${arm.chainMembers} | ` +
        `${arm.chain === undefined ? "n/a" : pct(arm.chain.zeroFraction)} | ` +
        `${
          arm.upstream === undefined ? "n/a" : pct(arm.upstream.zeroFraction)
        } |`,
    );
  }

  const causeArms = report.arms.filter((arm) => arm.chainCauses !== undefined);
  if (causeArms.length > 0) {
    const causes = new Set<string>();
    for (const arm of causeArms) {
      for (const [cause, count] of Object.entries(arm.chainCauses ?? {})) {
        if (count > 0) causes.add(cause);
      }
    }
    lines.push(
      "",
      "## What the probe blames the run's zero gradients on",
      "",
      `| Cause | ${causeArms.map((a) => a.arm).join(" | ")} |`,
      `| --- | ${causeArms.map(() => "---:").join(" | ")} |`,
    );
    for (const cause of [...causes].sort()) {
      const cells = causeArms.map((arm) =>
        String((arm.chainCauses ?? {})[cause as ZeroGradientCause] ?? 0)
      );
      lines.push(`| ${cause} | ${cells.join(" | ")} |`);
    }
  }

  lines.push(
    "",
    "## Squash histogram",
    "",
    `| Squash | ${report.arms.map((a) => a.arm).join(" | ")} | Blocking |`,
    `| --- | ${report.arms.map(() => "---:").join(" | ")} | --- |`,
  );
  const names = new Set<string>();
  for (const arm of report.arms) {
    for (const name of Object.keys(arm.histogram)) names.add(name);
  }
  for (const name of [...names].sort()) {
    const cells = report.arms.map((arm) => arm.histogram[name] ?? 0);
    lines.push(
      `| ${name} | ${cells.join(" | ")} | ` +
        `${isGradientBlockingSquash(name) ? "yes" : "no"} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

if (import.meta.main) {
  const flags = parseFlags(Deno.args, [
    "creature",
    "bias",
    "min-length",
    "mutations",
    "population",
    "focus",
    "seed",
    "samples",
    "obs-scale",
    "profile-only",
    "step1",
    "output",
  ]);
  const focus = flags.get("focus") ?? SQUASH_BIAS_DEFAULTS.focus;
  const config = withSquashBiasDefaults({
    creaturePath: flags.get("creature") ?? SQUASH_BIAS_DEFAULTS.creaturePath,
    bias: numericFlag("bias", flags.get("bias"), SQUASH_BIAS_DEFAULTS.bias),
    minLength: numericFlag(
      "min-length",
      flags.get("min-length"),
      SQUASH_BIAS_DEFAULTS.minLength,
      { integer: true, minimum: 2 },
    ),
    mutations: numericFlag(
      "mutations",
      flags.get("mutations"),
      SQUASH_BIAS_DEFAULTS.mutations,
      { integer: true, minimum: 1 },
    ),
    population: numericFlag(
      "population",
      flags.get("population"),
      SQUASH_BIAS_DEFAULTS.population,
      { integer: true, minimum: 1 },
    ),
    focus: focus === "any" ? "any" : "chain",
    seed: numericFlag("seed", flags.get("seed"), SQUASH_BIAS_DEFAULTS.seed, {
      integer: true,
    }),
    samples: numericFlag(
      "samples",
      flags.get("samples"),
      SQUASH_BIAS_DEFAULTS.samples,
      { integer: true, minimum: 1 },
    ),
    observationScale: numericFlag(
      "obs-scale",
      flags.get("obs-scale"),
      SQUASH_BIAS_DEFAULTS.observationScale,
    ),
    profileOnly: (flags.get("profile-only") ?? "false") === "true",
  });

  if ((flags.get("step1") ?? "false") === "true") {
    const creature = Creature.fromJSON(
      JSON.parse(
        await Deno.readTextFile(config.creaturePath),
      ) as CreatureExport,
    );
    const rendered = renderRoleVisibility(
      config.creaturePath,
      measureRoleVisibility(creature),
    );
    const target = flags.get("output");
    if (target !== undefined) {
      await Deno.writeTextFile(target, rendered);
    } else {
      console.log(rendered);
    }
    Deno.exit(0);
  }

  const report = await runSquashBiasComparison(config);
  const rendered = renderSquashBiasReport(report);
  const output = flags.get("output");
  if (output !== undefined) {
    await Deno.writeTextFile(output, rendered);
  } else {
    console.log(rendered);
  }
}
