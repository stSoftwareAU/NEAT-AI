/**
 * Issue #3914 — `docs/comparison/TRAINING_PARADIGMS.md` used to benchmark
 * NEAT-AI against exactly two things: standard NEAT (2002) and traditional
 * neural networks. Neither is the live alternative a knowledgeable reader asks
 * about — academic neuroevolution largely moved to evolution strategies (ES)
 * and quality-diversity methods.
 *
 * The behaviour guarded here is that the comparison set stays honest:
 *
 *   1. A modern gradient-free training section sits between the NEAT-AI section
 *      and the reinforcement-learning section.
 *   2. That section cites ES, quality-diversity (novelty search and MAP-Elites)
 *      and CMA-ES, and every one of those citations also lands in
 *      `REFERENCES.md` (the bibliography every comparison doc cites into).
 *   3. The section carries a scoreboard that states both halves: ES wins the
 *      parallel-scaling axis NEAT-AI would most like to claim, and cannot evolve
 *      topology at all.
 *   4. `COMPARISON.md` links into that section with an anchor that actually
 *      resolves, so the standard-NEAT matrix is not read as the whole
 *      competitive picture.
 *
 * These are structural "what" tests in the spirit of `ComparisonSplit.ts` and
 * `ComparisonReferencesPrimarySources.ts`: they assert on section membership,
 * ordering, citation URLs and table verdicts — not on prose or length — so a
 * reword or reflow does not break them.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const TRAINING = `${REPO_ROOT}/docs/comparison/TRAINING_PARADIGMS.md`;
const REFERENCES = `${REPO_ROOT}/docs/comparison/REFERENCES.md`;
const HUB = `${REPO_ROOT}/COMPARISON.md`;

/** Stable URL fragments for the papers the modern-baselines section must cite. */
const REQUIRED_CITATIONS: ReadonlyArray<{ label: string; marker: string }> = [
  {
    label: "Salimans et al. (2017) — evolution strategies",
    marker: "1703.03864",
  },
  { label: "Lehman & Stanley (2011) — novelty search", marker: "EVCO_a_00025" },
  { label: "Mouret & Clune (2015) — MAP-Elites", marker: "1504.04909" },
  {
    label: "Hansen & Ostermeier (2001) — CMA-ES",
    marker: "106365601750190398",
  },
];

/**
 * Scoreboard verdicts the section must state. `es` / `neatAi` are the marker
 * each cell must carry: ✅ supported, 🟡 partial, ❌ not supported.
 */
const REQUIRED_VERDICTS: ReadonlyArray<
  { row: string; es: string; neatAi: string }
> = [
  { row: "evolves topology", es: "❌", neatAi: "✅" },
  { row: "parallel scaling", es: "✅", neatAi: "🟡" },
  { row: "sample efficiency", es: "❌", neatAi: "🟡" },
  { row: "wall-clock through parallelism", es: "✅", neatAi: "✅" },
  { row: "non-differentiable objectives", es: "✅", neatAi: "✅" },
];

interface Section {
  readonly heading: string;
  readonly body: string;
  readonly index: number;
}

/** Split a document into its `## ` sections, in document order. */
function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  let current: { heading: string; lines: string[]; index: number } | null =
    null;
  const flush = () => {
    if (current) {
      sections.push({
        heading: current.heading,
        body: current.lines.join("\n"),
        index: current.index,
      });
    }
  };
  for (const line of content.split("\n")) {
    const heading = line.match(/^##\s+(.*\S)\s*$/);
    if (heading) {
      flush();
      current = { heading: heading[1], lines: [], index: sections.length };
      continue;
    }
    current?.lines.push(line);
  }
  flush();
  return sections;
}

/**
 * GitHub's heading-anchor slug: lower-case, drop anything that is not a letter,
 * digit, space, underscore or hyphen (so emoji and dashes vanish), then replace
 * spaces with hyphens. Leading characters are not trimmed, which is why a
 * heading opening with an emoji yields an anchor starting with `-`.
 */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number} _-]/gu, "")
    .replace(/ /g, "-");
}

/** All `## `/`### ` heading anchors in a document. */
function headingAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of content.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (heading) anchors.add(slugify(heading[1]));
  }
  return anchors;
}

/** Parse the markdown table cells of a section, one array of cells per row. */
function parseTableRows(body: string): string[][] {
  return body
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) =>
        cell.trim()
      )
    )
    .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
}

async function modernSection(): Promise<
  { sections: Section[]; modern: Section }
> {
  const sections = parseSections(await Deno.readTextFile(TRAINING));
  const modern = sections.find((s) => /gradient-free/i.test(s.heading));
  assert(
    modern !== undefined,
    `TRAINING_PARADIGMS.md must carry a modern gradient-free training section; got headings:\n${
      sections.map((s) => s.heading).join("\n")
    }`,
  );
  return { sections, modern };
}

