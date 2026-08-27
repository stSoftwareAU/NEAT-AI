/**
 * Issue #3914 — the comparison pages benchmarked NEAT-AI against exactly two
 * things: standard NEAT (2002) and traditional neural networks. Neither is the
 * live alternative a knowledgeable reader asks about, which is modern
 * gradient-free search: evolution strategies (ES) and quality-diversity.
 *
 * These tests pin the answer:
 *
 *   1. `TRAINING_PARADIGMS.md` carries a modern gradient-free section, sitting
 *      between the NEAT-AI section and the reinforcement-learning section.
 *   2. That section cites the primary sources — Salimans et al. (2017) for ES,
 *      Lehman & Stanley (2011) and Mouret & Clune (2015) for
 *      quality-diversity, Hansen & Ostermeier (2001) for CMA-ES — and every
 *      one of them is also carried by `REFERENCES.md` (Issue #3911).
 *   3. The scoreboard against ES is **honest**: ES wins the parallel-scaling
 *      row, NEAT-AI does not claim it, and NEAT-AI wins the topology row.
 *   4. The sample-efficiency-versus-wall-clock framing is present and is used
 *      to explain the fleet's own bargain.
 *   5. `COMPARISON.md` says its at-a-glance matrix compares against standard
 *      NEAT by design, and points at the new section.
 *
 * These are structural "what" tests in the spirit of
 * `ComparisonReferencesPrimarySources.ts` and `ComparisonValidityCons.ts`:
 * they assert on which sections exist, which citations they carry, and which
 * verdicts the scoreboard records — not on prose or length — so rewording does
 * not break them.
 */

import { assert } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const TRAINING_PARADIGMS = `${REPO_ROOT}/docs/comparison/TRAINING_PARADIGMS.md`;
const REFERENCES = `${REPO_ROOT}/docs/comparison/REFERENCES.md`;
const HUB = `${REPO_ROOT}/COMPARISON.md`;

/** Citations the modern gradient-free section must carry, with a URL marker. */
const REQUIRED_CITATIONS: ReadonlyArray<
  readonly [author: string, urlMarker: string, what: string]
> = [
  ["Salimans", "1703.03864", "evolution strategies at scale"],
  ["Lehman", "EVCO_a_00025", "novelty search"],
  ["Mouret", "1504.04909", "MAP-Elites"],
  ["Hansen", "106365601750190398", "CMA-ES"],
];

interface Section {
  readonly heading: string;
  readonly body: string;
}

/** Split a document into its `## ` sections, keeping each section's body. */
function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) {
      sections.push({
        heading: current.heading,
        body: current.lines.join("\n"),
      });
    }
  };
  for (const line of content.split("\n")) {
    const heading = line.match(/^##\s+(.*\S)\s*$/);
    if (heading) {
      flush();
      current = { heading: heading[1], lines: [] };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return sections;
}

async function readSections(path: string): Promise<Section[]> {
  return parseSections(await Deno.readTextFile(path));
}

function indexOfSection(
  sections: ReadonlyArray<Section>,
  marker: RegExp,
  what: string,
): number {
  const index = sections.findIndex((s) => marker.test(s.heading));
  assert(
    index >= 0,
    `Missing a section for ${what} (expected a heading matching ${marker}) in:\n${
      sections.map((s) => s.heading).join("\n")
    }`,
  );
  return index;
}

/** The rows of the first Markdown table in `body`, as trimmed cell arrays. */
function parseTable(body: string): string[][] {
  const rows: string[][] = [];
  let started = false;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (started) break;
      continue;
    }
    started = true;
    const cells = trimmed.slice(1).replace(/\|$/, "").split("|").map((c) =>
      c.trim()
    );
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator row
    rows.push(cells);
  }
  return rows;
}

async function gradientFreeSection(): Promise<Section> {
  const sections = await readSections(TRAINING_PARADIGMS);
  return sections[
    indexOfSection(sections, /gradient-free/i, "modern gradient-free training")
  ];
}

Deno.test("TRAINING_PARADIGMS.md covers modern gradient-free training between NEAT-AI and RL", async () => {
  const sections = await readSections(TRAINING_PARADIGMS);
  const neatAi = indexOfSection(sections, /^.*NEAT-AI\s*$/, "NEAT-AI");
  const gradientFree = indexOfSection(
    sections,
    /gradient-free/i,
    "modern gradient-free training",
  );
  const rl = indexOfSection(
    sections,
    /reinforcement learning/i,
    "reinforcement learning",
  );
  assert(
    neatAi < gradientFree && gradientFree < rl,
    "The modern gradient-free section must sit between the NEAT-AI section " +
      `and the reinforcement-learning section — got order ${neatAi}, ${gradientFree}, ${rl}`,
  );
});

