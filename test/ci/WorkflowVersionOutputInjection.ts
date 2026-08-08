/**
 * Issue #3684 — the workflow steps that read `deno.json`'s `version` and echo
 * it into `$GITHUB_OUTPUT` must validate the value first.
 *
 * `$GITHUB_OUTPUT` is a line-oriented `key=value` file. `deno.json` sits
 * outside the CODEOWNERS gate (Issue #3669), so a merged commit can put a
 * newline into `version`, and an unvalidated `echo "version=$VERSION"` then
 * injects arbitrary extra step outputs. In `github-release.yml` those outputs
 * feed `tag_name`/`name` of the release in a job holding `contents: write`.
 *
 * These tests execute the committed run blocks themselves under `bash`, with a
 * crafted `deno.json` and a throwaway `$GITHUB_OUTPUT`, and assert on the exit
 * code and on the bytes the step actually wrote. Deleting or weakening the
 * guard turns them red.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { parse } from "@std/yaml";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const RELEASE_WORKFLOW = ".github/workflows/github-release.yml";
const VERSION_BUMP_WORKFLOW = ".github/workflows/update-package-version.yml";

interface Step {
  id?: string;
  run?: string;
}

interface Job {
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

/** The `run:` script of the step with the given `id`, as committed. */
async function stepRunBlock(relPath: string, stepId: string): Promise<string> {
  const wf = parse(
    await Deno.readTextFile(join(REPO_ROOT, relPath)),
  ) as Workflow;
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (step.id !== stepId) continue;
      assert(
        typeof step.run === "string",
        `${relPath} step "${stepId}" has no run: block`,
      );
      return step.run;
    }
  }
  throw new Error(`${relPath} has no step with id "${stepId}"`);
}

interface StepResult {
  code: number;
  stderr: string;
  /** Raw contents of the step's `$GITHUB_OUTPUT` file. */
  outputs: string;
}

