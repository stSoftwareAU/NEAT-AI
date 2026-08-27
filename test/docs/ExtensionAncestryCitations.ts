/**
 * Issue #3912 — most readers meet a NEAT-AI extension in the README feature
 * list, in the `IMPLEMENTED.md` extension tables, or in the glossary, not in
 * `UNIQUE_APPROACHES.md`. Wherever an extension is *first* named, its ancestor
 * in the literature must be named beside it, so the first impression is "our
 * implementation of a known result" rather than "a NEAT-AI invention".
 *
 * The assertions below are structural "what" tests in the spirit of
 * `ComparisonReferencesPrimarySources.ts`:
 *
 *   1. Every README feature with a known ancestor cites it (author/year, not
 *      prose), and every citation that points into `REFERENCES.md` resolves to
 *      a heading that exists there.
 *   2. Every extension entry in `IMPLEMENTED.md` carries a `Prior art:` line
 *      tagged with one of the three legend markers, so a well-supported
 *      borrowing is visibly distinguishable from an open bet.
 *   3. Every house term with a literature equivalent carries it on its glossary
 *      definition line.
 *   4. Not one house name changed — the names are asserted still present.
 *
 * Citations are matched by author surname and year, which survives rewording;
 * the tests do not assert on sentence shape or length.
 */

import { assert } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const README = `${REPO_ROOT}/README.md`;
const IMPLEMENTED = `${REPO_ROOT}/docs/comparison/IMPLEMENTED.md`;
const GLOSSARY = `${REPO_ROOT}/docs/GLOSSARY.md`;
const REFERENCES = `${REPO_ROOT}/docs/comparison/REFERENCES.md`;

/**
 * README features whose ancestor must be named, keyed by the bold feature
 * title, valued by the citation fragments that must appear in that entry.
 */
const README_ANCESTRY: ReadonlyArray<readonly [string, ReadonlyArray<string>]> =
  [
    ["Extendable Observations", ["Stanley & Miikkulainen", "2002"]],
    ["Distributed Training", ["Cohoon", "1987", "Tanese", "1989"]],
    ["Neuron Pruning", [
      "LeCun",
      "1989",
      "Optimal Brain Damage",
      "Hassibi",
      "1993",
    ]],
    ["CRISPR", ["population seeding"]],
    ["Grafting", ["Barr", "2015", "competing-conventions"]],
    ["Memetic Evolution", ["Moscato", "1989", "Whitley", "1994", "diversity"]],
    ["Error-Guided Structural Evolution", [
      "Fahlman",
      "Lebiere",
      "1990",
      "Cascade-Correlation",
    ]],
    ["Markov Chain Monte Carlo (MCMC) Mutation Acceptance", [
      "Kirkpatrick",
      "1983",
      "simulated annealing",
      "heuristic",
    ]],
    ["Synthetic Synapse Training", [
      "Han",
      "2017",
      "Mocanu",
      "2018",
      "Evci",
      "2020",
    ]],
  ];

/** House names that must survive unchanged in each surface. */
const README_HOUSE_NAMES: ReadonlyArray<string> = README_ANCESTRY.map((
  [name],
) => name);

const IMPLEMENTED_HOUSE_NAMES: ReadonlyArray<string> = [
  "Memetic Evolution",
  "Error-Guided Structural Evolution",
  "Synthetic Synapse Training",
  "MCMC Mutation Acceptance",
  "CRISPR Gene Injection",
  "Grafting",
  "Neuron Pruning",
  "Discovery Caching",
  "Adaptive Quantum Steps",
  "DNA-Sharing Primitives",
];

const GLOSSARY_HOUSE_NAMES: ReadonlyArray<string> = [
  "Creature",
  "Evolution",
  "Islands",
  "Discovery",
  "Intelligent Design",
  "CRISPR injection",
  "Grafting",
  "Squash",
  "Memetic evolution",
  "MCMC acceptance",
  "Impact",
  "Synthetic synapses",
  "Horizontal gene transfer",
];

/** The `Prior art:` classification markers, defined by the legend. */
const PRIOR_ART_MARKERS: ReadonlyArray<string> = [
  "📚 borrowed",
  "🎲 open bet",
  "🔧 engineering",
];

/** House terms whose glossary line must carry a literature equivalent. */
const GLOSSARY_LITERATURE: ReadonlyArray<
  readonly [string, ReadonlyArray<string>]