Deno.test("TRAINING_PARADIGMS.md cites the modern gradient-free primary sources", async () => {
  const { body } = await gradientFreeSection();
  const missing = REQUIRED_CITATIONS
    .filter(([author, url]) => !(body.includes(author) && body.includes(url)))
    .map(([author, , what]) => `${author} (${what})`);
  assert(
    missing.length === 0,
    `The modern gradient-free section must cite, with a link:\n${
      missing.join("\n")
    }`,
  );
});

Deno.test("REFERENCES.md carries every citation the gradient-free section makes", async () => {
  const references = await Deno.readTextFile(REFERENCES);
  const missing = REQUIRED_CITATIONS
    .filter(([author, url]) =>
      !(references.includes(author) && references.includes(url))
    )
    .map(([author, , what]) => `${author} (${what})`);
  assert(
    missing.length === 0,
    `REFERENCES.md must carry every gradient-free citation:\n${
      missing.join("\n")
    }`,
  );
});

Deno.test("TRAINING_PARADIGMS.md scores NEAT-AI against ES honestly", async () => {
  const { body } = await gradientFreeSection();
  const rows = parseTable(body);
  assert(rows.length > 1, "The gradient-free section must carry a scoreboard");

  const header = rows[0];
  const es = header.findIndex((c) => /\bES\b/.test(c));
  const neatAi = header.findIndex((c) => /NEAT-AI/.test(c));
  assert(
    es >= 0 && neatAi >= 0,
    `The scoreboard needs an ES column and a NEAT-AI column — got: ${
      header.join(" | ")
    }`,
  );

  const rowFor = (marker: RegExp, what: string): string[] => {
    const row = rows.slice(1).find((r) => marker.test(r[0]));
    assert(
      row !== undefined,
      `The scoreboard is missing a row for ${what} — got:\n${
        rows.slice(1).map((r) => r[0]).join("\n")
      }`,
    );
    return row;
  };

  const topology = rowFor(/topolog/i, "evolving topology");
  assert(
    topology[es].includes("❌") && topology[neatAi].includes("✅"),
    `ES cannot evolve topology and NEAT-AI can — got: ${topology.join(" | ")}`,
  );

  const parallel = rowFor(/parallel/i, "parallel scaling");
  assert(
    parallel[es].includes("✅"),
    `ES must be credited with the parallel-scaling win — got: ${
      parallel.join(" | ")
    }`,
  );
  assert(
    !parallel[neatAi].includes("✅"),
    "NEAT-AI must not claim the parallel-scaling row it loses — got: " +
      parallel.join(" | "),
  );

  const sampleEfficiency = rowFor(/sample efficiency/i, "sample efficiency");
  assert(
    sampleEfficiency[es].includes("❌"),
    "The ES sample-efficiency cell must record the authors' own admission — " +
      `got: ${sampleEfficiency.join(" | ")}`,
  );

  const wallClock = rowFor(/wall.clock/i, "wall-clock through parallelism");
  assert(
    wallClock[es].includes("✅") && wallClock[neatAi].includes("✅"),
    `Wall-clock through parallelism is claimed by both — got: ${
      wallClock.join(" | ")
    }`,
  );

  const nonDifferentiable = rowFor(
    /non-differentiable/i,
    "non-differentiable objectives",
  );
  assert(
    nonDifferentiable[es].includes("✅") &&
      nonDifferentiable[neatAi].includes("✅"),
    `Both handle non-differentiable objectives — got: ${
      nonDifferentiable.join(" | ")
    }`,
  );
});

Deno.test("TRAINING_PARADIGMS.md borrows the sample-efficiency-vs-wall-clock framing for the fleet", async () => {
  const { body } = await gradientFreeSection();
  assert(
    /sample.efficien/i.test(body) && /wall.clock/i.test(body),
    "The section must state the ES trade-off — less sample-efficient, better wall-clock",
  );
  assert(
    /\bfleet\b/i.test(body),
    "The trade-off must be turned on the fleet's own design, not left as an ES fact",
  );
  assert(
    /judge/i.test(body),
    "The fleet's bargain is many cheap proposals against one expensive shared " +
      "judge — the judge must be named",
  );
});

Deno.test("COMPARISON.md scopes its at-a-glance matrix and points at the modern alternative", async () => {
  const content = await Deno.readTextFile(HUB);
  const sections = parseSections(content);
  const matrix = sections[
    indexOfSection(sections, /at-a-glance/i, "the at-a-glance matrix")
  ];
  assert(
    /by design/i.test(matrix.body) && /standard NEAT/i.test(matrix.body),
    "The matrix framing must say it compares against standard NEAT by design",
  );
  assert(
    /TRAINING_PARADIGMS\.md#/.test(matrix.body),
    "The matrix framing must link to the modern gradient-free section of " +
      "TRAINING_PARADIGMS.md so the 2002 matrix is not read as the whole picture",
  );
});
