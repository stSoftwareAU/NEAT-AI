/**
 * Issue #3913 — the comparison pages promise "candid trade-offs" and "gaps
 * versus the modern state of the art", but the Cons list was entirely about
 * cost and capability (compute, convergence speed, scale, CUDA). Nothing in it
 * was about whether the reported results are **valid**, which is where the
 * exposure actually is.
 *
 * These tests pin the three validity cons, the two discipline pros, and the
 * three trustworthiness gaps in `FUTURE_WORK.md`:
 *
 *   1. `PROS_AND_CONS.md` carries a con for evaluation validity under repeated
 *      selection (Dwork et al. 2015, Blum & Hardt 2015), one for diversity loss
 *      under accept-only optimisation (Whitley, Gordon & Mathias 1994), and one
 *      for operating in the noise regime.
 *   2. The holdout question is answered explicitly: the text states whether any
 *      corpus slice is withheld from every optimiser.
 *   3. The two discipline pros — immutable incumbent with one authoritative
 *      judge, and the journalled experiments — are claimed.
 *   4. `FUTURE_WORK.md` carries the three trustworthiness gaps, and each sorts
 *      above the reach-extending gaps it is supposed to outrank.
 *
 * These are structural "what" tests in the spirit of
 * `ComparisonReferencesPrimarySources.ts`: they assert on which entries exist,
 * which citations they carry, and how they are ordered — not on prose or
 * length — so rewording does not break them. The holdout assertion is the one
 * wording-sensitive check, and it is deliberate: an explicit answer is exactly
 * what the issue asked for.
 */

import { assert } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const PROS_AND_CONS = `${REPO_ROOT}/docs/comparison/PROS_AND_CONS.md`;
const FUTURE_WORK = `${REPO_ROOT}/docs/comparison/FUTURE_WORK.md`;

/**
 * One `## ` section of a comparison page, with its top-level numbered entries
 * and its `### ` sub-headings.
 */
interface Section {
  readonly heading: string;
  readonly entries: ReadonlyArray<string>;
  readonly subHeadings: ReadonlyArray<string>;
}

/**
 * Split a document into `## ` sections. Numbered list entries are collected
 * per section, with continuation lines of a wrapped entry folded in, so a
 * reflow does not change the parse.
 */