> = [
  ["Memetic evolution", ["literature:", "memetic", "Lamarckian"]],
  ["CRISPR injection", ["literature:", "population seeding"]],
  ["Grafting", ["literature:", "module transplantation"]],
  ["Discovery", [
    "literature:",
    "error-guided structural growth",
    "Cascade-Correlation",
  ]],
  ["Impact", ["literature:", "attribution"]],
  ["Synthetic synapses", ["literature:", "dense-sparse-dense"]],
];

/** Headings of the two `IMPLEMENTED.md` extension sections. */
const EXTENSION_SECTIONS: ReadonlyArray<string> = [
  "🚀 NEAT-AI extensions — training methods (beyond the 2002 paper)",
  "✨ NEAT-AI extensions — architecture, identity, and tooling",
];

/**
 * GitHub's heading-anchor slug: lower-cased, non-alphanumerics dropped, then
 * every remaining space replaced by a hyphen. Emoji are dropped but the space
 * after them is not, which is why anchors into these emoji headings start with
 * a hyphen (`#-pruning-and-sparsity`).
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

/** A bullet or numbered entry: its title plus every line belonging to it. */
interface Entry {
  readonly title: string;
  readonly body: string;
}

/** Parse the README's numbered feature list into entries. */
function parseReadmeFeatures(content: string): Entry[] {
  const entries: Entry[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) {
      entries.push({ title: current.title, body: current.lines.join("\n") });
    }
  };
  for (const line of content.split("\n")) {
    const start = line.match(/^\s*\d+\.\s+\*\*(?:\[)?([^*\]]+)/);
    if (start) {
      flush();
      current = { title: start[1].trim(), lines: [line] };
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      current = null;
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return entries;
}

/**
 * Parse the top-level bullets of one `## ` section, folding nested bullets and
 * wrapped continuation lines into the entry they belong to.
 */
function parseSectionEntries(content: string, heading: string): Entry[] {
  const lines = content.split("\n");
  const start = lines.findIndex((l) =>
    l.startsWith("## ") && l.slice(3).trim() === heading
  );
  if (start === -1) return [];
  const entries: Entry[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) {
      entries.push({ title: current.title, body: current.lines.join("\n") });
    }
  };
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const bullet = line.match(/^- (?:✅ )?\*\*([^*]+)\*\*/);
    if (bullet) {
      flush();
      current = { title: bullet[1].trim(), lines: [line] };
      continue;
    }
    if (/^- /.test(line)) {
      flush();
      current = null;
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return entries;
}

/** Parse the glossary's themed-term bullets. */
function parseGlossaryTerms(content: string): Entry[] {
  return parseSectionEntries(content, "🧬 Themed / house terms");
}

function missingFragments(
  body: string,
  fragments: ReadonlyArray<string>,
): string[] {
  return fragments.filter((f) => !body.includes(f));
}

/** Every in-repo `REFERENCES.md#anchor` link in `content`, with its anchor. */
function referenceLinks(content: string): string[] {
  const anchors: string[] = [];
  const re = /REFERENCES\.md(#[^)\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) anchors.push(match[1]);
  return anchors;
}

Deno.test("README feature entries name the ancestor of each extension", async () => {
  const features = parseReadmeFeatures(await Deno.readTextFile(README));
  const byTitle = new Map(features.map((f) => [f.title, f]));
  const failures: string[] = [];
  for (const [title, fragments] of README_ANCESTRY) {
    const entry = byTitle.get(title);
    if (!entry) {
      failures.push(`${title}: feature entry not found in README.md`);
      continue;
    }
    const missing = missingFragments(entry.body, fragments);
    if (missing.length > 0) {
      failures.push(`${title}: missing citation of ${missing.join(", ")}`);
    }
  }
  assert(
    failures.length === 0,
    `README features must name their ancestor:\n${failures.join("\n")}`,
  );
});

Deno.test("every IMPLEMENTED.md extension carries a classified Prior art line", async () => {
  const content = await Deno.readTextFile(IMPLEMENTED);
  const failures: string[] = [];
  let seen = 0;
  for (const heading of EXTENSION_SECTIONS) {
    const entries = parseSectionEntries(content, heading);
    if (entries.length === 0) {
      failures.push(`${heading}: section not found or has no entries`);
      continue;
    }
    seen += entries.length;
    for (const entry of entries) {
      if (!/\*\*Prior art \(/.test(entry.body)) {
        failures.push(`${entry.title}: no "Prior art:" line`);
        continue;
      }
      const markers = PRIOR_ART_MARKERS.filter((m) => entry.body.includes(m));
      if (markers.length !== 1) {
        failures.push(
          `${entry.title}: Prior art line must carry exactly one of ${
            PRIOR_ART_MARKERS.join(" / ")
          } — found ${markers.length}`,
        );
      }
    }
  }
  assert(seen > 20, `expected the full extension list, saw ${seen} entries`);
  assert(
    failures.length === 0,
    `IMPLEMENTED.md extensions must classify their prior art:\n${
      failures.join("\n")
    }`,
  );
});

Deno.test("IMPLEMENTED.md legend defines every Prior art marker", async () => {
  const content = await Deno.readTextFile(IMPLEMENTED);
  const legend = content.slice(0, content.indexOf("- ✅ **Backpropagation**"));
  const undefinedMarkers = PRIOR_ART_MARKERS.filter((m) =>
    !legend.includes(m)
  );
  assert(
    undefinedMarkers.length === 0,
    `Markers used but never explained ahead of the list: ${
      undefinedMarkers.join(", ")
    }`,
  );
});

Deno.test("IMPLEMENTED.md distinguishes borrowings from open bets", async () => {
  const content = await Deno.readTextFile(IMPLEMENTED);
  const entries = EXTENSION_SECTIONS.flatMap((h) =>
    parseSectionEntries(content, h)
  );
  const classified = (marker: string) =>
    entries.filter((e) => e.body.includes(marker)).map((e) => e.title);
  const borrowed = classified("📚 borrowed");
  const bets = classified("🎲 open bet");
  assert(
    borrowed.includes("Memetic Evolution") &&
      borrowed.includes("Neuron Pruning") &&
      borrowed.includes("Synthetic Synapse Training") &&
      borrowed.includes("Discovery Caching"),
    `Well-supported borrowings must be marked as such — got: ${
      borrowed.join(", ")
    }`,
  );
  assert(
    bets.includes("Grafting") &&
      bets.includes("Advanced Breeding Strategies") &&
      bets.includes("Muon-Style Orthogonalised Gradient Updates"),
    `Genuine bets must be marked as such — got: ${bets.join(", ")}`,
  );
});

Deno.test("glossary house terms carry their literature equivalent", async () => {
  const terms = parseGlossaryTerms(await Deno.readTextFile(GLOSSARY));
  const byTitle = new Map(terms.map((t) => [t.title, t]));
  const failures: string[] = [];
  for (const [term, fragments] of GLOSSARY_LITERATURE) {
    const entry = byTitle.get(term);
    if (!entry) {
      failures.push(`${term}: glossary entry not found`);
      continue;
    }
    const missing = missingFragments(entry.body, fragments);
    if (missing.length > 0) {
      failures.push(`${term}: missing ${missing.join(", ")}`);
    }
  }
  assert(
    failures.length === 0,
    `Glossary terms must name their literature equivalent:\n${
      failures.join("\n")
    }`,
  );
});

Deno.test("no house name changed in README, IMPLEMENTED.md or the glossary", async () => {
  const [readme, implemented, glossary] = await Promise.all([
    Deno.readTextFile(README),
    Deno.readTextFile(IMPLEMENTED),
    Deno.readTextFile(GLOSSARY),
  ]);
  const readmeTitles = new Set(
    parseReadmeFeatures(readme).map((f) => f.title),
  );
  const implementedTitles = new Set(
    EXTENSION_SECTIONS.flatMap((h) => parseSectionEntries(implemented, h)).map(
      (e) => e.title,
    ),
  );
  const glossaryTitles = new Set(parseGlossaryTerms(glossary).map((t) =>
    t.title
  ));
  const failures = [
    ...README_HOUSE_NAMES.filter((n) => !readmeTitles.has(n)).map((n) =>
      `README.md: ${n}`
    ),
    ...IMPLEMENTED_HOUSE_NAMES.filter((n) => !implementedTitles.has(n)).map((
      n,
    ) => `IMPLEMENTED.md: ${n}`),
    ...GLOSSARY_HOUSE_NAMES.filter((n) => !glossaryTitles.has(n)).map((n) =>
      `GLOSSARY.md: ${n}`
    ),
  ];
  assert(
    failures.length === 0,
    `House names must not change:\n${failures.join("\n")}`,
  );
});

Deno.test("citations into REFERENCES.md resolve to a heading that exists", async () => {
  const anchors = await referenceAnchors();
  const failures: string[] = [];
  for (const file of [README, IMPLEMENTED, GLOSSARY]) {
    const content = await Deno.readTextFile(file);
    for (const anchor of referenceLinks(content)) {
      if (!anchors.has(anchor)) failures.push(`${file}: ${anchor}`);
    }
  }
  assert(
    failures.length === 0,
    `Citations point at REFERENCES.md headings that do not exist:\n${
      failures.join("\n")
    }`,
  );
});
