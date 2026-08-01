/**
 * Issue #2696 — every GitHub Actions `uses:` reference in
 * `.github/workflows/*.y*ml` must pin to a 40-character commit SHA rather than
 * a moving ref such as `@vN`, `@master`, `@main`, or `@HEAD`.
 *
 * Version tags are mutable: an action maintainer (or compromised account) can
 * re-tag `v4` to point at a malicious commit. Pinning to a 40-char SHA removes
 * that risk entirely. `publish.yml` runs with `id-token: write` and
 * `quality.yml` / `update-package-version.yml` expose `secrets.ACTIONS_PUSH`,
 * so a compromised action could exfiltrate those credentials or push tampered
 * code.
 *
 * This test scans every workflow file and asserts that each pinned action is
 * a 40-character lowercase hex SHA and carries a nearby comment naming the
 * resolved tag (so reviewers can verify provenance).
 *
 * Issue #3608 — local composite actions under `.github/actions/` are scanned
 * too. They run inside the same jobs and pin the same third-party actions, so
 * moving a `uses:` there must not move it out of this gate. Local `./…`
 * references are exempt by construction: they carry no `@ref`, so
 * `extractUses` never returns them.
 */

import { assert, assertMatch } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { extractUses } from "./ShellcheckWorkflowPinning.ts";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");
const ACTIONS_DIR = join(REPO_ROOT, ".github/actions");

/** Every workflow file plus every local composite action definition. */
async function listActionYamlFiles(): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile) continue;
    if (!/\.ya?ml$/.test(entry.name)) continue;
    paths.push(join(WORKFLOWS_DIR, entry.name));
  }
  const candidates: string[] = [];
  for await (const entry of Deno.readDir(ACTIONS_DIR)) {
    if (!entry.isDirectory) continue;
    candidates.push(
      join(ACTIONS_DIR, entry.name, "action.yml"),
      join(ACTIONS_DIR, entry.name, "action.yaml"),
    );
  }
  const stats = await Promise.all(
    candidates.map((path) => Deno.stat(path).catch(() => null)),
  );
  candidates.forEach((path, i) => {
    if (stats[i]?.isFile) paths.push(path);
  });
  paths.sort();
  return paths;
}

async function readAllWorkflows(): Promise<
  { name: string; source: string }[]
> {
  const files = await listActionYamlFiles();
  const reads = files.map(async (path) => ({
    name: path.slice(REPO_ROOT.length),
    source: await Deno.readTextFile(path),
  }));
  return await Promise.all(reads);
}

Deno.test(
  "every workflow `uses:` is pinned to a 40-char commit SHA (Issue #2696)",
  async () => {
    const workflows = await readAllWorkflows();
    assert(workflows.length > 0, "expected at least one workflow file");

    for (const { name, source } of workflows) {
      const refs = extractUses(source);
      for (const r of refs) {
        assert(
          r.ref !== "master" && r.ref !== "main" && r.ref !== "HEAD",
          `${name}: ${r.action} pinned to moving ref '${r.ref}' on line ${r.line}`,
        );
        assert(
          !/^v?\d+(\.\d+)*$/.test(r.ref),
          `${name}: ${r.action} pinned to mutable tag '${r.ref}' on line ${r.line} — use a 40-char commit SHA instead`,
        );
        assertMatch(
          r.ref,
          /^[0-9a-f]{40}$/,
          `${name}: ${r.action} must be pinned to a 40-char commit SHA on line ${r.line}, got '${r.ref}'`,
        );
      }
    }
  },
);

Deno.test(
  "every pinned workflow action records the resolved tag in a nearby comment (Issue #2696)",
  async () => {
    const workflows = await readAllWorkflows();
    for (const { name, source } of workflows) {
      const lines = source.split("\n");
      const refs = extractUses(source);
      for (const r of refs) {
        // Accept either a same-line trailing comment (e.g. `@sha # owner/repo@v1`)
        // or a comment on one of the few preceding lines naming the action.
        const sameLine = lines[r.line - 1] ?? "";
        // Accept a trailing `# owner/repo@v1` form OR a bare `# v1.2.3` tag.
        const hasTrailingComment =
          /#\s*[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@\S+/.test(sameLine) ||
          /#\s*v?\d+(\.\d+)*(\S*)?\s*$/.test(sameLine);

        let hasPrecedingComment = false;
        for (let i = r.line - 2; i >= 0 && i >= r.line - 5; i--) {
          const prev = lines[i] ?? "";
          if (prev.includes(`# ${r.action}@`)) {
            hasPrecedingComment = true;
            break;
          }
        }

        assert(
          hasTrailingComment || hasPrecedingComment,
          `${name}: expected a '# ${r.action}@<tag>' comment near line ${r.line} so reviewers can resolve the SHA`,
        );
      }
    }
  },
);
