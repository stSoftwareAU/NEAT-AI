/**
 * Issue #3911 — `docs/comparison/REFERENCES.md` is the bibliography every other
 * comparison doc cites into, so it must be organised around the *literature*
 * rather than around the house vocabulary:
 *
 *   1. Every literature area NEAT-AI actually implements has a section (pruning,
 *      structural growth, surrogate-assisted search, attribution, evaluation
 *      validity, linkage, Lamarckian/Baldwinian evolution …).
 *   2. Each of those sections leads with a **primary source** — a paper — not a
 *      Wikipedia overview. Wikipedia stays as orientation for the stated
 *      no-prior-expertise audience, just not in the lead position.
 *   3. The Wikipedia orientation links that were already there are retained.
 *   4. The Roberts, Gelman & Gilks (1997) gloss is scoped to random-walk
 *      Metropolis and does not present the ~23.4% figure as a result about
 *      evolutionary-algorithm acceptance rates. That was a factual error, so it
 *      is guarded directly.
 *
 * These are structural "what" tests in the spirit of `ComparisonSplit.ts` and
 * `NeatTerminologyDefersToCanonical.ts`: they assert on section membership and
 * on which *kind* of source leads each section, not on prose or length, so
 * rewording or adding citations does not break them. Assertion 4 is the one
 * wording-sensitive check, and it is deliberate — the qualification it guards
 * is the correction the issue asked for.
 */

import { assert } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const REFERENCES = `${REPO_ROOT}/docs/comparison/REFERENCES.md`;

/** Sections the bibliography must carry, by exact `## ` heading text. */
const REQUIRED_SECTIONS: ReadonlyArray<string> = [
  "🧬 NEAT algorithm (standard NEAT)",
  "🧠 Traditional neural networks",
  "🤖 Modern LLMs and Transformers",
  "🧬 Memetic algorithms",
  "🧬 Lamarckian and Baldwinian evolution",
  "🎲 Markov Chain Monte Carlo (MCMC)",
  "✂️ Pruning and sparsity",
  "🌱 Structural growth",
  "🎯 Surrogate-assisted search and racing",
  "🔍 Attribution and saliency",
  "📏 Evaluation validity",
  "🔗 Linkage and epistasis",
  "🧬 Horizontal gene transfer and breeding",
  "🔬 Neuroevolution",
];

/**
 * Sections whose first entry must be a primary source. Excluded are the
 * orientation/tooling sections, which have no primary literature to lead with:
 * vendor GPU documentation, the beginner course list, and the internal
 * cross-links.
 */
const ORIENTATION_ONLY_SECTIONS: ReadonlySet<string> = new Set([
  "⚡ GPU acceleration",
  "📖 Machine-learning fundamentals",
  "🔗 Related comparison pages",
]);

/** Wikipedia orientation links that existed before the rebuild and must stay. */
const RETAINED_WIKIPEDIA_LINKS: ReadonlyArray<string> = [
  "https://en.wikipedia.org/wiki/Neuroevolution_of_augmenting_topologies",
  "https://en.wikipedia.org/wiki/Backpropagation",
  "https://en.wikipedia.org/wiki/Memetic_algorithm",
  "https://en.wikipedia.org/wiki/Metropolis%E2%80%93Hastings_algorithm",
  "https://en.wikipedia.org/wiki/Markov_chain_Monte_Carlo",
  "https://en.wikipedia.org/wiki/Horizontal_gene_transfer",
  "https://en.wikipedia.org/wiki/Island_model",
  "https://en.wikipedia.org/wiki/Cosine_similarity",
];

/** Stable fragment of the Roberts, Gelman & Gilks (1997) URL. */
const OPTIMAL_SCALING_URL_MARKER = "1034625254";

interface Section {
  readonly heading: string;
  readonly bullets: ReadonlyArray<string>;
}

/**
 * Split the document into `## ` sections, each with its top-level bullets.
 * Continuation lines of a wrapped bullet are folded into that bullet so a
 * reflow does not change the parse.
 */
function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  let current: { heading: string; bullets: string[] } | null = null;
  for (const line of content.split("\n")) {
    const heading = line.match(/^##\s+(.*\S)\s*$/);
    if (heading) {
      current = { heading: heading[1], bullets: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    if (/^- /.test(line)) {
      current.bullets.push(line.slice(2).trim());
    } else if (/^\s+\S/.test(line) && current.bullets.length > 0) {
      const last = current.bullets.length - 1;
      current.bullets[last] = `${current.bullets[last]} ${line.trim()}`;
    }
  }
  return sections;
}

async function readSections(): Promise<Section[]> {
  return parseSections(await Deno.readTextFile(REFERENCES));
}

Deno.test("REFERENCES.md carries a section for every cited literature area", async () => {
  const headings = new Set((await readSections()).map((s) => s.heading));
  const missing = REQUIRED_SECTIONS.filter((h) => !headings.has(h));
  assert(
    missing.length === 0,
    `REFERENCES.md is missing required sections:\n${missing.join("\n")}`,
  );
});

Deno.test("REFERENCES.md leads every literature section with a primary source", async () => {
  const sections = (await readSections()).filter(
    (s) => !ORIENTATION_ONLY_SECTIONS.has(s.heading),
  );
  const failures: string[] = [];
  for (const section of sections) {
    const lead = section.bullets[0];
    if (lead === undefined) {
      failures.push(`${section.heading}: section has no entries`);
      continue;
    }
    if (lead.includes("wikipedia.org")) {
      failures.push(
        `${section.heading}: leads with a Wikipedia overview — "${lead}"`,
      );
    }
  }
  assert(
    failures.length === 0,
    `Sections not led by a primary source:\n${failures.join("\n")}`,
  );
});

Deno.test("REFERENCES.md retains its Wikipedia orientation links", async () => {
  const content = await Deno.readTextFile(REFERENCES);
  const dropped = RETAINED_WIKIPEDIA_LINKS.filter((url) =>
    !content.includes(url)
  );
  assert(
    dropped.length === 0,
    `Wikipedia orientation links must be kept, not removed:\n${
      dropped.join("\n")
    }`,
  );
});

Deno.test("REFERENCES.md scopes the ~23.4% optimal-scaling result to random-walk Metropolis", async () => {
  const sections = await readSections();
  const entry = sections
    .flatMap((s) => s.bullets)
    .find((b) => b.includes(OPTIMAL_SCALING_URL_MARKER));
  assert(
    entry !== undefined,
    "The Roberts, Gelman & Gilks (1997) optimal-scaling paper must still be cited",
  );
  assert(
    /random-walk Metropolis/i.test(entry),
    `The optimal-scaling gloss must say the result is about random-walk Metropolis — got: "${entry}"`,
  );
  assert(
    /heuristic/i.test(entry),
    `The gloss must state that NEAT-AI's ~23.4% target is a borrowed heuristic — got: "${entry}"`,
  );
  assert(
    !/optimal acceptance-rate theory/i.test(entry),
    "The gloss must no longer claim the result is acceptance-rate theory for evolutionary algorithms",
  );
});