/** Run a workflow shell block in `cwd` with a scratch `$GITHUB_OUTPUT`. */
async function runStep(
  run: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<StepResult> {
  const outputPath = join(cwd, "github_output");
  await Deno.writeTextFile(outputPath, "");
  const { code, stderr } = await new Deno.Command("bash", {
    args: ["-c", run],
    cwd,
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
      HOME: cwd,
      GITHUB_OUTPUT: outputPath,
      ...env,
    },
    stdout: "null",
    stderr: "piped",
  }).output();
  return {
    code,
    stderr: new TextDecoder().decode(stderr),
    outputs: await Deno.readTextFile(outputPath),
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "issue3684-" });
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Run `github-release.yml`'s version step against a crafted `deno.json`. */
async function runReleaseVersionStep(
  denoJson: Record<string, unknown>,
  inspect: (result: StepResult, cwd: string) => Promise<void> | void,
): Promise<void> {
  const run = await stepRunBlock(RELEASE_WORKFLOW, "version");
  await withTempDir(async (cwd) => {
    await Deno.writeTextFile(
      join(cwd, "deno.json"),
      JSON.stringify(denoJson),
    );
    await inspect(await runStep(run, cwd), cwd);
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test(
  "github-release version step emits the repository's real version (Issue #3684)",
  async () => {
    const repoVersion = JSON.parse(
      await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
    ).version;
    await runReleaseVersionStep({ version: repoVersion }, (result) => {
      assertEquals(result.code, 0, result.stderr);
      assertEquals(result.outputs, `version=${repoVersion}\n`);
    });
  },
);

for (const version of ["1.2.3", "0.0.0", "10.20.30-rc.1", "1.2.3+build.5"]) {
  Deno.test(
    `github-release version step accepts semver "${version}" (Issue #3684)`,
    async () => {
      await runReleaseVersionStep({ version }, (result) => {
        assertEquals(result.code, 0, result.stderr);
        assertEquals(result.outputs, `version=${version}\n`);
      });
    },
  );
}

Deno.test(
  "github-release version step refuses a newline-injected version (Issue #3684)",
  async () => {
    await runReleaseVersionStep(
      { version: "1.2.3\nevil=pwned" },
      (result) => {
        assert(
          result.code !== 0,
          "a version containing a newline must fail the step",
        );
        assertEquals(
          result.outputs,
          "",
          "no step output may be written for a rejected version",
        );
        assertStringIncludes(result.stderr, "::error::");
      },
    );
  },
);

Deno.test(
  "github-release version step refuses shell-significant characters (Issue #3684)",
  async () => {
    await runReleaseVersionStep(
      { version: "1.2.3; touch pwned" },
      async (result, cwd) => {
        assert(result.code !== 0, "a version with `;` must fail the step");
        assertEquals(result.outputs, "");
        assertEquals(
          await exists(join(cwd, "pwned")),
          false,
          "the rejected version must not reach a shell as code",
        );
      },
    );
  },
);

Deno.test(
  "github-release version step refuses a command substitution (Issue #3684)",
  async () => {
    await runReleaseVersionStep(
      { version: "$(touch pwned)" },
      async (result, cwd) => {
        assert(result.code !== 0, "a `$(...)` version must fail the step");
        assertEquals(result.outputs, "");
        assertEquals(await exists(join(cwd, "pwned")), false);
      },
    );
  },
);

for (
  const [label, denoJson] of [
    ["an absent version field", {}],
    ["an empty version", { version: "" }],
    ["a non-semver version", { version: "latest" }],
    ["a two-part version", { version: "1.2" }],
  ] as const
) {
  Deno.test(
    `github-release version step refuses ${label} (Issue #3684)`,
    async () => {
      await runReleaseVersionStep(denoJson, (result) => {
        assert(result.code !== 0, `${label} must fail the step`);
        assertEquals(result.outputs, "");
      });
    },
  );
}

/**
 * `update-package-version.yml`'s `check_version` step derives `BASE_VERSION`
 * from the base branch's `deno.json` and echoes it into `$GITHUB_OUTPUT` the
 * same way, so it carries the same injection. The step shells out to `git` and
 * `deno`; both are stubbed on `PATH` so the test drives the two version values
 * directly.
 */
async function runCheckVersionStep(
  baseVersion: string,
  currentVersion: string,
): Promise<StepResult> {
  const run = await stepRunBlock(VERSION_BUMP_WORKFLOW, "check_version");
  return await withTempDir(async (cwd) => {
    const bin = join(cwd, "bin");
    await Deno.mkdir(bin);
    await Deno.writeTextFile(
      join(bin, "git"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    // The step runs `deno eval` twice: once for the base version (a script
    // naming /tmp/base_deno.json) and once for the current version.
    await Deno.writeTextFile(
      join(bin, "deno"),
      "#!/usr/bin/env bash\n" +
        'if [[ "$*" == */tmp/base_deno.json* ]]; then\n' +
        '  printf "%s\\n" "$STUB_BASE_VERSION"\n' +
        "else\n" +
        '  printf "%s\\n" "$STUB_CURRENT_VERSION"\n' +
        "fi\n",
    );
    await Deno.chmod(join(bin, "git"), 0o755);
    await Deno.chmod(join(bin, "deno"), 0o755);
    return await runStep(run, cwd, {
      PATH: `${bin}:${Deno.env.get("PATH") ?? "/usr/bin:/bin"}`,
      BASE_REF: "Develop",
      STUB_BASE_VERSION: baseVersion,
      STUB_CURRENT_VERSION: currentVersion,
    });
  });
}

Deno.test(
  "update-package-version emits base_version for an unchanged semver (Issue #3684)",
  async () => {
    const result = await runCheckVersionStep("1.2.3", "1.2.3");
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.outputs, "needs_update=true\nbase_version=1.2.3\n");
  },
);

Deno.test(
  "update-package-version refuses a newline-injected base version (Issue #3684)",
  async () => {
    const result = await runCheckVersionStep(
      "1.2.3\nevil=pwned",
      "1.2.3\nevil=pwned",
    );
    assert(result.code !== 0, "an injected base version must fail the step");
    assertEquals(
      result.outputs,
      "",
      "no step output may be written for a rejected base version",
    );
    assertStringIncludes(result.stderr, "::error::");
  },
);

Deno.test(
  "update-package-version still skips when the base version is unknown (Issue #3684)",
  async () => {
    const result = await runCheckVersionStep("", "1.2.3");
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.outputs, "needs_update=false\n");
  },
);

Deno.test(
  "update-package-version still skips when the PR already bumped the version (Issue #3684)",
  async () => {
    const result = await runCheckVersionStep("1.2.3", "1.2.4");
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.outputs, "needs_update=false\n");
  },
);
