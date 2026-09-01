/**
 * Issue #3926: the multi-fidelity work adds a *cheaper* corpus; it must not
 * move the full-fidelity path by so much as a bit.
 *
 * `test/fixtures/scoring/fitness-corpus.json` pins a creature, a whole corpus,
 * and the score that corpus produces. The assertion is on the IEEE-754 bit
 * pattern, not an epsilon — a full-corpus run that differs from the current
 * build in the last bit fails here.
 *
 * The golden is **engine-pinned**. The two dataset-scoring engines accumulate
 * in f64 but activate in f32, so they agree to about 1e-6 relative and not to
 * the bit (`test/score/RustScorerDatasetParity.ts`). A golden that did not say
 * which engine produced it would pass or fail on whether a `rust_scorer`
 * binary happened to be resolvable — so the bit-exact assertions name the
 * TypeScript/WASM engine explicitly, and the native engine is held to the same
 * golden at the documented parity tolerance.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { readFitnessCorpusProvenance } from "@architecture/FitnessCorpusProvenance.ts";
import { dataFiles } from "@architecture/training/TrainingSetup.ts";
import { initWasmForTests } from "../_initWasm.ts";
import {
  liveScorerConfig,
  relativeDifference,
  resolveRustScorerBinary,
  typescriptScorerConfig,
} from "./NativeScorerFixtures.ts";

interface FitnessCorpusFixture {
  cost: string;
  creature: CreatureExport;
  records: { input: number[]; output: number[] }[];
  sampleIndices: number[];
  fullCorpusError: number;
  sampledCorpusError: number;
}

const fixture: FitnessCorpusFixture = JSON.parse(
  Deno.readTextFileSync(
    new URL("../fixtures/scoring/fitness-corpus.json", import.meta.url),
  ),
);

const BINARY = resolveRustScorerBinary();

/**
 * Agreement required of the native engine against the TypeScript golden — the
 * tolerance `test/score/RustScorerDatasetParity.ts` already holds the two
 * engines to.
 */
const PARITY_REL_TOLERANCE = 1e-5;

/** The IEEE-754 bit pattern of a double, so "identical" means identical. */
function bits(value: number): bigint {
  return new BigInt64Array(new Float64Array([value]).buffer)[0];
}

/**
 * Writes `rows` as one `.bin` shard — the single-file layout Refinery
 * publishes — so the corpus geometry is fixed by the fixture, not by a
 * partition size.
 */
function writeCorpus(rows: DataRecordInterface[], fileName: string): string {
  const dir = Deno.makeTempDirSync({ prefix: "fitness-corpus-fixture-" });
  const values = rows.flatMap((r) => [...r.input, ...r.output]);
  Deno.writeFileSync(
    `${dir}/${fileName}`,
    new Uint8Array(new Float32Array(values).buffer),
  );
  return dir;
}

function rowsOf(indices?: number[]): DataRecordInterface[] {
  const chosen = indices ?? fixture.records.map((_, i) => i);
  return chosen.map((i) => ({
    input: new Float32Array(fixture.records[i].input),
    output: new Float32Array(fixture.records[i].output),
  }));
}

/** Scores the fixture creature over `rows` on the engine `config` selects. */
async function score(
  rows: DataRecordInterface[],
  fileName: string,
  config: RequiredRustScorerConfig,
): Promise<number> {
  await initWasmForTests();
  const creature = Creature.fromJSON(fixture.creature);
  const dir = writeCorpus(rows, fileName);
  try {
    const { error } = await creature.evaluateDir(
      dir,
      Costs.find(fixture.cost),
      false,
      undefined,
      undefined,
      config,
    );
    return error;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/**
 * The TypeScript/WASM engine, named explicitly. `typescriptScorerConfig` needs
 * a binary path only to build the disabled config around; that path is never
 * executed while `enabled` is false.
 */
function wasmEngine(): RequiredRustScorerConfig {
  return typescriptScorerConfig(BINARY ?? "rust_scorer");
}

Deno.test("full-corpus fitness is bit-identical to the fixture golden", async () => {
  const error = await score(rowsOf(), "corpus.bin", wasmEngine());
  assertEquals(bits(error), bits(fixture.fullCorpusError));
});

Deno.test("a sampled corpus scores the mean over exactly the records it holds", async () => {
  const error = await score(
    rowsOf(fixture.sampleIndices),
    "sample-25.bin",
    wasmEngine(),
  );
  // Forward-only records are scored independently, so dropping records changes
  // *which* records the mean is over and nothing else.
  assertEquals(bits(error), bits(fixture.sampledCorpusError));
});

Deno.test({
  name: "the native scorer reproduces the fixture goldens within parity",
  ignore: BINARY === undefined,
  fn: async () => {
    const native = liveScorerConfig(BINARY as string);
    const full = await score(rowsOf(), "corpus.bin", native);
    const sampled = await score(
      rowsOf(fixture.sampleIndices),
      "sample-25.bin",
      native,
    );

    // The engines activate in f32, so they agree to a tolerance rather than a
    // bit — pinning a native golden would pin a scorer build, not this repo.
    for (
      const [label, actual, golden] of [
        ["full", full, fixture.fullCorpusError],
        ["sampled", sampled, fixture.sampledCorpusError],
      ] as const
    ) {
      const drift = relativeDifference(actual, golden);
      assert(
        drift <= PARITY_REL_TOLERANCE,
        `${label} corpus: native ${actual} vs golden ${golden} — relative ` +
          `difference ${drift} exceeds ${PARITY_REL_TOLERANCE}`,
      );
    }
  },
});

Deno.test("a Refinery manifest beside the corpus changes neither the score nor the file list", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(fixture.creature);
  const bare = writeCorpus(rowsOf(fixture.sampleIndices), "sample-25.bin");
  const withManifest = writeCorpus(
    rowsOf(fixture.sampleIndices),
    "sample-25.bin",
  );
  await Deno.writeTextFile(
    `${withManifest}/manifest.json`,
    JSON.stringify({
      manifest_version: 1,
      tool: { name: "neat-ai-refinery", version: "0.1.0" },
      transform: { name: "sample", parameters: { rate: 0.25 }, seed: 20260831 },
      source: {
        path: "/data/trainData-binary",
        identity_strategy: "path+bytes",
        record_count: fixture.records.length,
      },
      output: {
        file: "sample-25.bin",
        record_count: fixture.sampleIndices.length,
      },
    }),
  );
  try {
    const cost = Costs.find(fixture.cost);
    // Whichever engine this environment resolves — the manifest must be
    // invisible to both.
    const plain = await creature.evaluateDir(bare, cost, false);
    const published = await creature.evaluateDir(withManifest, cost, false);

    // The manifest is provenance, never a record: it must not perturb the
    // score, and it must not be read as a corpus file.
    assertEquals(bits(published.error), bits(plain.error));
    assertEquals(
      dataFiles(withManifest).files.map((path) => path.split("/").pop()),
      ["sample-25.bin"],
    );

    const provenance = readFitnessCorpusProvenance(withManifest);
    assertEquals(provenance.sampled, true);
    assertEquals(provenance.declaredSampleRate, 0.25);
    assertEquals(provenance.effectiveSampleRate, 0.25);
  } finally {
    await Deno.remove(bare, { recursive: true });
    await Deno.remove(withManifest, { recursive: true });
  }
});
