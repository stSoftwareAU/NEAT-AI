/**
 * Issue #3961 — Mermaid `sequenceDiagram` message text must not contain a
 * bare `;`.
 *
 * Mermaid treats `;` as a statement separator inside a `sequenceDiagram`,
 * regardless of surrounding parentheses or `<br/>` tags. A message such as
 *
 *   evolveDir->>Neat: doThing()<br/>(top of every pass — #4470;<br/>no-op)
 *
 * therefore fails to parse and the published diagram disappears from the
 * GitHub Pages build. `docs/TIMEOUTS.md` shipped exactly that fault.
 *
 * The check is "what" tested: `findSequenceSemicolonOffences` is called with
 * real Markdown, and the repo-wide test walks the actual files and reports
 * the offending file and line so a recurrence is fixed in seconds.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";
import { walk } from "@std/fs/walk";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DOCS_DIR = join(REPO_ROOT, "docs");

/**
 * Lines inside a `sequenceDiagram` whose tail is user-supplied text parsed by
 * Mermaid up to a statement terminator: message arrows (`->`, `->>`, `-->`,
 * `-->>`, `-x`, `--x`) and `Note left of|right of|over` lines.
 */
const SEQUENCE_MESSAGE_RE =
  /^\s*(?:[A-Za-z_][\w-]*\s*(?:->>?|-->?>?|-[xX]|--[xX])\s*[A-Za-z_][\w-]*|Note\s+(?:left of|right of|over)\s+[^:]+):\s*(.*)$/;

export interface SequenceSemicolonOffence {
  /** Repo-relative file path (empty until the caller fills it in). */
  readonly file: string;
  /** 1-indexed line number within the file. */
  readonly line: number;
  /** The offending source line, trimmed. */
  readonly text: string;
}

/**
 * Scan Markdown for `sequenceDiagram` message lines containing a bare `;`.
 *
 * Only fenced ```mermaid blocks whose declaration is `sequenceDiagram` are
 * inspected — a `;` in prose, in a flowchart node label, or in a code sample
 * is harmless and is not reported.
 */
export function findSequenceSemicolonOffences(
  source: string,
): SequenceSemicolonOffence[] {
  const offences: SequenceSemicolonOffence[] = [];
  const lines = source.split("\n");

  let inMermaid = false;
  let isSequence = false;
  let seenDeclaration = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inMermaid) {
      if (/^\s*```mermaid\s*$/.test(line)) {
        inMermaid = true;
        isSequence = false;
        seenDeclaration = false;
      }
      continue;
    }

    if (/^\s*```\s*$/.test(line)) {
      inMermaid = false;
      continue;
    }

    const trimmed = line.trim();
    if (!seenDeclaration) {
      // Mermaid permits `%%{init: ...}%%` directives ahead of the keyword.
      if (trimmed === "" || trimmed.startsWith("%%")) continue;
      seenDeclaration = true;
      isSequence = trimmed.split(/\s+/)[0] === "sequenceDiagram";
      continue;
    }

    if (!isSequence) continue;

    const match = SEQUENCE_MESSAGE_RE.exec(line);
    if (match && (match[1] ?? "").includes(";")) {
      offences.push({ file: "", line: i + 1, text: trimmed });
    }
  }

  return offences;
}

Deno.test("Markdown sequenceDiagram messages contain no bare ';' (#3961)", async () => {
  const offences: SequenceSemicolonOffence[] = [];

  const files: string[] = [];
  for await (
    const entry of walk(DOCS_DIR, { exts: [".md"], includeDirs: false })
  ) {
    files.push(entry.path);
  }
  for await (const entry of Deno.readDir(REPO_ROOT)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      files.push(join(REPO_ROOT, entry.name));
    }
  }

  const sources = await Promise.all(files.map((p) => Deno.readTextFile(p)));
  for (let i = 0; i < files.length; i++) {
    for (const off of findSequenceSemicolonOffences(sources[i])) {
      offences.push({ ...off, file: relative(REPO_ROOT, files[i]) });
    }
  }

  if (offences.length > 0) {
    const detail = offences
      .map((o) => `  ${o.file}:${o.line}: ${o.text}`)
      .join("\n");
    throw new Error(
      `Found ${offences.length} sequenceDiagram message(s) containing a bare ` +
        `';', which Mermaid parses as a statement separator and which breaks ` +
        `the rendered diagram. Replace ';' with ',' or ' — ':\n` +
        detail,
    );
  }

  assertEquals(offences.length, 0);
});

Deno.test("findSequenceSemicolonOffences flags a ';' inside message text", () => {
  const src = [
    "```mermaid",
    "sequenceDiagram",
    "    A->>B: doThing()<br/>(every pass — #4470;<br/>no-op until banked)",
    "```",
    "",
  ].join("\n");
  const offences = findSequenceSemicolonOffences(src);
  assertEquals(offences.length, 1);
  assertEquals(offences[0].line, 3);
});

Deno.test("findSequenceSemicolonOffences flags a ';' in a Note line", () => {
  const src = [
    "```mermaid",
    "sequenceDiagram",
    "    Note over A,B: start; then stop",
    "```",
    "",
  ].join("\n");
  const offences = findSequenceSemicolonOffences(src);
  assertEquals(offences.length, 1);
});

Deno.test("findSequenceSemicolonOffences accepts a comma-separated message", () => {
  const src = [
    "```mermaid",
    "sequenceDiagram",
    "    A->>B: doThing()<br/>(every pass — #4470,<br/>no-op until banked)",
    "```",
    "",
  ].join("\n");
  assertEquals(findSequenceSemicolonOffences(src).length, 0);
});

Deno.test("findSequenceSemicolonOffences ignores non-sequence diagrams and prose", () => {
  const src = [
    "Prose with a semicolon; harmless.",
    "",
    "```mermaid",
    "flowchart LR",
    '    A["one; two"] --> B',
    "```",
    "",
    "```text",
    "A->>B: raw sample; not mermaid",
    "```",
    "",
  ].join("\n");
  assertEquals(findSequenceSemicolonOffences(src).length, 0);
});

Deno.test("findSequenceSemicolonOffences scans a block behind an init directive", () => {
  const src = [
    "```mermaid",
    "%%{init: {'theme':'dark'}}%%",
    "sequenceDiagram",
    "    A->>B: one; two",
    "```",
    "",
  ].join("\n");
  assertEquals(findSequenceSemicolonOffences(src).length, 1);
});
