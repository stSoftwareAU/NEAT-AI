/**
 * Evaluation-archive parent links are populated, and they resolve (Issue
 * #4004).
 *
 * The `parents` field was populated for under 1 % of records — `recordLineage`
 * was called only from the three crossover breeding paths, so a creature
 * produced by mutating a clone, by memetic fine-tuning, or by the
 * creative-thinking clone reached the archive indistinguishable from a seed.
 * Every lineage-aware consumer (a parent's-score baseline, a lineage-held-out
 * split) is undecidable on an archive like that.
 *
 * These tests drive a **real** evolution with the archive enabled and read back
 * what the archive actually holds, so a regression to an unpopulated field
 * fails loudly here rather than in a downstream study.
 */

import { assert, assertEquals } from "@std/assert";
import { readEvaluationArchive } from "@archive/EvaluationArchiveFormat.ts";
import type { EvaluationArchiveRecord } from "@archive/EvaluationArchiveFormat.ts";
import { captureArchive } from "../../scripts/surrogate_archive_capture.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * The floor a regression has to break through.
 *
 * The measured coverage of a capture like the one below is ~97 %: the only
 * record that names nobody is the seed creature each run starts from, which
 * genuinely has no parent. The floor sits well under that so ordinary run-to-run
 * variation cannot fail the test, and far above the 0.7 % the archive carried
 * before — the regression this guards against is a collapse, not a wobble.
 */
const MIN_PARENT_COVERAGE = 0.75;

/** Fraction of parented records that must name a parent the archive holds. */
const MIN_RESOLVABLE = 0.9;

/** Run one small archive-enabled evolution and return what it wrote. */
async function capture(
  directory: string,
  seed: number,
): Promise<EvaluationArchiveRecord[]> {
  const result = await captureArchive({
    directory,
    runs: 1,
    generations: 6,
    population: 12,
    inputs: 4,
    records: 64,
    seed,
  });
  return await readEvaluationArchive(result.path);
}

Deno.test("evaluation archive lineage - archived creatures name what they came from", async () => {
  await initWasmForTests();
  const directory = await Deno.makeTempDir({ prefix: "archive-lineage-" });
  try {
    const records = await capture(directory, 4004);
    assert(records.length > 10, `too few records to judge: ${records.length}`);

    const parented = records.filter((record) => record.parents.length > 0);
    const coverage = parented.length / records.length;
    assert(
      coverage >= MIN_PARENT_COVERAGE,
      `only ${parented.length}/${records.length} (${
        (coverage * 100).toFixed(1)
      }%) of archived evaluations name a parent; the floor is ${
        MIN_PARENT_COVERAGE * 100
      }%`,
    );

    // Lineage-held-out splitting degenerates into leave-one-creature-out when
    // almost every creature is its own group, which is what the unpopulated
    // field produced. Grouping by parent set must collapse the population.
    const groups = new Set(
      records.map((record) =>
        record.parents.length > 0
          ? [...record.parents].sort().join(",")
          : record.uuid
      ),
    );
    assert(
      groups.size < records.length / 2,
      `${groups.size} lineage groups for ${records.length} creatures is ` +
        "leave-one-creature-out, not a lineage split",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive lineage - a named parent is a record in the same archive", async () => {
  await initWasmForTests();
  const directory = await Deno.makeTempDir({ prefix: "archive-lineage-join-" });
  try {
    const records = await capture(directory, 3930);
    const archived = new Set(records.map((record) => record.uuid));
    const parented = records.filter((record) => record.parents.length > 0);
    assert(parented.length > 0, "nothing named a parent");

    const resolvable = parented.filter((record) =>
      record.parents.some((parent) => archived.has(parent))
    );
    const fraction = resolvable.length / parented.length;
    assert(
      fraction >= MIN_RESOLVABLE,
      `only ${resolvable.length}/${parented.length} (${
        (fraction * 100).toFixed(1)
      }%) of parent links join to a record in the same archive`,
    );

    // The parent's-score baseline of Issue #3930 needs the parent's own exact
    // score, so at least one link must resolve to a real, finite score.
    const byUuid = new Map(records.map((record) => [record.uuid, record]));
    const withParentScore = parented.find((record) =>
      record.parents.some((parent) =>
        Number.isFinite(byUuid.get(parent)?.score)
      )
    );
    assert(
      withParentScore !== undefined,
      "no archived creature can be joined to its parent's exact score",
    );
    assertEquals(
      withParentScore.parents.length > 0,
      true,
      "the joined record must carry the parents it was resolved through",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
