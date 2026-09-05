/**
 * Issue #3951 — `.github/workflows/markdown-lint.yml` installed
 * `markdownlint-cli2` from a bare `run:` step with no version, so the job
 * resolved whatever the npm registry served at that moment. A hijacked release
 * would execute on the runner — with the workflow `GITHUB_TOKEN` in scope — the
 * instant it was published, with no embargo.
 *
 * Neither existing quarantine covered it: Renovate's `minimumReleaseAge` and
 * Deno's `minimumDependencyAge` only govern manifests their managers can read,
 * and a `run:` block is not a manifest, while the `uses:` SHA-pinning gate never
 * inspects `run:`. Pinning the install to an exact version plus a Renovate
 * `customManagers` regex entry puts the install back inside the 24 h window.
 *
 * These are "what" tests: they parse the committed workflow and Renovate config
 * and assert on the resulting configuration — including that the Renovate regex
 * really does match the committed install line — not on how either is written.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOW_REPO_PATH = ".github/workflows/markdown-lint.yml";
const WORKFLOW = join(REPO_ROOT, WORKFLOW_REPO_PATH);
const RENOVATE_JSON = join(REPO_ROOT, "renovate.json");

/** One package installed by a global `npm install` inside a `run:` step. */
export interface GlobalNpmInstall {
  /** Package name, including any `@scope/` prefix. */
  name: string;
  /** The `@version` requested, or null when the spec floats. */
  version: string | null;
  /** 1-based line number of the `run:` line. */
  line: number;
}

const INSTALL_LINE =
  /npm\s+(?:install|i|add)\s+.*?(?:-g|--global)\b(?<rest>.*)/;
const SPEC = /^(?<name>@[^@/\s]+\/[^@\s]+|[^@\s]+)(?:@(?<version>\S+))?$/;

/**
 * Find every package a workflow installs globally with npm from a `run:` step.
 *
 * Flags are skipped, scoped names keep their `@scope/` prefix, and a spec with
 * no `@version` suffix is reported with `version: null`.
 */
export function findGlobalNpmInstalls(source: string): GlobalNpmInstall[] {
  const installs: GlobalNpmInstall[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = INSTALL_LINE.exec(lines[i].split("#")[0]);
    if (!match?.groups) continue;
    for (const token of match.groups.rest.trim().split(/\s+/)) {
      if (token === "" || token.startsWith("-")) continue;
      const spec = SPEC.exec(token);
      if (!spec?.groups) continue;
      installs.push({
        name: spec.groups.name,
        version: spec.groups.version ?? null,
        line: i + 1,
      });
    }
  }
  return installs;
}

