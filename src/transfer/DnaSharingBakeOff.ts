/**
 * DnaSharingBakeOff.ts - Reusable bake-off harness for DnaSharingStrategy.
 *
 * Issue #2491: Runs each candidate primitive against the same baseline
 * (production cluster vs Europa island) on the same probe dataset. The CLI
 * entry point lives in `bench/DnaSharingBakeOff.ts`; this module exposes
 * `runBakeOff()` so unit tests can exercise the harness with a fake
 * strategy without going through CLI argument parsing or file I/O.
 *
 * Score convention: higher is better. The harness uses negative MSE on the
 * probe dataset so the recorded `lift` is positive when a strategy improves
 * the recipient.
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { MSE } from "@costs/MSE.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { DnaSharingStrategy } from "./DnaSharingStrategy.ts";

/**
 * One row in the harness Markdown output. Mirrors the acceptance criteria
 * fields verbatim — the parent issue (#2490) tracks structural failure via
 * `hiddenUuidsShared`, so it must remain in the row.
 */
export interface BakeOffRow {
  /** Strategy short name (`DnaSharingStrategy.name`). */
  name: string;
  /** Score before `prepare` runs. */
  baselineScore: number;
  /** Score after `prepare` plus the harness evolution loop. */
  finalScore: number;
  /** `finalScore - baselineScore`. Positive = improvement over baseline. */
  lift: number;
  /** Count of donor hidden-neuron UUIDs surviving in the recipient lineage. */
  hiddenUuidsShared: number;
  /** Recipient neuron count after `prepare`. */
  neurons: number;
  /** Recipient synapse count after `prepare`. */
  synapses: number;
  /** Wall-clock duration for this strategy row, in milliseconds. */
  durationMs: number;
}

/**
 * Per-strategy hook the harness calls after `prepare` to run the fixed
 * generation budget on the prepared recipient. The default implementation
 * is a no-op (just returns the baseline score), so the harness runs end to
 * end before any real evolution loop is wired in. Bench callers can pass a
 * real loop; tests can pass a deterministic stub.
 */
export type EvolveStep = (
  recipient: Creature,
  probe: DataRecordInterface[],
  generations: number,
  seed: number,
) => Promise<number> | number;

/** Inputs to {@link runBakeOff}. */
export interface BakeOffOptions {
  /** Production cluster creature (the recipient that gets DNA injected). */
  recipient: CreatureExport;
  /** Europa island creature (the donor whose DNA is being shared). */
  donor: CreatureExport;
  /** Probe dataset used for baseline and final scoring. */
  probe: DataRecordInterface[];
  /** Strategies to bake off. NoOpStrategy is conventionally the first row. */
  strategies: DnaSharingStrategy[];
  /** Generation budget passed to every strategy. Default 1000. */
  generations?: number;
  /** Deterministic RNG seed shared across strategies. Default 42. */
  seed?: number;
  /**
   * Optional evolution hook (see {@link EvolveStep}). Defaults to a no-op
   * that re-scores the unchanged recipient — the bake-off harness then
   * still produces a meaningful row when only `prepare` mutates structure.
   */
  evolveStep?: EvolveStep;
}

const DEFAULT_GENERATIONS = 1000;
const DEFAULT_SEED = 42;

/** Returns the count of donor hidden-neuron UUIDs present in `recipient`. */
export function countSharedHiddenUuids(
  recipient: Creature,
  donor: Creature,
): number {
  const donorHiddenUuids = new Set<string>();
  for (const neuron of donor.neurons) {
    if (neuron.type === "hidden" && typeof neuron.uuid === "string") {
      donorHiddenUuids.add(neuron.uuid);
    }
  }
  if (donorHiddenUuids.size === 0) return 0;

  let shared = 0;
  for (const neuron of recipient.neurons) {
    if (
      neuron.type === "hidden" &&
      typeof neuron.uuid === "string" &&
      donorHiddenUuids.has(neuron.uuid)
    ) {
      shared++;
    }
  }
  return shared;
}

/**
 * Score `creature` against `probe` as `-MSE`. Higher is better, zero is
 * perfect. Uses the public {@link Creature.activate} so the harness exercises
 * the same WASM path as production.
 */
export function scoreOnProbe(
  creature: Creature,
  probe: DataRecordInterface[],
): number {
  if (probe.length === 0) return 0;
  const cost = new MSE();
  let totalError = 0;
  for (const sample of probe) {
    const output = creature.activate(sample.input, false);
    totalError += cost.calculate(sample.output, output);
  }
  return -(totalError / probe.length);
}

/** Default no-op evolution step — re-scores the unchanged recipient. */
const defaultEvolveStep: EvolveStep = (recipient, probe, _gens, _seed) =>
  scoreOnProbe(recipient, probe);

/**
 * Run the bake-off. Returns one {@link BakeOffRow} per input strategy in the
 * same order. All strategies share the same generation budget, seed, and
 * probe dataset. The recipient is cloned per strategy so rows are independent.
 */
export async function runBakeOff(
  opts: BakeOffOptions,
): Promise<BakeOffRow[]> {
  const generations = opts.generations ?? DEFAULT_GENERATIONS;
  const seed = opts.seed ?? DEFAULT_SEED;
  const evolveStep = opts.evolveStep ?? defaultEvolveStep;

  const rows: BakeOffRow[] = [];
  for (const strategy of opts.strategies) {
    const start = performance.now();

    // Fresh clone per strategy so rows do not contaminate each other.
    const recipient = Creature.fromJSON(opts.recipient);
    const donor = Creature.fromJSON(opts.donor);

    const baselineScore = scoreOnProbe(recipient, opts.probe);

    // Strategies must run sequentially: each gets its own clean recipient
    // clone, its own per-row timing, and the same shared activation/WASM
    // state. Parallelising here would make `durationMs` and global RNG
    // unreproducible.
    // deno-lint-ignore no-await-in-loop
    await strategy.prepare(recipient, donor, { seed, generations });

    // Same rationale as above — sequential per-strategy evolution.
    // deno-lint-ignore no-await-in-loop
    const finalScore = await evolveStep(
      recipient,
      opts.probe,
      generations,
      seed,
    );

    const hiddenUuidsShared = countSharedHiddenUuids(recipient, donor);
    const durationMs = performance.now() - start;

    rows.push({
      name: strategy.name,
      baselineScore,
      finalScore,
      lift: finalScore - baselineScore,
      hiddenUuidsShared,
      neurons: recipient.neurons.length,
      synapses: recipient.synapses.length,
      durationMs,
    });
  }
  return rows;
}

/** Format `n` to a fixed-precision string, handling non-finite values. */
function fmtNumber(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(digits);
}

/** Render bake-off rows as a Markdown table — the harness stdout format. */
export function formatBakeOffMarkdown(rows: BakeOffRow[]): string {
  const header =
    "| Strategy | Baseline | Final | Lift | Hidden UUIDs Shared | Neurons | Synapses | Duration (ms) |";
  const sep = "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
  const body = rows.map((r) =>
    `| ${r.name} | ${fmtNumber(r.baselineScore)} | ${
      fmtNumber(r.finalScore)
    } | ${
      fmtNumber(r.lift)
    } | ${r.hiddenUuidsShared} | ${r.neurons} | ${r.synapses} | ${
      fmtNumber(r.durationMs, 2)
    } |`
  );
  return [header, sep, ...body].join("\n");
}
