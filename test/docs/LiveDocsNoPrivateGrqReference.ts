/**
 * Issue #3453 — live (non-archive) documentation must stay self-contained for
 * public readers and must not name or link the private `stSoftwareAU` repos
 * `GRQ`, `GRQ-cluster` or `GRQ-logs`.
 *
 * A public repository is fully self-contained for the public: a doc line that
 * names or links a private repository is dead weight to every public reader —
 * the link 404s and the named file paths are unverifiable. This test walks the
 * real docs and fails if any reintroduces a private `GRQ*` reference. It
 * exercises behaviour (doc content), not the source text of any function.
 *
 * Detection is case-sensitive on the upper-case `GRQ` token so the in-tree
 * synthetic `grq-3397` scale-preset name (a fixture, not a private repo) is not
 * flagged.
 *
 * Issue #3615 extends the guard beyond the three hard-coded docs above: every
 * live doc under `docs/` (outside `docs/archive/`) is scanned with the shared
 * `PRIVATE_REPO_PATTERN` from `test/_privateRepoRefs.ts` (Issue #3617 decision,
 * extended by Issue #4142). That covers org-qualified slugs and links
 * (`stSoftwareAU/GRQ*`, `github.com/stSoftwareAU/GRQ*`, notably the
 * `gh search code … --repo stSoftwareAU/GRQ` commands the option-audit slices
 * shipped), issue slugs (`GRQ#NNNN`) and un-prefixed private repo names
 * (`GRQ-cluster`, `GRQ-logs`, `GRQ-teams`). A bare `GRQ` mnemonic (`GRQ-22`
 * host) and the lower-case `grq-3397` fixture are still not matched: they name
 * a concept rather than pointing at an unreachable page, matching the
 * #3454/#3604 decision recorded in `test/_privateRepoRefs.ts`.
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { walkSync } from "@std/fs";
import { scanForPrivateRepoRefs } from "../_privateRepoRefs.ts";

/** Live docs that must not reference the private `GRQ*` repositories. */
const LIVE_DOCS = [
  "../../docs/comparison/PROS_AND_CONS.md",
  "../../docs/PROFILING_REPORT_3397.md",
  "../../docs/VERSION_VISIBILITY.md",
];

/**
 * Return every line that names or links a private `GRQ*` repository
 * (`GRQ`, `GRQ-cluster`, `GRQ-logs`). Matching is case-sensitive so the
 * lower-case in-tree `grq-3397` fixture name is not a false positive.
 *
 * @param source raw Markdown source
 * @returns 1-indexed line numbers carrying a private `GRQ*` reference
 */