/** True when `version` is a single exact release, not a range or tag. */
export function isExactVersion(version: string | null): boolean {
  return version !== null &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

/**
 * True when a Renovate `managerFilePatterns` entry selects `path`.
 *
 * Renovate accepts both a `/regex/` form and a glob; support both so the test
 * does not dictate which one the config uses.
 */
export function matchesManagerFilePattern(
  pattern: string,
  path: string,
): boolean {
  if (pattern.length > 1 && pattern.startsWith("/") && pattern.endsWith("/")) {
    return new RegExp(pattern.slice(1, -1)).test(path);
  }
  const body = pattern
    .split(/(\*\*|\*)/)
    .map((part) =>
      part === "**"
        ? ".*"
        : part === "*"
        ? "[^/]*"
        : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("");
  return new RegExp(`^${body}$`).test(path);
}

interface CustomManager {
  customType?: string;
  managerFilePatterns?: string[];
  fileMatch?: string[];
  matchStrings?: string[];
  datasourceTemplate?: string;
}

interface RenovateConfig {
  customManagers?: CustomManager[];
}

const readWorkflow = () => Deno.readTextFile(WORKFLOW);

async function readRenovate(): Promise<RenovateConfig> {
  return JSON.parse(await Deno.readTextFile(RENOVATE_JSON)) as RenovateConfig;
}

Deno.test("findGlobalNpmInstalls reads a pinned package and its line", () => {
  const source = [
    "      - name: Install markdownlint-cli2",
    "        run: npm install -g markdownlint-cli2@0.23.2",
    "",
  ].join("\n");
  assertEquals(findGlobalNpmInstalls(source), [
    { name: "markdownlint-cli2", version: "0.23.2", line: 2 },
  ]);
});

Deno.test("findGlobalNpmInstalls reports a floating spec as null", () => {
  const installs = findGlobalNpmInstalls(
    "        run: npm install -g pa11y-ci",
  );
  assertEquals(installs, [{ name: "pa11y-ci", version: null, line: 1 }]);
});

Deno.test("findGlobalNpmInstalls keeps the scope of a scoped package", () => {
  const installs = findGlobalNpmInstalls(
    "        run: npm i --global @scope/tool@1.2.3",
  );
  assertEquals(installs, [{ name: "@scope/tool", version: "1.2.3", line: 1 }]);
});

Deno.test("findGlobalNpmInstalls skips flags and reads every package", () => {
  const installs = findGlobalNpmInstalls(
    "        run: npm install -g --ignore-scripts a@1.0.0 b@2.0.0",
  );
  assertEquals(installs.map((i) => i.name), ["a", "b"]);
  assertEquals(installs.map((i) => i.version), ["1.0.0", "2.0.0"]);
});

Deno.test("findGlobalNpmInstalls ignores local installs and comments", () => {
  const source = [
    "        run: npm ci",
    "        run: npm install markdownlint-cli2",
    "        # run: npm install -g markdownlint-cli2",
  ].join("\n");
  assertEquals(findGlobalNpmInstalls(source), []);
});

Deno.test("isExactVersion accepts exact releases and rejects ranges and tags", () => {
  assertEquals(isExactVersion("0.23.2"), true);
  assertEquals(isExactVersion("1.0.0-rc.1"), true);
  assertEquals(isExactVersion("^0.23.2"), false);
  assertEquals(isExactVersion("0.23"), false);
  assertEquals(isExactVersion("latest"), false);
  assertEquals(isExactVersion(null), false);
});

Deno.test("matchesManagerFilePattern handles the regex and glob forms", () => {
  const path = ".github/workflows/markdown-lint.yml";
  assertEquals(
    matchesManagerFilePattern("/^\\.github/workflows/.+\\.ya?ml$/", path),
    true,
  );
  assertEquals(
    matchesManagerFilePattern(".github/workflows/**.yml", path),
    true,
  );
  assertEquals(matchesManagerFilePattern("/^deno\\.json$/", path), false);
  assertEquals(matchesManagerFilePattern("src/**", path), false);
});

Deno.test(
  "markdown-lint.yml pins every global npm install to an exact version (Issue #3951)",
  async () => {
    const installs = findGlobalNpmInstalls(await readWorkflow());
    assert(
      installs.length > 0,
      `${WORKFLOW_REPO_PATH} must install markdownlint-cli2 to run the lint`,
    );
    for (const install of installs) {
      assert(
        isExactVersion(install.version),
        `${WORKFLOW_REPO_PATH}:${install.line} installs '${install.name}' at ` +
          `'${
            install.version ?? "<floating>"
          }' — a run: step is not a manifest, ` +
          "so no quarantine covers it and a hijacked release executes on the " +
          "runner the moment it is published. Pin an exact version.",
      );
    }
  },
);

Deno.test(
  "renovate.json keeps the workflow's npm install pin current (Issue #3951)",
  async () => {
    const installs = findGlobalNpmInstalls(await readWorkflow());
    const managers = (await readRenovate()).customManagers ?? [];
    const applicable = managers.filter((manager) =>
      manager.customType === "regex" &&
      manager.datasourceTemplate === "npm" &&
      (manager.managerFilePatterns ?? manager.fileMatch ?? []).some((pattern) =>
        matchesManagerFilePattern(pattern, WORKFLOW_REPO_PATH)
      )
    );
    assert(
      applicable.length > 0,
      "renovate.json must carry a customManagers regex entry with the npm " +
        `datasource covering ${WORKFLOW_REPO_PATH}, otherwise the exact pin ` +
        "goes stale and never picks up upstream security fixes",
    );

    const source = await readWorkflow();
    for (const install of installs) {
      const matched = applicable.some((manager) =>
        (manager.matchStrings ?? []).some((matchString) => {
          const found = new RegExp(matchString).exec(source);
          return found?.groups?.depName === install.name &&
            found.groups.currentValue === install.version;
        })
      );
      assert(
        matched,
        `no renovate.json customManagers matchString extracts depName ` +
          `'${install.name}' and currentValue '${install.version}' from ` +
          `${WORKFLOW_REPO_PATH}:${install.line} — the pin would never be bumped`,
      );
    }
  },
);
