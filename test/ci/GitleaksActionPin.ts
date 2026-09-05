/**
 * Issue #3949 — the `gitleaks/gitleaks-action` pin in
 * `.github/workflows/quality.yml` must stay on a maintained major line, pinned
 * to an immutable 40-char commit SHA with the resolved tag recorded beside it.
 *
 * `gitleaks-action@v2` runs on the Node 20 Actions runtime. Upstream's v3
 * migration guide records the deprecation timeline: from 2 June 2026 Node 20
 * actions need `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` to run at all,
 * and from 16 September 2026 Node 20 is removed from GitHub-hosted runners, so
 * a v2 pin stops working regardless of any opt-out. The step also reads
 * `secrets.GITLEAKS_LICENSE`, so a frozen pin keeps that secret in scope for a
 * runtime nobody maintains any more.
 *
 * v3 changes no inputs, outputs, or behaviour — only the runtime — so the pin
 * is expected to sit on major 3 or later.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW = join(REPO_ROOT, ".github/workflows/quality.yml");

/** The oldest gitleaks-action major line still supported by GitHub runners. */
const MINIMUM_SUPPORTED_MAJOR = 3;

export interface PinnedAction {
  /** `owner/repo` of the pinned action. */
  action: string;
  /** The `@ref` the workflow pins — a 40-char SHA when correctly pinned. */
  ref: string;
  /** Tag recorded in the neighbouring comment (e.g. `v3.0.0`), or null. */
  tag: string | null;
  /** 1-based line number of the `uses:` line. */
  line: number;
}

/**
 * Find how `action` (an `owner/repo` reference) is pinned in a workflow.
 *
 * The resolved tag is read from a trailing comment on the `uses:` line or from
 * a `# owner/repo@tag` comment on one of the four preceding lines — the two
 * forms this repository's workflows use.
 *
 * @returns the pin, or null when the workflow does not use the action.
 */
export function findPinnedAction(
  source: string,
  action: string,
): PinnedAction | null {
  const lines = source.split("\n");
  const usesPattern = new RegExp(
    `uses:\\s*${action.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}@(\\S+)`,
  );
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(usesPattern);
    if (!match) continue;
    return {
      action,
      ref: match[1],
      tag: findRecordedTag(lines, i, action),
      line: i + 1,
    };
  }
  return null;
}

/** Read the resolved tag from the `uses:` line's trailing or preceding comment. */
function findRecordedTag(
  lines: string[],
  index: number,
  action: string,
): string | null {
  const trailing = lines[index].match(
    /#\s*(?:\S+\/\S+@)?(v?\d+(?:\.\d+)*)\s*$/,
  );
  if (trailing) return trailing[1];
  for (let i = index - 1; i >= 0 && i >= index - 4; i--) {
    const preceding = lines[i].match(
      new RegExp(`#\\s*${action}@(v?\\d+(?:\\.\\d+)*)`),
    );
    if (preceding) return preceding[1];
  }
  return null;
}

/** Major version of a `vN.N.N` tag, or null when it is not a version tag. */
export function majorVersion(tag: string | null): number | null {
  if (tag === null) return null;
  const match = tag.match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

Deno.test("findPinnedAction reads the SHA and a preceding tag comment", () => {
  const source = [
    "      - name: Detect Secrets with gitleaks",
    "        # gitleaks/gitleaks-action@v3.0.0",
    "        uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e",
    "",
  ].join("\n");
  const pin = findPinnedAction(source, "gitleaks/gitleaks-action");
  assert(pin, "expected the gitleaks pin to be found");
  assertEquals(pin.ref, "e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e");
  assertEquals(pin.tag, "v3.0.0");
  assertEquals(pin.line, 3);
});

Deno.test("findPinnedAction reads a trailing tag comment", () => {
  const source = "      - uses: foo/bar@abc # foo/bar@v2.1.0\n";
  const pin = findPinnedAction(source, "foo/bar");
  assert(pin, "expected the foo/bar pin to be found");
  assertEquals(pin.tag, "v2.1.0");
});

Deno.test("findPinnedAction returns null for an action the workflow does not use", () => {
  const source = "      - uses: actions/checkout@abc\n";
  assertEquals(findPinnedAction(source, "gitleaks/gitleaks-action"), null);
});

Deno.test("findPinnedAction reports a missing tag comment as null", () => {
  const source = "      - uses: foo/bar@abc\n";
  const pin = findPinnedAction(source, "foo/bar");
  assert(pin, "expected the foo/bar pin to be found");
  assertEquals(pin.tag, null);
});

Deno.test("majorVersion parses tags and rejects non-versions", () => {
  assertEquals(majorVersion("v3.0.0"), 3);
  assertEquals(majorVersion("2.3.9"), 2);
  assertEquals(majorVersion(null), null);
  assertEquals(majorVersion("latest"), null);
});

Deno.test(
  "quality.yml pins gitleaks-action to a SHA with the resolved tag recorded (Issue #3949)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const pin = findPinnedAction(source, "gitleaks/gitleaks-action");
    assert(pin, "quality.yml must run the gitleaks secret scan");
    assert(
      /^[0-9a-f]{40}$/.test(pin.ref),
      `gitleaks-action must be pinned to a 40-char commit SHA on line ${pin.line}, got '${pin.ref}'`,
    );
    assert(
      pin.tag !== null,
      `expected a '# gitleaks/gitleaks-action@<tag>' comment near line ${pin.line} so reviewers can resolve the SHA`,
    );
  },
);

Deno.test(
  "quality.yml's gitleaks pin is off the deprecated Node 20 v2 line (Issue #3949)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const pin = findPinnedAction(source, "gitleaks/gitleaks-action");
    assert(pin, "quality.yml must run the gitleaks secret scan");
    const major = majorVersion(pin.tag);
    assert(
      major !== null && major >= MINIMUM_SUPPORTED_MAJOR,
      `gitleaks-action is pinned to '${pin.tag}' on line ${pin.line} — majors below v${MINIMUM_SUPPORTED_MAJOR} run on the Node 20 runtime GitHub removes from hosted runners on 16 September 2026`,
    );
  },
);
