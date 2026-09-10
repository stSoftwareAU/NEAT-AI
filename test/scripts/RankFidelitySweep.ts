/**
 * Issue #3927: the rank-fidelity sweep must score every rate at every distinct
 * stride phase, judge each against the full-corpus ordering, and reach a
 * verdict — including the verdict that no rate is safe.
 *
 * Wall-clock is **not** asserted. Tests run in parallel, so a real timing
 * assertion would be flaky (AGENTS.md testing policy); the harness therefore
 * takes an injectable clock and this test drives a virtual one, exactly as
 * `bench/fitness_corpus_fidelity_test.ts` does. Real numbers belong in the
 * harness output and in `docs/evidence/rank-fidelity-3927.md`.
 */

import { assertAlmostEquals, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  loadCorpus,
  loadCreatures,
  markdownReport,
  measureRankFidelity,
} from "../../scripts/rank_fidelity_sweep.ts";

const INPUTS = 3;
const OUTPUTS = 1;

/** A clock that advances one unit per read — deterministic, never wall-clock. */
function virtualClock(): () => number {
  let tick = 0;
  return () => tick++;
}

/**
 * A population whose members differ only in one weight, so their scores are
 * distinct but close — the shape of a real GRQ population, at a size a unit
 * test can score in milliseconds.
 */
function population(count: number, step = 0.05): {
  creatures: Creature[];
  creatureNames: string[];
} {
  const creatures: Creature[] = [];
  const creatureNames: string[] = [];
  for (let i = 0; i < count; i++) {
    creatures.push(Creature.fromJSON({
      neurons: [
        { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.05 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.4 + i * step },
        { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.3 + i * step },
        { fromUUID: "input-2", toUUID: "output-0", weight: 0.2 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
      ],
      input: INPUTS,
      output: OUTPUTS,
    }));
    creatureNames.push(`creature-${i}`);
  }
  return { creatures, creatureNames };
}

/** A deterministic corpus; every record is a different point of the domain. */
function corpus(records: number): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < records; i++) {
    rows.push({
      input: new Float32Array([
        Math.sin(i * 0.7),
        Math.cos(i * 0.31),
        Math.sin(i * 0.11),
      ]),
      output: new Float32Array([Math.tanh(Math.sin(i * 0.7) * 0.6)]),
    });
  }
  return rows;
}

Deno.test("rank fidelity sweep - measures every rate at every distinct phase", async () => {
  const { creatures, creatureNames } = population(8);
  const result = await measureRankFidelity({
    creatures,
    creatureNames,
    corpus: corpus(80),
    corpusProvenance: "synthetic",
    rates: [1, 0.5, 0.25, 0.1],
    phases: 4,
    topK: [1, 3, 5],
    acceptGap: 1e-5,
    minTop1: 0.9,
    now: virtualClock(),
  });

  assertEquals(result.rates.map((r) => r.rate), [1, 0.5, 0.25, 0.1]);
  // Rate 0.5 has only two strata, so it reports two phases, not the four
  // asked for — inventing duplicates would report noise the estimator has not.
  assertEquals(result.rates.map((r) => r.phasesMeasured), [1, 2, 4, 4]);
  assertEquals(result.rates.map((r) => r.stride), [1, 2, 4, 10]);
  assertEquals(result.rates.map((r) => r.records), [80, 40, 20, 8]);
  assertEquals(result.population, 8);
  assertEquals(result.records, 80);
  assertEquals(result.corpusProvenance, "synthetic");
});

Deno.test("rank fidelity sweep - the full corpus is its own ground truth", async () => {
  const { creatures, creatureNames } = population(6);
  const result = await measureRankFidelity({
    creatures,
    creatureNames,
    corpus: corpus(40),
    corpusProvenance: "synthetic",
    rates: [1, 0.25],
    phases: 4,
    topK: [1, 3, 5],
    acceptGap: 1e-5,
    minTop1: 0.9,
    now: virtualClock(),
  });

  const full = result.rates[0];
  assertAlmostEquals(full.spearmanRho.min, 1, 1e-12);
  assertAlmostEquals(full.kendallTau.min, 1, 1e-12);
  assertEquals(full.topK[1].mean, 1);
  assertEquals(full.gapResolutionWorst, 0);
  // Ground truth is not assessed: it cannot disagree with itself.
  assertEquals(full.verdict, null);
  assertEquals(result.truthErrors.length, 6);
  assertEquals(
    result.truthSpread.best <= result.truthSpread.worst,
    true,
  );
});

