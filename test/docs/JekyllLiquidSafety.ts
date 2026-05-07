/**
 * Issue #2590 / #2592 — Jekyll/Liquid safety check for Markdown files
 * under `docs/`.
 *
 * The `docs/` tree is published via GitHub Pages, which runs every Markdown
 * file through Jekyll's Liquid templating engine. Liquid parses the **raw
 * source** before kramdown converts it to HTML, so any literal
 * `{% ... %}` or `{{ ... }}` sequence — *including inside fenced code
 * blocks (triple backticks) and inline code spans* — is parsed as a Liquid
 * tag and breaks the Pages build:
 *
 *   Liquid Exception: Liquid syntax error (line 10): Tag '{% ... %}' was
 *   not properly terminated with regexp: /\%\}/ in pr-summary-2590.md
 *
 * Issue #2590 originally assumed fenced code blocks protected Liquid
 * syntax. They do not — Liquid runs on the source before Markdown sees
 * the fences. Issue #2592 corrects that assumption: this test now scans
 * the entire file, regardless of fences, and only treats text inside a
 * `{% raw %} ... {% endraw %}` region as safe.
 *
 * The check is "what" tested: it walks real files and reports the
 * offending file plus line so a recurrence is fixed in seconds rather
 * than discovered by a failing Pages deploy.
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
 * Tracks one piece of nesting state:
 *   - `inRaw` — true while we are inside a `{% raw %} ... {% endraw %}`
 *               region. This is the only construct that protects Liquid
 *               syntax under Jekyll. Fenced code blocks do **not** protect
 *               Liquid: Liquid runs on the raw source before kramdown
 *               processes the fences.
 *
 * Liquid sequences (`{%` or `{{`) are flagged whenever `inRaw` is false.
 */
export function findLiquidOffences(source: string): Offence[] {
  const offences: Offence[] = [];
  const lines = source.split("\n");
  let inRaw = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

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

Deno.test("docs/**/*.md contains no unescaped Liquid syntax (#2590, #2592)", async () => {
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
        `the GitHub Pages (Jekyll) build does not parse them as tags. ` +
        `Note: fenced code blocks do NOT protect Liquid — wrap them too:\n` +
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

Deno.test("findLiquidOffences flags Liquid inside fenced code blocks (Jekyll parses fences) (#2592)", () => {
  // Pre-#2592 this test asserted offences.length === 0 on the assumption
  // that fenced code blocks protected Liquid syntax. Issue #2592 proved
  // that assumption wrong — Jekyll's Liquid parser runs on the raw source
  // before kramdown sees the fence, so `{% if foo %}` inside ``` is still
  // parsed as a tag and crashes the Pages build.
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
  // Two offences: the `{{` in `${{ runner.os }}` on line 4, and the first
  // `{%` on line 5. The walker records one offence per line and breaks.
  assertEquals(offences.length, 2);
  assertEquals(offences[0].line, 4);
  assertEquals(offences[1].line, 5);
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

Deno.test("findLiquidOffences ignores Liquid inside {% raw %} wrapping a fenced block (#2592)", () => {
  // Canonical fix pattern for fenced blocks that contain literal Liquid
  // sequences: wrap the entire fence in raw/endraw so Liquid skips it.
  const src = [
    "Prose.",
    "",
    "{% raw %}",
    "```",
    "Tag '{% ... %}' was not properly terminated",
    "```",
    "{% endraw %}",
    "",
    "More prose.",
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
