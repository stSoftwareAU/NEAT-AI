/**
 * Issue #3926: the multi-fidelity work adds a *cheaper* corpus; it must not
 * move the full-fidelity path by so much as a bit.
 *
 * `test/fixtures/scoring/fitness-corpus.json` pins a creature, a whole corpus,
 * and the score that corpus produces. The assertion is on the IEEE-754 bit
 * pattern, not an epsilon — a full-corpus run that differs from the current
 * build in the last bit fails here.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { readFitnessCorpusProvenance } from "@architecture/FitnessCorpusProvenance.ts";
import { initWasmForTests } from "../_initWasm.ts";

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

Deno.test("full-corpus fitness is bit-identical to the fixture golden", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(fixture.creature);
  const dir = writeCorpus(rowsOf(), "corpus.bin");
  try {
    const { error } = await creature.evaluateDir(
      dir,
      Costs.find(fixture.cost),
      false,
    );
    assertEquals(bits(error), bits(fixture.fullCorpusError));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a sampled corpus scores the mean over exactly the records it holds", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(fixture.creature);
  const dir = writeCorpus(rowsOf(fixture.sampleIndices), "sample-25.bin");
  try {
    const { error } = await creature.evaluateDir(
      dir,
      Costs.find(fixture.cost),
      false,
    );
    // Forward-only records are scored independently, so dropping records
    // changes *which* records the mean is over and nothing else.
    assertEquals(bits(error), bits(fixture.sampledCorpusError));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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
    const plain = await creature.evaluateDir(bare, cost, false);
    const published = await creature.evaluateDir(withManifest, cost, false);

    // The manifest is provenance, never a record: it must not perturb the
    // score, and it must not be read as a corpus file.
    assertEquals(bits(published.error), bits(plain.error));

    const provenance = readFitnessCorpusProvenance(withManifest);
    assertEquals(provenance.sampled, true);
    assertEquals(provenance.declaredSampleRate, 0.25);
    assertEquals(provenance.effectiveSampleRate, 0.25);
  } finally {
    await Deno.remove(bare, { recursive: true });
    await Deno.remove(withManifest, { recursive: true });
  }
});
