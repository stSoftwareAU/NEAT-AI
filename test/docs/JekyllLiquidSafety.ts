/**
 * Issue #2590 — Jekyll/Liquid safety check for Markdown files under `docs/`.
 *
 * The `docs/` tree is published via GitHub Pages, which runs every Markdown
 * file through Jekyll's Liquid templating engine. Any literal `{% ... %}` or
 * `{{ ... }}` outside a fenced code block — including inside inline code
 * spans (single backticks) — is parsed as Liquid and breaks the Pages build:
 *
 *   Liquid Exception: Liquid syntax error (line 64): Tag '{% ... %}' was
 *   not properly terminated with regexp: /\%\}/ in pr-summary-2568.md
 *
 * This test scans every Markdown file under `docs/` and asserts that any
 * Liquid-looking sequence is either:
 *   1. inside a fenced code block (``` ... ```), or
 *   2. inside a `{% raw %} ... {% endraw %}` region.
 *
 * The check is "what" tested: it walks real files and reports the offending
 * file plus line so a recurrence is fixed in seconds rather than discovered
 * by a failing Pages deploy.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";
import { walk } from "@std/fs/walk";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DOCS_DIR = join(REPO_ROOT, "docs");

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Scan a single Markdown source for unescaped Liquid syntax.
 *
 * Tracks two pieces of nesting state:
 *   - `inFence`  — true while we are inside a triple-backtick fenced block.
 *   - `inRaw`    — true while we are inside a `{% raw %} ... {% endraw %}`
 *                  region.
 *
 * Liquid is only flagged when both flags are false.
 */
export function findLiquidOffences(source: string): Offence[] {
  const offences: Offence[] = [];
  const lines = source.split("\n");
  let inFence = false;
  let inRaw = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Toggle fenced code block state on lines that open/close with ```.
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) continue;

    // Walk the line and update inRaw / record offences.
    let j = 0;
    while (j < line.length) {
      if (!inRaw) {
        // Detect `{% raw %}` (allow whitespace between % and raw).
        const rawOpen = line.slice(j).match(/^\{%-?\s*raw\s*-?%\}/);
        if (rawOpen) {
          inRaw = true;
          j += rawOpen[0].length;
          continue;
        }

        // Any `{%` or `{{` outside raw is an offence.
        if (
          line[j] === "{" && (line[j + 1] === "%" || line[j + 1] === "{")
        ) {
          offences.push({ file: "", line: i + 1, text: line });
          break;
        }
      } else {
        // Detect `{% endraw %}`.
        const rawClose = line.slice(j).match(/^\{%-?\s*endraw\s*-?%\}/);
        if (rawClose) {
          inRaw = false;
          j += rawClose[0].length;
          continue;
        }
      }
      j++;
    }
  }

  return offences;
}

Deno.test("docs/**/*.md contains no unescaped Liquid syntax (#2590)", async () => {
  const offences: Offence[] = [];

  for await (
    const entry of walk(DOCS_DIR, {
      exts: [".md"],
      includeDirs: false,
    })
  ) {
    const source = await Deno.readTextFile(entry.path);
    const fileOffences = findLiquidOffences(source);
    for (const off of fileOffences) {
      offences.push({
        ...off,
        file: relative(REPO_ROOT, entry.path),
      });
    }
  }

  if (offences.length > 0) {
    const detail = offences
      .map((o) => `  ${o.file}:${o.line}: ${o.text.trim()}`)
      .join("\n");
    throw new Error(
      `Found ${offences.length} unescaped Liquid {% ... %} / {{ ... }} ` +
        `sequence(s) in docs/. Wrap each in {% raw %} ... {% endraw %} so ` +
        `the GitHub Pages (Jekyll) build does not parse them as tags:\n` +
        detail,
    );
  }

  assertEquals(offences.length, 0);
});

Deno.test("findLiquidOffences flags bare {% in prose", () => {
  const src = "Plain prose with `{% if foo %}` inline.\n";
  const offences = findLiquidOffences(src);
  assertEquals(offences.length, 1);
  assertEquals(offences[0].line, 1);
});

Deno.test("findLiquidOffences flags bare {{ in prose", () => {
  const src = "Reference {{ runner.os }} in prose.\n";
  const offences = findLiquidOffences(src);
  assertEquals(offences.length, 1);
});

Deno.test("findLiquidOffences ignores Liquid inside fenced code blocks", () => {
  const src = [
    "Some prose.",
    "",
    "```yaml",
    "key: ${{ runner.os }}",
    "tag: {% if foo %}bar{% endif %}",
    "```",
    "",
    "More prose.",
    "",
  ].join("\n");
  const offences = findLiquidOffences(src);
  assertEquals(offences.length, 0);
});

Deno.test("findLiquidOffences ignores Liquid inside {% raw %} blocks", () => {
  const src = [
    "Plain text.",
    "{% raw %}",
    "literal `{% if foo %}` and `{{ x }}` here",
    "{% endraw %}",
    "More text.",
    "",
  ].join("\n");
  const offences = findLiquidOffences(src);
  assertEquals(offences.length, 0);
});

Deno.test("findLiquidOffences supports inline {% raw %}{% endraw %} on one line", () => {
  const src = "Use {% raw %}`{% if x %}`{% endraw %} for that.\n";
  const offences = findLiquidOffences(src);
  assertEquals(offences.length, 0);
});