Deno.test("rank fidelity sweep - every sampled rate reaches a verdict against the failure signals", async () => {
  // Margins of ~1e-7 in weight space put the gaps between adjacent creatures
  // far below the noise a sample cut at a stride introduces — the case Issue #3927
  // warns about, where the generation counter races while the search stops
  // improving. Every sampled rate must come back unsafe.
  const { creatures, creatureNames } = population(6, 1e-7);
  const result = await measureRankFidelity({
    creatures,
    creatureNames,
    corpus: corpus(40),
    corpusProvenance: "synthetic",
    rates: [1, 0.5, 0.25],
    phases: 4,
    topK: [1, 3, 5],
    acceptGap: 1e-5,
    minTop1: 0.9,
    now: virtualClock(),
  });

  for (const rate of result.rates.slice(1)) {
    assertEquals(rate.verdict !== null, true);
    assertEquals(rate.verdict?.safe, false);
    assertEquals(rate.verdict!.failures.length > 0, true);
  }
  assertEquals(result.recommendedRate, null);
  assertEquals(
    markdownReport(result).includes("**No sampled rate is safe.**"),
    true,
  );
});

Deno.test("rank fidelity sweep - a rate that preserves the ordering is recommended", async () => {
  const { creatures, creatureNames } = population(6);
  const result = await measureRankFidelity({
    creatures,
    creatureNames,
    corpus: corpus(40),
    corpusProvenance: "synthetic",
    rates: [1, 0.5],
    phases: 4,
    topK: [1, 3, 5],
    // Thresholds wide enough that only a genuine rank inversion would fail.
    acceptGap: 1,
    minTop1: 0.9,
    now: virtualClock(),
  });

  assertEquals(result.rates[1].verdict?.safe, true);
  assertEquals(result.recommendedRate, 0.5);
  const report = markdownReport(result);
  assertEquals(report.includes("**Recommended rate: 0.5**"), true);
  assertEquals(report.includes("Corpus: **synthetic**"), true);
});

Deno.test("rank fidelity sweep - the report names the corpus that produced it", async () => {
  const { creatures, creatureNames } = population(5);
  const result = await measureRankFidelity({
    creatures,
    creatureNames,
    corpus: corpus(20),
    corpusProvenance: "production",
    rates: [1, 0.5],
    phases: 2,
    topK: [1, 3, 5],
    acceptGap: 1e-5,
    minTop1: 0.9,
    now: virtualClock(),
  });
  assertEquals(markdownReport(result).includes("Corpus: **production**"), true);
});

Deno.test("rank fidelity sweep - scoring only the full corpus reaches no verdict", async () => {
  const { creatures, creatureNames } = population(5);
  const result = await measureRankFidelity({
    creatures,
    creatureNames,
    corpus: corpus(20),
    corpusProvenance: "synthetic",
    rates: [1],
    phases: 4,
    topK: [1, 3, 5],
    acceptGap: 1e-5,
    minTop1: 0.9,
    now: virtualClock(),
  });

  assertEquals(result.recommendedRate, null);
  // "No rate is safe" would report a finding the sweep never measured.
  const report = markdownReport(result);
  assertEquals(report.includes("**No sampled rate was measured**"), true);
  assertEquals(report.includes("No sampled rate is safe"), false);
});

Deno.test("rank fidelity sweep - a rate set without the full corpus is refused", async () => {
  const { creatures, creatureNames } = population(5);
  await assertRejects(
    () =>
      measureRankFidelity({
        creatures,
        creatureNames,
        corpus: corpus(20),
        corpusProvenance: "synthetic",
        rates: [0.5, 0.25],
        phases: 2,
        topK: [1, 3, 5],
        acceptGap: 1e-5,
        minTop1: 0.9,
        now: virtualClock(),
      }),
    Error,
    "must include 1",
  );
});

Deno.test("rank fidelity sweep - a population too small for top-5 is refused", async () => {
  const { creatures, creatureNames } = population(4);
  await assertRejects(
    () =>
      measureRankFidelity({
        creatures,
        creatureNames,
        corpus: corpus(20),
        corpusProvenance: "synthetic",
        rates: [1, 0.5],
        phases: 2,
        topK: [1, 3, 5],
        acceptGap: 1e-5,
        minTop1: 0.9,
        now: virtualClock(),
      }),
    Error,
    "at least 5 creatures",
  );
});

