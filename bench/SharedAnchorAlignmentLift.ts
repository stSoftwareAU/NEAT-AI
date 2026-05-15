/**
 * Shared-anchor alignment lift bench (Issue #2655).
 *
 * The foundation harness in `bench/CrossSpeciesBreedingProportion.ts`
 * uses a fixture pair with **zero** shared hidden UUIDs and drives
 * `Offspring.breed`, which does its own neuron-map alignment instead
 * of calling `createCompatibleFather*`. The shared-anchor strategy
 * (Issue #2655) lives inside `createCompatibleFather*`, so it does
 * **not** influence the foundation harness on those fixtures (no
 * regression, but also no lift to demonstrate).
 *
 * This bench therefore measures the quantity the strategy is designed
 * to improve: the proportion of the father's hidden neurons that
 * `createCompatibleFather` aligns to a mother UUID (i.e. the proportion
 * of mother UUIDs appearing in the adjusted-father export). It is run
 * twice on the same partial-overlap parent pair:
 *
 *   - **Before**: synthetic-UUID alignment fully disabled
 *     (`syntheticAlignmentThreshold = 0`). Only stable real-UUID
 *     matching and connectivity-key matching contribute.
 *   - **After**: default threshold (1.0) so the synthetic pass — now
 *     including the new shared-anchor anchors — runs end-to-end.
 *
 * Statistical protocol matches the foundation harness: Mann–Whitney U,
 * two-sided, normal approximation with tie + continuity correction,
 * α = 0.05. The bench injects controllable mutations into the partial-
 * overlap father between iterations to vary the input distribution; in
 * the deterministic case it falls back to repeating the same fixture so
 * the test still runs and reports a constant baseline.
 *
 * Construction: load `europa.json` as the mother, then build a
 * partial-overlap father by taking `grq-cluster.json` and rewriting
 * `K` of its hidden UUIDs (and the corresponding synapse endpoints)
 * to match `K` mother UUIDs at the same array position. The resulting
 * father shares those `K` real UUIDs with the mother — typical of the
 * 0.4–3.2% overlap regime documented in
 * `docs/evidence/cross-species-baseline.md`.
 *
 * Running:
 * ```
 * deno run --allow-read --allow-write --allow-env --allow-ffi \
 *   bench/SharedAnchorAlignmentLift.ts \
 *   [--n=200] [--shared=4] [--out=path.json]
 * ```
 *
 * @module
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { describe, mannWhitneyU } from "@utils/Statistics.ts";
import { createCompatibleFather } from "@breed/Father.ts";

const DEFAULT_N = 200;
const DEFAULT_SHARED = 4;
const DEFAULT_MOTHER = "test/fixtures/cross-species/europa.json";
const DEFAULT_FATHER = "test/fixtures/cross-species/grq-cluster.json";

/**
 * Rewrite `k` of `father`'s hidden-neuron UUIDs (in array order) so they
 * match the first `k` of `mother`'s hidden-neuron UUIDs. Synapse endpoints
 * referencing the rewritten UUIDs are updated accordingly. Returns a deep
 * clone — the inputs are not mutated.
 */
export function buildPartialOverlapFather(
  mother: CreatureExport,
  father: CreatureExport,
  k: number,
): CreatureExport {
  const out: CreatureExport = structuredClone(father);
  const motherHidden = mother.neurons.filter((n) => n.type === "hidden");
  const fatherHidden = out.neurons.filter((n) => n.type === "hidden");
  const limit = Math.min(k, motherHidden.length, fatherHidden.length);
  const renames = new Map<string, string>();
  for (let i = 0; i < limit; i++) {
    const oldUuid = fatherHidden[i].uuid as string;
    const newUuid = motherHidden[i].uuid as string;
    if (oldUuid === newUuid) continue;
    fatherHidden[i].uuid = newUuid;
    renames.set(oldUuid, newUuid);
  }
  if (renames.size === 0) return out;
  for (const s of out.synapses) {
    if (s.fromUUID && renames.has(s.fromUUID)) {
      s.fromUUID = renames.get(s.fromUUID)!;
    }
    if (s.toUUID && renames.has(s.toUUID)) {
      s.toUUID = renames.get(s.toUUID)!;
    }
  }
  return out;
}

/**
 * Measure the proportion of hidden neurons in `adjustedFather` whose
 * `uuid` is also present in `mother`'s hidden-neuron UUID set. This is
 * the alignment quality metric the shared-anchor strategy is designed
 * to lift.
 */
export function alignedHiddenProportion(
  adjustedFather: CreatureExport,
  motherHiddenUuids: Set<string>,
): number {
  const fatherHidden = adjustedFather.neurons.filter((n) =>
    n.type === "hidden"
  );
  if (fatherHidden.length === 0) return 1;
  let aligned = 0;
  for (const n of fatherHidden) {
    if (typeof n.uuid === "string" && motherHiddenUuids.has(n.uuid)) {
      aligned++;
    }
  }
  return aligned / fatherHidden.length;
}

