/**
 * Issue #2709 — `.github/workflows/quality.yml` must not interpolate
 * attacker-controlled GitHub context strings directly into bash `run:`
 * script bodies. The PR source branch name
 * (`github.event.pull_request.head.ref`) is controllable by anyone who
 * can open a PR and may contain shell metacharacters — interpolating it
 * via `${{ … }}` lets the value escape its quoting and execute as shell
 * commands with the workflow's secrets in scope.
 *
 * Untrusted GitHub-context strings must be passed via the step `env:`
 * map and referenced as `"$VAR"` in the bash body. This test scans the
 * workflow for the forbidden pattern.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW = join(REPO_ROOT, ".github/workflows/quality.yml");

/**
 * Lightweight parser: walks the workflow text line-by-line, tracks
 * whether we are inside a `run: |` (or `run: >`) block scalar, and
 * returns every `${{ … }}` expression that appears inside such a block.
 *
 * The parser is intentionally simple — it relies on indentation of the
 * `run:` key to determine the block scalar's body. Lines indented
 * deeper than the `run:` line are part of the block; lines at the same
 * or shallower indent end it.
 */
export function findGithubContextInRunBlocks(
  source: string,
): { expression: string; line: number }[] {
  const findings: { expression: string; line: number }[] = [];
  const lines = source.split("\n");
  let inRunBlock = false;
  let runIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (inRunBlock) {
      // Blank lines stay inside the block scalar.
      if (trimmed.length === 0) continue;
      if (indent <= runIndent) {
        inRunBlock = false;
      } else {
        // Scan for `${{ … }}` expressions in the body.
        const exprRegex = /\$\{\{\s*([^}]+?)\s*\}\}/g;
        let m: RegExpExecArray | null;
        while ((m = exprRegex.exec(line)) !== null) {
          findings.push({ expression: m[1], line: i + 1 });
        }
        continue;
      }
    }

    // Not inside a block: look for a `run: |` or `run: >` opener.
    const runMatch = trimmed.match(/^run:\s*([|>])/);
    if (runMatch) {
      inRunBlock = true;
      runIndent = indent;
    }
  }

  return findings;
}

Deno.test("findGithubContextInRunBlocks parses a simple injected run block", () => {
  const src = [
    "      - name: foo",
    "        run: |",
    '          echo "${{ github.ref_name }}"',
    "",
  ].join("\n");
  const hits = findGithubContextInRunBlocks(src);
  assertEquals(hits.length, 1);
  assertEquals(hits[0].expression, "github.ref_name");
});

Deno.test("findGithubContextInRunBlocks ignores expressions outside run blocks", () => {
  const src = [
    "      - name: foo",
    "        if: ${{ github.event_name == 'pull_request' }}",
    "        env:",
    "          FOO: ${{ github.ref_name }}",
    "        run: |",
    '          echo "$FOO"',
    "",
  ].join("\n");
  const hits = findGithubContextInRunBlocks(src);
  assertEquals(hits.length, 0);
});

Deno.test("findGithubContextInRunBlocks ends the block on dedent", () => {
  const src = [
    "      - name: foo",
    "        run: |",
    '          echo "safe"',
    "      - name: bar",
    '        run: echo "${{ github.ref_name }}"',
    "",
  ].join("\n");
  // Second run uses flow scalar (no | or >), so it isn't matched. Good —
  // flow scalars require a separate pattern and aren't used in quality.yml.
  const hits = findGithubContextInRunBlocks(src);
  assertEquals(hits.length, 0);
});

Deno.test(
  "quality.yml does not interpolate any github.* context into run blocks (Issue #2709)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    const hits = findGithubContextInRunBlocks(source);

    // Any expression referencing github.*, secrets.*, env.*, inputs.*, or
    // steps.*.outputs is potentially attacker-influenced and must be
    // passed through the step `env:` map instead.
    const forbidden = hits.filter((h) =>
      /^(github|secrets|inputs|env)\./.test(h.expression) ||
      /^steps\.[A-Za-z0-9_-]+\.outputs\./.test(h.expression)
    );

    assert(
      forbidden.length === 0,
      "quality.yml interpolates untrusted context inside run blocks — " +
        'pass these through the step env: map and reference as "$VAR" ' +
        "instead.\n" +
        forbidden
          .map((h) => `  line ${h.line}: \${{ ${h.expression} }}`)
          .join("\n"),
    );
  },
);

Deno.test(
  "quality.yml git checkout uses '--' end-of-options sentinel for branch names (Issue #2709)",
  async () => {
    const source = await Deno.readTextFile(WORKFLOW);
    // A branch name starting with '-' would otherwise be parsed as an
    // option. The suggested fix appends `--` to both checkout commands.
    // We require that any `git checkout … "$BRANCH_NAME"` in this
    // workflow ends with `--` (either before or after the argument as
    // appropriate for the form).
    const checkoutLines = source.split("\n").filter((l) =>
      /git checkout\b/.test(l) && /\$BRANCH_NAME/.test(l)
    );
    assert(
      checkoutLines.length > 0,
      'expected at least one `git checkout "$BRANCH_NAME"` invocation in quality.yml',
    );
    for (const line of checkoutLines) {
      assert(
        /--/.test(line),
        `git checkout with $BRANCH_NAME must use '--' end-of-options sentinel: ${line.trim()}`,
      );
    }
  },
);