export function findPrivateGrqReferences(source: string): number[] {
  const pattern = /GRQ/;
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

for (const rel of LIVE_DOCS) {
  Deno.test(`live doc ${rel} has no private GRQ reference (#3453)`, async () => {
    const path = fromFileUrl(new URL(rel, import.meta.url));
    const source = await Deno.readTextFile(path);
    const hits = findPrivateGrqReferences(source);
    assertEquals(
      hits,
      [],
      `${rel} references a private GRQ* repository on line(s) ` +
        `${hits.join(", ")}. Reword to concept level so the doc stays ` +
        `verifiable by public readers.`,
    );
  });
}

const DOCS_DIR = fromFileUrl(new URL("../../docs", import.meta.url));

/**
 * Walk every live (non-archive) `.md` file under `docsDir` and report the
 * private-repo references found by the shared scanner.
 *
 * @param docsDir root of the docs tree; `<docsDir>/archive` is skipped
 * @returns sorted `docs-relative/path.md:line,line` entries, one per offending
 *          file; empty when every live doc is clean
 */
export function scanLiveDocsForPrivateRepoRefs(docsDir: string): string[] {
  const paths: string[] = [];
  for (
    const entry of walkSync(docsDir, { exts: [".md"], includeDirs: false })
  ) {
    const rel = relative(docsDir, entry.path);
    if (rel.split(/[\\/]/)[0] === "archive") continue;
    paths.push(entry.path);
  }
  const offenders: string[] = [];
  for (const offender of scanForPrivateRepoRefs(paths)) {
    // The shared scanner formats `path:line,line`; the lines never contain a
    // colon, so the last colon separates the path from the line list.
    const split = offender.lastIndexOf(":");
    const path = offender.slice(0, split);
    const lines = offender.slice(split + 1);
    offenders.push(`${relative(docsDir, path)}:${lines}`);
  }
  return offenders.sort();
}

Deno.test("no live doc names a private stSoftwareAU repo, including un-prefixed names (#3615, #4142)", () => {
  assertEquals(
    scanLiveDocsForPrivateRepoRefs(DOCS_DIR),
    [],
    `Live docs must not name private stSoftwareAU repos (including ` +
      `un-prefixed names such as GRQ-cluster, GRQ-logs and GRQ-teams). ` +
      `Reword to concept level (e.g. "the downstream production consumer") ` +
      `and use a "<consumer-repo>" placeholder in example commands so the ` +
      `documented method stays runnable by public readers.`,
  );
});

/**
 * Create a throwaway docs tree from `files` (relative path to content), run
 * `check` against it, and always remove it afterwards.
 */
async function withDocsFixture(
  files: Record<string, string>,
  check: (dir: string) => void,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await Promise.all(
      Object.entries(files).map(async ([rel, content]) => {
        const path = join(dir, rel);
        await Deno.mkdir(dirname(path), { recursive: true });
        await Deno.writeTextFile(path, content);
      }),
    );
    check(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const TIMEOUTS_LEAKING = [
  "Intro line.",
  "The GRQ-logs output shows the timeout.",
  "Closing line.",
].join("\n");

const TIMEOUTS_REWORDED = [
  "Intro line.",
  "The downstream consumer's logs show the timeout.",
  "Closing line.",
].join("\n");

Deno.test("scanLiveDocsForPrivateRepoRefs flags un-prefixed GRQ repo names, skips archive, and reports docs-relative paths", async () => {
  await withDocsFixture(
    {
      "TIMEOUTS.md": TIMEOUTS_LEAKING,
      "sub/OTHER.md": "Heading\n\nSee the GRQ-teams roster.\n",
      "archive/ignored.md": "Archived note naming GRQ-logs.\n",
      "CLEAN.md": "A production-scale network snapshot keeps growing.\n",
    },
    (dir) => {
      assertEquals(scanLiveDocsForPrivateRepoRefs(dir), [
        "TIMEOUTS.md:2",
        "sub/OTHER.md:3",
      ]);
    },
  );
});

Deno.test("scanLiveDocsForPrivateRepoRefs accepts the same doc once the un-prefixed name is reworded", async () => {
  await withDocsFixture(
    { "TIMEOUTS.md": TIMEOUTS_REWORDED },
    (dir) => {
      assertEquals(scanLiveDocsForPrivateRepoRefs(dir), []);
    },
  );
});

Deno.test("scanLiveDocsForPrivateRepoRefs flags a repo slug and a gh search command", async () => {
  await withDocsFixture(
    {
      "REPO.md": [
        "Consumers were confirmed from `deno.json`: `stSoftwareAU/GRQ` pins",
        'gh search code "<key>" --repo stSoftwareAU/GRQ --limit 20',
        "Closing line.",
      ].join("\n"),
    },
    (dir) => {
      assertEquals(scanLiveDocsForPrivateRepoRefs(dir), ["REPO.md:1,2"]);
    },
  );
});

Deno.test("scanLiveDocsForPrivateRepoRefs flags an issue slug and a repo link", async () => {
  await withDocsFixture(
    {
      "ISSUE.md": [
        "is filed there as **stSoftwareAU/GRQ#3793**.",
        "See https://github.com/stSoftwareAU/GRQ-cluster/blob/main/net.json.",
      ].join("\n"),
    },
    (dir) => {
      assertEquals(scanLiveDocsForPrivateRepoRefs(dir), ["ISSUE.md:1,2"]);
    },
  );
});

Deno.test("scanLiveDocsForPrivateRepoRefs ignores bare mnemonics and the lower-case grq-3397 fixture", async () => {
  await withDocsFixture(
    {
      "MNEMONIC.md": [
        "The downstream production consumer sets `populationSize`.",
        "GRQ-22 host snapshot: 16 GB total, 10 CPUs.",
        "The synthetic `grq-3397` scale preset reproduces the dimensions.",
      ].join("\n"),
    },
    (dir) => {
      assertEquals(scanLiveDocsForPrivateRepoRefs(dir), []);
    },
  );
});

Deno.test("findPrivateGrqReferences flags GRQ-cluster and GRQ-logs", () => {
  const src = [
    "Intro line.",
    "See the GRQ-cluster network snapshot.",
    "Traced back through the GRQ-logs output.",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateGrqReferences(src), [2, 3]);
});

Deno.test("findPrivateGrqReferences flags a bare GRQ repo name", () => {
  const src = "run the GRQ/worker/learn.sh script.\n";
  assertEquals(findPrivateGrqReferences(src), [1]);
});

Deno.test("findPrivateGrqReferences ignores the lower-case grq-3397 fixture", () => {
  const src = [
    "The synthetic `grq-3397` scale preset reproduces the dimensions.",
    "Re-running against the `grq-3397` generator must reproduce the line.",
  ].join("\n");
  assertEquals(findPrivateGrqReferences(src), []);
});

Deno.test("findPrivateGrqReferences returns empty for concept-level prose", () => {
  const src = [
    "A production-scale network snapshot (~1,670 neurons) keeps growing.",
    "The downstream production runner scripts select the scoring lane.",
  ].join("\n");
  assertEquals(findPrivateGrqReferences(src), []);
});

Deno.test("findPrivateGrqReferences returns empty for empty input", () => {
  assertEquals(findPrivateGrqReferences(""), []);
});