interface AxisStats {
  n: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

function statsOf(values: number[]): AxisStats {
  const d = describe(values);
  return {
    n: d.n,
    mean: round(d.mean),
    stddev: round(d.stddev),
    min: round(d.min),
    max: round(d.max),
  };
}

function round(x: number, digits = 6): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of Deno.args) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}

/**
 * Build N variants of the partial-overlap father by rotating which K
 * hidden UUIDs are renamed. This produces a non-degenerate distribution
 * of alignment proportions — without rotation each run is deterministic.
 */
export function buildPartialOverlapVariants(
  mother: CreatureExport,
  father: CreatureExport,
  k: number,
  n: number,
): CreatureExport[] {
  const out: CreatureExport[] = [];
  const motherHidden = mother.neurons.filter((n) => n.type === "hidden");
  const fatherHidden = father.neurons.filter((n) => n.type === "hidden");
  const limit = Math.min(motherHidden.length, fatherHidden.length);
  const motherUuids = motherHidden.map((n) => n.uuid as string);
  // Each variant picks K mother UUIDs starting at a different rotated offset
  // and pairs them with K father indices starting at a different rotated
  // offset — so each variant exercises a distinct shared-anchor pattern.
  for (let variant = 0; variant < n; variant++) {
    const v: CreatureExport = structuredClone(father);
    const fatherHiddenLocal = v.neurons.filter((nn) => nn.type === "hidden");
    const renames = new Map<string, string>();
    const motherOffset = variant % limit;
    const fatherOffset = (variant * 7) % limit; // step of 7 keeps coverage broad
    for (let j = 0; j < k && j < limit; j++) {
      const fIdx = (fatherOffset + j) % limit;
      const mIdx = (motherOffset + j) % limit;
      const oldUuid = fatherHiddenLocal[fIdx].uuid as string;
      const newUuid = motherUuids[mIdx];
      if (oldUuid === newUuid) continue;
      fatherHiddenLocal[fIdx].uuid = newUuid;
      renames.set(oldUuid, newUuid);
    }
    if (renames.size > 0) {
      for (const s of v.synapses) {
        if (s.fromUUID && renames.has(s.fromUUID)) {
          s.fromUUID = renames.get(s.fromUUID)!;
        }
        if (s.toUUID && renames.has(s.toUUID)) {
          s.toUUID = renames.get(s.toUUID)!;
        }
      }
    }
    out.push(v);
  }
  return out;
}

if (import.meta.main) {
  const n = Number(flag("n") ?? DEFAULT_N);
  const k = Number(flag("shared") ?? DEFAULT_SHARED);
  const motherPath = flag("mother") ?? DEFAULT_MOTHER;
  const fatherPath = flag("father") ?? DEFAULT_FATHER;
  const outPath = flag("out");

  const motherExport = JSON.parse(
    await Deno.readTextFile(motherPath),
  ) as CreatureExport;
  const fatherExport = JSON.parse(
    await Deno.readTextFile(fatherPath),
  ) as CreatureExport;

  const motherHiddenUuids = new Set<string>(
    motherExport.neurons
      .filter((n) => n.type === "hidden")
      .map((n) => n.uuid as string),
  );

  const variants = buildPartialOverlapVariants(
    motherExport,
    fatherExport,
    k,
    n,
  );

  const beforeValues: number[] = [];
  const afterValues: number[] = [];
  for (const v of variants) {
    // Before: threshold = 0 disables the synthetic-UUID pass entirely.
    const before = createCompatibleFather(
      structuredClone(motherExport),
      structuredClone(v),
      0,
    );
    beforeValues.push(alignedHiddenProportion(before, motherHiddenUuids));
    // After: threshold = 1.0 always fires the synthetic-UUID pass (which
    // now includes the shared-anchor anchors from Issue #2655).
    const after = createCompatibleFather(
      structuredClone(motherExport),
      structuredClone(v),
      1.0,
    );
    afterValues.push(alignedHiddenProportion(after, motherHiddenUuids));
  }

  const u = mannWhitneyU(beforeValues, afterValues);

  const payload = {
    issue: 2655,
    n,
    sharedHiddenInjected: k,
    mother: motherPath.split("/").pop() ?? motherPath,
    father: fatherPath.split("/").pop() ?? fatherPath,
    metric: "alignedHiddenProportion (mother UUIDs / father hidden count)",
    before: statsOf(beforeValues),
    after: statsOf(afterValues),
    mannWhitneyU: {
      U: round(u.U),
      z: round(u.z),
      pValue: round(u.pValue),
    },
  };
  const text = JSON.stringify(payload, null, 2) + "\n";
  if (outPath) {
    await Deno.writeTextFile(outPath, text);
    console.error(`wrote ${outPath} (n=${n}, shared=${k})`);
  } else {
    console.log(text);
  }
}