function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  let current:
    | { heading: string; entries: string[]; subHeadings: string[] }
    | null = null;
  for (const line of content.split("\n")) {
    const heading = line.match(/^##\s+(.*\S)\s*$/);
    if (heading) {
      current = { heading: heading[1], entries: [], subHeadings: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const subHeading = line.match(/^###\s+(.*\S)\s*$/);
    if (subHeading) {
      current.subHeadings.push(subHeading[1]);
      continue;
    }
    const entry = line.match(/^\d+\.\s+(.*)$/);
    if (entry) {
      current.entries.push(entry[1].trim());
    } else if (/^\s+\S/.test(line) && current.entries.length > 0) {
      const last = current.entries.length - 1;
      current.entries[last] = `${current.entries[last]} ${line.trim()}`;
    }
  }
  return sections;
}

async function readSections(path: string): Promise<Section[]> {
  return parseSections(await Deno.readTextFile(path));
}

async function entriesOf(path: string, heading: string): Promise<string[]> {
  const section = (await readSections(path)).find((s) => s.heading === heading);
  assert(section !== undefined, `${path} is missing the "${heading}" section`);
  return [...section.entries];
}

/** Find the single entry matching `marker`, failing with context if absent. */
function findEntry(
  entries: ReadonlyArray<string>,
  marker: RegExp,
  what: string,
): string {
  const found = entries.find((e) => marker.test(e));
  assert(
    found !== undefined,
    `No entry covering ${what} (expected a match for ${marker}) in:\n${
      entries.join("\n")
    }`,
  );
  return found;
}

Deno.test("PROS_AND_CONS.md cons the evaluation validity of repeated selection", async () => {
  const cons = await entriesOf(PROS_AND_CONS, "🧬 NEAT-AI — Cons");
  const entry = findEntry(cons, /adaptive data analysis/i, "adaptive reuse");
  assert(
    /Dwork/.test(entry),
    `The adaptive-data-analysis con must cite Dwork et al. (2015) — got: "${entry}"`,
  );
  assert(
    /Blum\s*&?\s*(amp;)?\s*Hardt|Blum and Hardt/i.test(entry),
    `The adaptive-data-analysis con must cite Blum & Hardt (2015) — got: "${entry}"`,
  );
});

Deno.test("PROS_AND_CONS.md answers the holdout question explicitly", async () => {
  const cons = await entriesOf(PROS_AND_CONS, "🧬 NEAT-AI — Cons");
  const entry = findEntry(cons, /withheld/i, "the holdout question");
  assert(
    /\bno\b[^.]*\bwithheld from every optimiser\b/i.test(entry),
    "The holdout question must be answered explicitly — the con must state " +
      `that no corpus slice is withheld from every optimiser — got: "${entry}"`,
  );
});

Deno.test("PROS_AND_CONS.md cons diversity loss under accept-only optimisation", async () => {
  const cons = await entriesOf(PROS_AND_CONS, "🧬 NEAT-AI — Cons");
  const entry = findEntry(cons, /diversity loss/i, "diversity loss");
  assert(
    /Whitley/.test(entry),
    `The diversity-loss con must cite Whitley, Gordon & Mathias (1994) — got: "${entry}"`,
  );
  assert(
    /1994/.test(entry),
    `The diversity-loss con must date its citation — got: "${entry}"`,
  );
});

Deno.test("PROS_AND_CONS.md cons operating in the noise regime", async () => {
  const cons = await entriesOf(PROS_AND_CONS, "🧬 NEAT-AI — Cons");
  const entry = findEntry(cons, /noise regime/i, "the noise regime");
  assert(
    /\de-0\d/i.test(entry),
    `The noise-regime con must quote the observed magnitude of accepted improvements — got: "${entry}"`,
  );
});

Deno.test("PROS_AND_CONS.md claims the acceptance discipline as a pro", async () => {
  const pros = await entriesOf(PROS_AND_CONS, "🧬 NEAT-AI — Pros");
  const incumbent = findEntry(
    pros,
    /immutable incumbent/i,
    "the immutable incumbent",
  );
  assert(
    /judge/i.test(incumbent) && /corpus/i.test(incumbent),
    "The incumbent pro must state that one judge scores every candidate over " +
      `the whole corpus — got: "${incumbent}"`,
  );
  const journal = findEntry(
    pros,
    /experiments\.jsonl/i,
    "the experiment journal",
  );
  assert(
    /report/i.test(journal),
    `The journal pro must name the report command that reads it — got: "${journal}"`,
  );
});

Deno.test("FUTURE_WORK.md carries the three trustworthiness gaps, above the reach gaps", async () => {
  const sections = await readSections(FUTURE_WORK);
  const headings = sections.flatMap((s) => s.subHeadings);
  const indexOf = (marker: RegExp, what: string): number => {
    const index = headings.findIndex((h) => marker.test(h));
    assert(
      index >= 0,
      `FUTURE_WORK.md is missing a section for ${what} in:\n${
        headings.join("\n")
      }`,
    );
    return index;
  };

  const qualityDiversity = indexOf(
    /quality-diversity/i,
    "quality-diversity / behavioural archives",
  );
  const holdout = indexOf(/holdout/i, "a holdout no optimiser can see");
  const robustness = indexOf(
    /robustness/i,
    "robustness as an acceptance criterion",
  );
  const unsupervised = indexOf(/unsupervised/i, "unsupervised learning");
  const multiTask = indexOf(/multi-task/i, "multi-task learning");

  for (
    const [gap, name] of [
      [qualityDiversity, "quality-diversity"],
      [holdout, "the unseen holdout"],
    ] as const
  ) {
    assert(
      gap < unsupervised,
      `${name} must sort above the reach-extending "unsupervised learning" gap`,
    );
  }
  assert(
    robustness < multiTask,
    'robustness must sort above the reach-extending "multi-task learning" gap',
  );
});

Deno.test("FUTURE_WORK.md cites the literature behind each trustworthiness gap", async () => {
  const content = await Deno.readTextFile(FUTURE_WORK);
  const required: ReadonlyArray<readonly [string, string]> = [
    ["Lehman & Stanley", "novelty search"],
    ["Mouret & Clune", "MAP-Elites"],
    ["Dwork", "the reusable holdout"],
    ["Blum & Hardt", "the Ladder"],
    ["Hochreiter & Schmidhuber", "flat minima"],
    ["Keskar", "the generalisation gap"],
    ["Foret", "sharpness-aware minimisation"],
  ];
  const missing = required
    .filter(([citation]) => !content.includes(citation))
    .map(([citation, what]) => `${citation} (${what})`);
  assert(
    missing.length === 0,
    `FUTURE_WORK.md must cite:\n${missing.join("\n")}`,
  );
});
