/**
 * Issue #3908 — `docs/comparison/UNIQUE_APPROACHES.md` describes every headline
 * NEAT-AI extension against standard NEAT (2002) as the only baseline. Each
 * "standard NEAT has no equivalent" line is true, and each one reads — to a
 * reader from the wider machine-learning literature — as a claim that the
 * technique itself is new. It usually is not.
 *
 * The house names stay. What each section must now carry is a `Prior art:`
 * callout naming what the literature calls the same thing, plus the two places
 * where the claim outran the evidence:
 *
 *   1. Every numbered section carries a `> **Prior art:**` callout, and every
 *      citation into `REFERENCES.md` resolves to a heading that exists there.
 *   2. The MCMC section no longer presents the ~23.4% acceptance target as
 *      theory: it is a heuristic borrowed from a random-walk Metropolis
 *      optimal-scaling result, not a result about evolutionary algorithms.
 *   3. The Muon section states the scale caveat — the published benefit is on
 *      large dense matrices — and points at the in-repo measurement it does
 *      have, which must actually exist on disk.
 *   4. Not one house name changed.
 *
 * These are structural "what" tests in the spirit of
 * `ComparisonReferencesPrimarySources.ts` and `ExtensionAncestryCitations.ts`:
 * they assert on section membership and on author/year citation fragments,
 * which survive rewording, not on prose or length. The two correction checks
 * (2 and 3) are deliberately wording-sensitive — the qualification is the fix
 * the issue asked for.
 */

import { assert } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const UNIQUE = `${REPO_ROOT}/docs/comparison/UNIQUE_APPROACHES.md`;
const REFERENCES = `${REPO_ROOT}/docs/comparison/REFERENCES.md`;

/**
 * The twelve house sections, by exact `## ` heading text. Changing any of these
 * strings changes a house name — which this issue explicitly forbids.
 */
const HOUSE_SECTIONS: ReadonlyArray<string> = [
  "1. 🧬 Memetic Evolution (Hybrid Evolution + Backpropagation)",
  "2. ⚡ Error-Guided Structural Evolution",
  "3. 🔑 UUID-Based Extensible Observations",
  "4. 🌐 Distributed Evolution with Centralised Combination",
  "5. 💉 CRISPR Gene Injection",
  "6. 🌿 Grafting for Incompatible Parents",
  "7. 🧠 Predictive Coding Training",
  "8. 🔍 Discovery Caching and Disk Space Management",
  "9. 🎲 MCMC Mutation Acceptance",
  "10. 🧬 Advanced Breeding Strategies",
  "11. 🧮 Muon-Style Orthogonalised Gradient Updates",
  "12. 🔗 Synthetic Synapse Training",
];

/**
 * Citation fragments each section's prior-art callout must carry, keyed by the
 * leading section number. Author surnames and years, so rewording the sentence
 * around them does not break the test.
 */
const PRIOR_ART: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ["1", [
    "Moscato",
    "1989",
    "Hinton & Nowlan",
    "1987",
    "Whitley",
    "1994",
    "Ong & Keane",
    "2004",
  ]],
  ["2", [
    "Fahlman & Lebiere",
    "1990",
    "Cascade-Correlation",
    "Chen",
    "2016",
    "Wu",
    "2020",
    "Evci",
    "2022",
  ]],
  ["3", ["Stanley & Miikkulainen", "2002", "innovation number"]],
  ["4", ["island model", "Cohoon", "1987", "Tanese", "1989"]],
  ["5", ["population seeding", "Grefenstette", "1987"]],
  ["6", ["Barr", "2015", "competing-conventions", "Montana & Davis", "1989"]],
  ["7", [
    "Rao & Ballard",
    "1999",
    "Whittington & Bogacz",
    "2017",
    "Millidge",
    "2021",
  ]],
  ["8", ["Glover", "1986", "tabu", "Fialho", "2010"]],
  ["9", ["Metropolis", "1953", "Kirkpatrick", "1983", "simulated annealing"]],
  ["10", [
    "Goldberg & Richardson",
    "1987",
    "fitness sharing",
    "Harik & Goldberg",
    "1997",
    "linkage",
  ]],
  ["11", ["Jordan", "2024"]],
  ["12", ["Han", "2017", "DSD", "Mocanu", "2018", "Evci", "2020"]],
]);

/** The in-repo Muon measurement the section is allowed to lean on. */
const MUON_BENCH = "bench/MuonVsBaseline.ts";

interface Section {
  readonly heading: string;
  /** Leading `N` of an `N. …` heading, or `""` for an unnumbered section. */
  readonly number: string;
  readonly body: string;
  /** The `> ` blockquote blocks in this section, one string per block. */
  readonly callouts: ReadonlyArray<string>;
}