Deno.test("rank fidelity sweep - a top-k set the report cannot fill is refused", async () => {
  const { creatures, creatureNames } = population(5);
  await assertRejects(
    () =>
      measureRankFidelity({
        creatures,
        creatureNames,
        corpus: corpus(20),
        corpusProvenance: "synthetic",
        rates: [1, 0.5],
        phases: 2,
        // The report has fixed Top-1/3/5 columns; omitting 3 would print a
        // figure the sweep never measured.
        topK: [1, 5],
        acceptGap: 1e-5,
        minTop1: 0.9,
        now: virtualClock(),
      }),
    Error,
    "top-k must include 1, 3, 5",
  );
});

Deno.test("rank fidelity sweep - a creature whose shape misses the corpus is refused", async () => {
  const { creatures, creatureNames } = population(5);
  await assertRejects(
    () =>
      measureRankFidelity({
        creatures,
        creatureNames,
        // Two inputs where the population expects three.
        corpus: [{
          input: new Float32Array([0.1, 0.2]),
          output: new Float32Array([0.3]),
        }],
        corpusProvenance: "synthetic",
        rates: [1],
        phases: 1,
        topK: [1, 3, 5],
        acceptGap: 1e-5,
        minTop1: 0.9,
        now: virtualClock(),
      }),
    Error,
    "but the corpus is 2→1",
  );
});

Deno.test("rank fidelity sweep - a population of identical creatures is unmeasurable, not perfect", async () => {
  const creatures = Array.from({ length: 5 }, () =>
    Creature.fromJSON({
      neurons: [
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-2", toUUID: "output-0", weight: 0.5 },
      ],
      input: INPUTS,
      output: OUTPUTS,
    }));
  await assertRejects(
    () =>
      measureRankFidelity({
        creatures,
        creatureNames: creatures.map((_, i) => `clone-${i}`),
        corpus: corpus(20),
        corpusProvenance: "synthetic",
        rates: [1],
        phases: 1,
        topK: [1, 3, 5],
        acceptGap: 1e-5,
        minTop1: 0.9,
        now: virtualClock(),
      }),
    Error,
    "there is no ordering to preserve",
  );
});

Deno.test("rank fidelity sweep - loadCreatures refuses a population smaller than asked for", () => {
  const dir = Deno.makeTempDirSync({ prefix: "rank-fidelity-creatures-" });
  try {
    const { creatures } = population(3);
    creatures.forEach((creature, i) => {
      Deno.writeTextFileSync(
        `${dir}/c${i}.json`,
        JSON.stringify(creature.exportJSON()),
      );
    });
    // Not a creature: it must not be counted or parsed.
    Deno.writeTextFileSync(`${dir}/README.md`, "not a creature");

    const loaded = loadCreatures(dir, 3);
    assertEquals(loaded.names, ["c0.json", "c1.json", "c2.json"]);
    assertEquals(loaded.creatures.length, 3);
    assertEquals(loaded.creatures[0].input, INPUTS);

    let refused = "";
    try {
      loadCreatures(dir, 50);
    } catch (error) {
      refused = (error as Error).message;
    }
    assertEquals(refused.includes("fewer than the 50 required"), true);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("rank fidelity sweep - loadCorpus reads shards in lexicographic order and refuses a short corpus", () => {
  const dir = Deno.makeTempDirSync({ prefix: "rank-fidelity-corpus-" });
  try {
    // Two shards of two 3→1 records each, deliberately written out of name
    // order to prove the reader sorts them lexicographically.
    const write = (name: string, start: number) => {
      const values = new Float32Array(2 * (INPUTS + OUTPUTS));
      for (let i = 0; i < values.length; i++) values[i] = start + i;
      Deno.writeFileSync(`${dir}/${name}`, new Uint8Array(values.buffer));
    };
    write("1.bin", 100);
    write("0.bin", 0);

    const records = loadCorpus(dir, INPUTS, OUTPUTS, 4);
    assertEquals(records.length, 4);
    assertEquals([...records[0].input], [0, 1, 2]);
    assertEquals([...records[0].output], [3]);
    assertEquals([...records[2].input], [100, 101, 102]);

    // Reading fewer records than asked for would report a corpus the sweep
    // never scored, so it is refused.
    let refused = "";
    try {
      loadCorpus(dir, INPUTS, OUTPUTS, 5);
    } catch (error) {
      refused = (error as Error).message;
    }
    assertEquals(refused.includes("fewer than the 5"), true);

    // A shard that is not a whole number of records is corrupt, not truncated.
    Deno.writeFileSync(`${dir}/2.bin`, new Uint8Array(7));
    let corrupt = "";
    try {
      loadCorpus(dir, INPUTS, OUTPUTS, 6);
    } catch (error) {
      corrupt = (error as Error).message;
    }
    assertEquals(corrupt.includes("not a whole number of"), true);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
