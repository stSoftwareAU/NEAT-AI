/**
 * Issue #3926: a run must be able to say which corpus fidelity produced its
 * score. A Refinery-published corpus carries a `manifest.json`; a plain
 * directory of `.bin` files is the full corpus.
 *
 * Imported from `mod.ts` deliberately — `docs/config/TRAINING.md` shows this
 * API being imported from the package root, and a re-export nothing exercises
 * is a documented import path nobody has run.
 */

import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  assertFitnessCorpusSampleRate,
  DatasetError,
  readFitnessCorpusProvenance,
} from "../../mod.ts";

const BYTES_PER_RECORD = 10_048;

/** A Refinery `sample` manifest for `kept` of `total` records at `rate`. */
function sampleManifest(rate: number, total: number, kept: number) {
  return {
    manifest_version: 1,
    tool: { name: "neat-ai-refinery", version: "0.1.0" },
    created_at: "2026-08-31T05:51:23Z",
    created_at_unix: 1788155483,
    transform: { name: "sample", parameters: { rate }, seed: 20260831 },
    record_shape: {
      inputs: 2511,
      outputs: 1,
      record_values: 2512,
      bytes_per_record: BYTES_PER_RECORD,
      encoding: "float32",
    },
    source: {
      path: "/data/trainData-binary",
      identity_strategy: "path+bytes",
      file_count: 2,
      record_count: total,
      files: [{ name: "shard-a.bin", bytes: 602880 }],
    },
    output: {
      file: `sample-${Math.round(rate * 100)}.bin`,
      record_count: kept,
      bytes: kept * BYTES_PER_RECORD,
      checksum: { algorithm: "sha256", value: "57d5a3b3" },
    },
    metadata: {},
  };
}

/**
 * A published corpus directory. When `manifest` is an object the corpus file
 * it names is written at the size it claims, so the on-disk bytes agree with
 * the provenance unless a test deliberately breaks them.
 */
function corpusDir(manifest?: unknown, corpusBytes?: number): string {
  const dir = Deno.makeTempDirSync({ prefix: "fitness-corpus-" });
  if (manifest === undefined || typeof manifest === "string") {
    Deno.writeFileSync(`${dir}/records.bin`, new Uint8Array(8));
  } else {
    const output = (manifest as { output?: { file?: string } }).output;
    const name = output?.file ?? "records.bin";
    const declared = (manifest as { output?: { record_count?: number } })
      .output?.record_count ?? 0;
    const size = corpusBytes ??
      Math.max(0, Math.round(declared * BYTES_PER_RECORD));
    Deno.writeFileSync(`${dir}/${name}`, new Uint8Array(size));
  }
  if (manifest !== undefined) {
    Deno.writeTextFileSync(
      `${dir}/manifest.json`,
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    );
  }
  return dir;
}