/** Split the document into `## ` sections, keeping each section's blockquotes. */
function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  let heading: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (heading === null) return;
    const body = lines.join("\n");
    const callouts: string[] = [];
    let block: string[] = [];
    for (const line of lines) {
      if (line.startsWith(">")) {
        block.push(line.replace(/^>\s?/, ""));
        continue;
      }
      if (block.length > 0) {
        callouts.push(block.join(" "));
        block = [];
      }
    }
    if (block.length > 0) callouts.push(block.join(" "));
    sections.push({
      heading,
      number: heading.match(/^(\d+)\./)?.[1] ?? "",
      body,
      callouts,
    });
  };
  for (const line of content.split("\n")) {
    const match = line.match(/^##\s+(.*\S)\s*$/);
    if (match) {
      flush();
      heading = match[1];
      lines = [];
      continue;
    }
    if (heading !== null) lines.push(line);
  }
  flush();
  return sections;
}

async function readSections(): Promise<Section[]> {
  return parseSections(await Deno.readTextFile(UNIQUE));
}

/** The prior-art callout of a section, with its `> ` markers stripped. */
function priorArtCallout(section: Section): string | undefined {
  return section.callouts.find((c) => c.includes("**Prior art:**"));
}

/**
 * GitHub's heading-anchor slug: lower-cased, non-alphanumerics dropped, then
 * every remaining space replaced by a hyphen.
 */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number} \-]/gu, "")
    .trimEnd()
    .replace(/ /g, "-");
}

async function referenceAnchors(): Promise<Set<string>> {
  const content = await Deno.readTextFile(REFERENCES);
  const anchors = new Set<string>();
  for (const line of content.split("\n")) {
    const heading = line.match(/^#{2,6}\s+(.*\S)\s*$/);
    if (heading) anchors.add(`#${slugify(heading[1])}`);
  }
  return anchors;
}

function sectionByNumber(sections: Section[], number: string): Section {
  const section = sections.find((s) => s.number === number);
  assert(section !== undefined, `section ${number} not found`);
  return section;
}

Deno.test("every UNIQUE_APPROACHES.md section carries a Prior art callout", async () => {
  const sections = (await readSections()).filter((s) => s.number !== "");
  assert(
    sections.length === HOUSE_SECTIONS.length,
    `expected ${HOUSE_SECTIONS.length} numbered sections, found ${sections.length}`,
  );
  const missing = sections
    .filter((s) => priorArtCallout(s) === undefined)
    .map((s) => s.heading);
  assert(
    missing.length === 0,
    `Sections without a "> **Prior art:**" callout:\n${missing.join("\n")}`,
  );
});

Deno.test("each Prior art callout names the precedent from the literature", async () => {
  const sections = await readSections();
  const failures: string[] = [];
  for (const [number, fragments] of PRIOR_ART) {
    const section = sectionByNumber(sections, number);
    const callout = priorArtCallout(section) ?? "";
    const missing = fragments.filter((f) => !callout.includes(f));
    if (missing.length > 0) {
      failures.push(`${section.heading}: missing ${missing.join(", ")}`);
    }
  }
  assert(
    failures.length === 0,
    `Prior-art callouts must name their precedent:\n${failures.join("\n")}`,
  );
});

Deno.test("UNIQUE_APPROACHES.md citations resolve to a REFERENCES.md heading", async () => {
  const [anchors, content] = await Promise.all([
    referenceAnchors(),
    Deno.readTextFile(UNIQUE),
  ]);
  const broken: string[] = [];
  const re = /REFERENCES\.md(#[^)\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (!anchors.has(match[1])) broken.push(match[1]);
  }
  assert(
    broken.length === 0,
    `Citations point at REFERENCES.md headings that do not exist:\n${
      broken.join("\n")
    }`,
  );
});

Deno.test("the MCMC section treats the ~23.4% target as a heuristic, not theory", async () => {
  const section = sectionByNumber(await readSections(), "9");
  assert(
    section.body.includes("23.4"),
    "the acceptance-rate knob must still be documented",
  );
  assert(
    !/theoretically optimal/i.test(section.body),
    'the ~23.4% target must no longer be called "theoretically optimal"',
  );
  assert(
    /random-walk Metropolis/i.test(section.body),
    "the ~23.4% gloss must scope Roberts et al. (1997) to random-walk Metropolis",
  );
  assert(
    /heuristic/i.test(section.body),
    "the ~23.4% target must be described as a borrowed heuristic",
  );
});

Deno.test("the Muon section states the scale caveat and cites its own measurement", async () => {
  const section = sectionByNumber(await readSections(), "11");
  assert(
    /dense/i.test(section.body) && /small|tiny/i.test(section.body),
    "the Muon section must say the published benefit is on large dense matrices while per-neuron fan-in matrices here are small",
  );
  assert(
    /unproven|unverified|not been measured/i.test(section.body),
    "the Muon section must mark the production-scale effect as unproven",
  );
  assert(
    section.body.includes(MUON_BENCH),
    `the Muon section must cite the in-repo measurement (${MUON_BENCH})`,
  );
  await Deno.stat(`${REPO_ROOT}/${MUON_BENCH}`);
});

Deno.test("no house name changed in UNIQUE_APPROACHES.md", async () => {
  const headings = new Set((await readSections()).map((s) => s.heading));
  const missing = HOUSE_SECTIONS.filter((h) => !headings.has(h));
  assert(
    missing.length === 0,
    `House names must not change:\n${missing.join("\n")}`,
  );
});