Deno.test("TRAINING_PARADIGMS.md places modern gradient-free training between NEAT-AI and reinforcement learning", async () => {
  const { sections, modern } = await modernSection();
  const neatAi = sections.find((s) => /^🧬 NEAT-AI$/.test(s.heading));
  const rl = sections.find((s) => /Reinforcement Learning/i.test(s.heading));
  assert(neatAi !== undefined, "the NEAT-AI section must still exist");
  assert(
    rl !== undefined,
    "the reinforcement-learning section must still exist",
  );
  assert(
    neatAi.index < modern.index && modern.index < rl.index,
    `modern gradient-free training must sit between NEAT-AI (${neatAi.index}) and reinforcement learning (${rl.index}); got ${modern.index}`,
  );
});

Deno.test("The modern gradient-free section cites ES, quality-diversity and CMA-ES", async () => {
  const { modern } = await modernSection();
  const missing = REQUIRED_CITATIONS.filter((c) =>
    !modern.body.includes(c.marker)
  );
  assert(
    missing.length === 0,
    `Missing citations in the modern gradient-free section:\n${
      missing.map((c) => `${c.label} (${c.marker})`).join("\n")
    }`,
  );
});

Deno.test("Every modern gradient-free citation also lands in REFERENCES.md", async () => {
  const references = await Deno.readTextFile(REFERENCES);
  const missing = REQUIRED_CITATIONS.filter((c) =>
    !references.includes(c.marker)
  );
  assert(
    missing.length === 0,
    `Citations must be folded into REFERENCES.md:\n${
      missing.map((c) => `${c.label} (${c.marker})`).join("\n")
    }`,
  );
});

Deno.test("The scoreboard states both halves — ES wins parallel scaling, NEAT-AI wins topology", async () => {
  const { modern } = await modernSection();
  const rows = parseTableRows(modern.body);
  assert(
    rows.length > 1,
    "the modern gradient-free section must carry a scoreboard table",
  );

  const header = rows[0];
  const esColumn = header.findIndex((cell) => /\bES\b/.test(cell));
  const neatColumn = header.findIndex((cell) => /NEAT-AI/.test(cell));
  assert(
    esColumn > 0,
    `scoreboard needs an ES column; got header: ${header.join(" | ")}`,
  );
  assert(
    neatColumn > 0,
    `scoreboard needs a NEAT-AI column; got header: ${header.join(" | ")}`,
  );

  const byRow = new Map<string, string[]>();
  for (const cells of rows.slice(1)) {
    byRow.set(cells[0].replace(/\*\*/g, "").trim().toLowerCase(), cells);
  }

  const failures: string[] = [];
  for (const expected of REQUIRED_VERDICTS) {
    const cells = byRow.get(expected.row);
    if (!cells) {
      failures.push(`missing scoreboard row: ${expected.row}`);
      continue;
    }
    if (!cells[esColumn]?.includes(expected.es)) {
      failures.push(
        `${expected.row}: ES verdict must be ${expected.es} — got "${
          cells[esColumn]
        }"`,
      );
    }
    if (!cells[neatColumn]?.includes(expected.neatAi)) {
      failures.push(
        `${expected.row}: NEAT-AI verdict must be ${expected.neatAi} — got "${
          cells[neatColumn]
        }"`,
      );
    }
  }
  assertEquals(
    failures,
    [],
    `Scoreboard verdicts wrong:\n${failures.join("\n")}`,
  );
});

Deno.test("COMPARISON.md points at the modern gradient-free section with a resolving anchor", async () => {
  const hub = await Deno.readTextFile(HUB);
  const training = await Deno.readTextFile(TRAINING);
  const anchors = headingAnchors(training);

  const linkRe =
    /\[[^\]]+\]\(\.\/docs\/comparison\/TRAINING_PARADIGMS\.md#([^)]+)\)/g;
  const fragments: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(hub)) !== null) fragments.push(match[1]);

  assert(
    fragments.length > 0,
    "COMPARISON.md must link into a TRAINING_PARADIGMS.md section so the standard-NEAT matrix is not read as the whole picture",
  );
  const broken = fragments.filter((fragment) => !anchors.has(fragment));
  assertEquals(
    broken,
    [],
    `COMPARISON.md anchors into TRAINING_PARADIGMS.md must resolve; broken: ${
      broken.join(", ")
    }`,
  );
  const { modern } = await modernSection();
  assert(
    fragments.includes(slugify(modern.heading)),
    `COMPARISON.md must link to the modern gradient-free section (#${
      slugify(modern.heading)
    }); found: ${fragments.join(", ")}`,
  );
});