Deno.test("fitness corpus - a directory with no manifest is the full corpus", () => {
  const dir = corpusDir();
  try {
    const provenance = readFitnessCorpusProvenance(dir);
    assertEquals(provenance.sampled, false);
    assertEquals(provenance.declaredSampleRate, 1);
    assertEquals(provenance.effectiveSampleRate, 1);
    assertEquals(provenance.recordCount, null);
    assertEquals(provenance.sourceRecordCount, null);
    assertEquals(provenance.transforms, []);
    assertEquals(provenance.corpusFile, null);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a corpus directory that does not exist fails loud", () => {
  const dir = corpusDir();
  Deno.removeSync(dir, { recursive: true });
  // A vanished corpus is not a full corpus: answering rate 1 would state a
  // fidelity nothing was scored at.
  const error = assertThrows(
    () => readFitnessCorpusProvenance(dir),
    DatasetError,
  );
  assertEquals(error.reason, "DIRECTORY_MISSING");
  assertEquals(error.path, dir);
});

Deno.test("fitness corpus - a sampled corpus reports declared and achieved rates", () => {
  const dir = corpusDir(sampleManifest(0.1, 20_000, 2_013));
  try {
    const provenance = readFitnessCorpusProvenance(dir);
    assertEquals(provenance.sampled, true);
    assertEquals(provenance.declaredSampleRate, 0.1);
    assertAlmostEquals(provenance.effectiveSampleRate, 0.10065, 1e-9);
    assertEquals(provenance.recordCount, 2_013);
    assertEquals(provenance.sourceRecordCount, 20_000);
    assertEquals(provenance.transforms, ["sample"]);
    assertEquals(provenance.corpusFile, "sample-10.bin");
    assertEquals(provenance.bytesPerRecord, BYTES_PER_RECORD);
    assertEquals(provenance.sourcePath, "/data/trainData-binary");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a rate-1 corpus is not reported as sampled", () => {
  const dir = corpusDir(sampleManifest(1, 500, 500));
  try {
    const provenance = readFitnessCorpusProvenance(dir);
    assertEquals(provenance.sampled, false);
    assertEquals(provenance.declaredSampleRate, 1);
    assertEquals(provenance.effectiveSampleRate, 1);
    assertFitnessCorpusSampleRate(provenance);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a pipeline multiplies the rate of every sample stage", () => {
  const manifest = sampleManifest(0.5, 1_000, 100) as Record<string, unknown>;
  manifest.pipeline = [
    { name: "sample", parameters: { rate: 0.5 }, seed: 1 },
    { name: "sample", parameters: { rate: 0.2 }, seed: 2 },
    { name: "quantise", parameters: { scheme: "bfloat16" } },
  ];
  const dir = corpusDir(manifest);
  try {
    const provenance = readFitnessCorpusProvenance(dir);
    assertAlmostEquals(provenance.declaredSampleRate, 0.1, 1e-12);
    assertEquals(provenance.effectiveSampleRate, 0.1);
    assertEquals(provenance.transforms, ["sample", "sample", "quantise"]);
    assertFitnessCorpusSampleRate(provenance);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a transform that keeps every record reports rate 1", () => {
  const manifest = sampleManifest(1, 800, 800) as Record<string, unknown>;
  manifest.transform = { name: "quantise", parameters: { scheme: "bfloat16" } };
  const dir = corpusDir(manifest);
  try {
    const provenance = readFitnessCorpusProvenance(dir);
    assertEquals(provenance.declaredSampleRate, 1);
    assertEquals(provenance.effectiveSampleRate, 1);
    assertEquals(provenance.transforms, ["quantise"]);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a manifest that is not JSON fails loud", () => {
  const dir = corpusDir("{ not json");
  try {
    const error = assertThrows(
      () => readFitnessCorpusProvenance(dir),
      DatasetError,
    );
    assertEquals(error.reason, "CORRUPT_PROVENANCE");
    assertEquals(error.path, `${dir}/manifest.json`);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a manifest missing its record counts fails loud", () => {
  const manifest = sampleManifest(0.1, 100, 10) as Record<string, unknown>;
  delete (manifest.output as Record<string, unknown>).record_count;
  const dir = corpusDir(manifest);
  try {
    const error = assertThrows(
      () => readFitnessCorpusProvenance(dir),
      DatasetError,
    );
    assertEquals(error.reason, "CORRUPT_PROVENANCE");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a fractional record count fails loud", () => {
  // A count that was computed rather than counted makes every rate derived
  // from it meaningless.
  const manifest = sampleManifest(0.3, 100, 30) as Record<string, unknown>;
  (manifest.source as Record<string, unknown>).record_count = 333.3333;
  const dir = corpusDir(manifest);
  try {
    assertEquals(
      assertThrows(() => readFitnessCorpusProvenance(dir), DatasetError).reason,
      "CORRUPT_PROVENANCE",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a sample stage with no rate fails loud", () => {
  const manifest = sampleManifest(0.1, 100, 10) as Record<string, unknown>;
  manifest.transform = { name: "sample", parameters: {} };
  const dir = corpusDir(manifest);
  try {
    assertEquals(
      assertThrows(() => readFitnessCorpusProvenance(dir), DatasetError).reason,
      "CORRUPT_PROVENANCE",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - sampling noise stays inside the agreement band", () => {
  // 0.1 of 20 000 records: sigma = sqrt(0.1 * 0.9 / 20000) ≈ 0.00212, so a
  // 5-sigma band is ±0.0106 — 2 013 kept records (0.10065) is ordinary noise.
  const dir = corpusDir(sampleManifest(0.1, 20_000, 2_013));
  try {
    assertFitnessCorpusSampleRate(readFitnessCorpusProvenance(dir));
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a corpus that is not the size it claims fails loud", () => {
  // Declares 0.1 but published half the corpus — 190 sigma out, not noise.
  const dir = corpusDir(sampleManifest(0.1, 20_000, 10_000));
  try {
    const error = assertThrows(
      () => assertFitnessCorpusSampleRate(readFitnessCorpusProvenance(dir)),
      DatasetError,
    );
    assertEquals(error.reason, "CORRUPT_PROVENANCE");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a manifest that disagrees with the bytes on disk fails loud", () => {
  // Self-consistent provenance for 2 000 records, over a file holding 1 000.
  // Only measuring the corpus can catch this.
  const dir = corpusDir(
    sampleManifest(0.1, 20_000, 2_000),
    1_000 * BYTES_PER_RECORD,
  );
  try {
    const error = assertThrows(
      () => assertFitnessCorpusSampleRate(readFitnessCorpusProvenance(dir)),
      DatasetError,
    );
    assertEquals(error.reason, "CORRUPT_PROVENANCE");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a manifest whose published corpus is absent fails loud", () => {
  const dir = corpusDir(sampleManifest(0.1, 20_000, 2_000));
  try {
    Deno.removeSync(`${dir}/sample-10.bin`);
    const error = assertThrows(
      () => assertFitnessCorpusSampleRate(readFitnessCorpusProvenance(dir)),
      DatasetError,
    );
    assertEquals(error.reason, "CORRUPT_PROVENANCE");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a shard the manifest never mentions fails loud", () => {
  // Fitness scores every `.bin` in the directory, so a leftover shard is
  // scored while the manifest still claims the sampled record count. Weighing
  // only the named file would call that corpus verified.
  const dir = corpusDir(sampleManifest(0.1, 20_000, 2_000));
  try {
    Deno.writeFileSync(
      `${dir}/leftover.bin`,
      new Uint8Array(5 * BYTES_PER_RECORD),
    );
    const error = assertThrows(
      () => assertFitnessCorpusSampleRate(readFitnessCorpusProvenance(dir)),
      DatasetError,
    );
    assertEquals(error.reason, "CORRUPT_PROVENANCE");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a manifest with no record geometry cannot be verified", () => {
  // Without `bytes_per_record` the only remaining check is the manifest
  // against itself. Passing that quietly is the masked fault, so it throws.
  const manifest = sampleManifest(0.1, 20_000, 2_000) as Record<
    string,
    unknown
  >;
  delete manifest.record_shape;
  const dir = corpusDir(manifest);
  try {
    const provenance = readFitnessCorpusProvenance(dir);
    assertEquals(provenance.bytesPerRecord, null);
    assertEquals(
      assertThrows(
        () => assertFitnessCorpusSampleRate(provenance),
        DatasetError,
      )
        .reason,
      "CORRUPT_PROVENANCE",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a transform stage that does not name itself fails loud", () => {
  // A misspelt `name` would otherwise read as "not a sample stage", i.e. rate
  // 1 — full fidelity reported for a tenth of the corpus.
  const manifest = sampleManifest(0.1, 20_000, 2_000) as Record<
    string,
    unknown
  >;
  manifest.transform = { nome: "sample", parameters: { rate: 0.1 } };
  const dir = corpusDir(manifest);
  try {
    assertEquals(
      assertThrows(() => readFitnessCorpusProvenance(dir), DatasetError).reason,
      "CORRUPT_PROVENANCE",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a manifest schema this reader does not know fails loud", () => {
  const manifest = sampleManifest(0.1, 20_000, 2_000) as Record<
    string,
    unknown
  >;
  manifest.manifest_version = 2;
  const dir = corpusDir(manifest);
  try {
    assertEquals(
      assertThrows(() => readFitnessCorpusProvenance(dir), DatasetError).reason,
      "CORRUPT_PROVENANCE",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a published corpus holding no records fails loud", () => {
  // 0 of 100 at rate 0.1 sits inside the 5-sigma band, so only refusing an
  // empty corpus outright catches a sampler that published nothing.
  const dir = corpusDir(sampleManifest(0.1, 100, 0));
  try {
    assertEquals(
      assertThrows(() => readFitnessCorpusProvenance(dir), DatasetError).reason,
      "CORRUPT_PROVENANCE",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("fitness corpus - a malformed source path fails loud", () => {
  const manifest = sampleManifest(0.1, 20_000, 2_000) as Record<
    string,
    unknown
  >;
  (manifest.source as Record<string, unknown>).path = 17;
  const dir = corpusDir(manifest);
  try {
    assertEquals(
      assertThrows(() => readFitnessCorpusProvenance(dir), DatasetError).reason,
      "CORRUPT_PROVENANCE",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
