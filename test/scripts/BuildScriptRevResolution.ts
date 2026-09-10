import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { existsSync } from "@std/fs";
import { runSourcedFns } from "./_buildShHarness.ts";

/**
 * Issue #3990 — `build.sh` resolved the upstream revision with `gh api`
 * alone. `gh` needs an authenticated session even for a public repository, so
 * every unattended dependency-bump run aborted with "Could not resolve commit
 * SHA", the bump was reverted, and dependency updates stopped reaching PRs.
 *
 * These tests drive the real `resolve_upstream_rev()` out of `build.sh` with
 * stub `gh` / `git` / `curl` binaries on PATH, so each strategy and the
 * fail-loud path are exercised without touching the network.
 */

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "89abcdef0123456789abcdef0123456789abcdef";

/** A stub binary: the shell body it runs when invoked. */
type Stubs = Record<string, string>;

/**
 * Real utilities the resolver shells out to. They are symlinked into the stub
 * directory so PATH can be reduced to that directory alone — which is how the
 * "tool is not on PATH" branches are reached for gh / git / curl.
 */
const REQUIRED_TOOLS = [
  "awk",
  "sed",
  "grep",
  "head",
  "mktemp",
  "rm",
  "printf",
  "timeout",
];

/** Tools whose absence the resolver tolerates (builtin, or macOS-only names). */
const OPTIONAL_TOOLS = ["printf", "timeout"];

/**
 * Create a temp directory of stub executables and return its path.
 *
 * Real `awk` and `sed` are symlinked in alongside the stubs so the resolver's
 * text handling still works when PATH is reduced to the stub directory.
 */
function makeStubBin(stubs: Stubs): string {
  // Synchronous throughout: the writes are tiny and a loop of awaits would
  // serialise anyway.
  const dir = Deno.makeTempDirSync({ prefix: "neat-rev-stub-" });
  for (const [name, body] of Object.entries(stubs)) {
    const path = `${dir}/${name}`;
    Deno.writeTextFileSync(path, `#!/bin/sh\n${body}\n`);
    Deno.chmodSync(path, 0o755);
  }
  for (const tool of REQUIRED_TOOLS) {
    if (Object.hasOwn(stubs, tool)) continue;
    const real = ["/usr/bin", "/bin"]
      .map((binDir) => `${binDir}/${tool}`)
      .find((candidate) => existsSync(candidate));
    if (real === undefined) {
      if (OPTIONAL_TOOLS.includes(tool)) continue;
      // Say which tool is missing rather than letting the resolver fail later
      // as a confusing "no SHA returned".
      throw new Error(`${tool} is required to drive resolve_upstream_rev`);
    }
    Deno.symlinkSync(real, `${dir}/${tool}`);
  }
  return dir;
}

/**
 * Run `resolve_upstream_rev` from build.sh against the given stub binaries.
 *
 * PATH is reduced to the stub directory, so a tool with no stub is genuinely
 * absent — that is how the "not on PATH" branches are reached.
 */
async function runResolve(
  stubs: Stubs,
  { ref = "Develop", env = "" }: { ref?: string; env?: string } = {},
) {
  const dir = makeStubBin(stubs);
  try {
    return await runSourcedFns(
      ["resolve_upstream_rev"],
      `PATH='${dir}' ${env} resolve_upstream_rev 'stSoftwareAU/NEAT-AI-core' '${ref}'`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** A `gh` stub that behaves like an unauthenticated session. */
const GH_UNAUTHENTICATED =
  'echo "gh: To use GitHub CLI in an automated environment, set the GH_TOKEN environment variable." >&2\nexit 4';

Deno.test({
  name:
    "resolve_upstream_rev falls back to git ls-remote when gh has no session (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: `echo "${HEAD_SHA}\trefs/heads/Develop"`,
    });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(result.stdout.trim(), HEAD_SHA);
    assertStringIncludes(result.stderr, "git ls-remote");
  },
});

Deno.test({
  name: "resolve_upstream_rev prefers gh when it is authenticated (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: `echo "${HEAD_SHA}"`,
      git: `echo "${OTHER_SHA}\trefs/heads/Develop"`,
    });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(
      result.stdout.trim(),
      HEAD_SHA,
      "gh is the only strategy that can read a private repo, so it wins",
    );
  },
});

Deno.test({
  name: "resolve_upstream_rev peels an annotated tag to its commit SHA (#3990)",
  fn: async () => {
    // ls-remote lists the tag object before its peeled commit; the commit is
    // the revision the bundle is published against.
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git:
        `echo "${OTHER_SHA}\trefs/tags/v1.2.3"\necho "${HEAD_SHA}\trefs/tags/v1.2.3^{}"`,
    }, { ref: "v1.2.3" });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(result.stdout.trim(), HEAD_SHA);
  },
});

Deno.test({
  name: "resolve_upstream_rev falls back to the REST API over curl (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: "exit 128",
      curl:
        `echo '{'\necho '  "sha": "${HEAD_SHA}",'\necho '  "commit": { "tree": { "sha": "${OTHER_SHA}" } }'\necho '}'`,
    });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(
      result.stdout.trim(),
      HEAD_SHA,
      "the commit SHA is the first sha in the response, not the tree sha",
    );
  },
});

Deno.test({
  name:
    "resolve_upstream_rev sends the token to curl when one is exported (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: "exit 128",
      // Only answer when the Authorization header carries the token.
      curl:
        `case "$*" in\n  *"Bearer test-token"*) echo '{ "sha": "${HEAD_SHA}" }' ;;\n  *) exit 22 ;;\nesac`,
    }, { env: "GITHUB_TOKEN=test-token" });
    assertEquals(result.code, 0, `stderr=${result.stderr}`);
    assertEquals(result.stdout.trim(), HEAD_SHA);
  },
});

Deno.test({
  name:
    "resolve_upstream_rev fails loud and names every strategy it tried (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: "exit 128",
      curl: "exit 22",
    });
    assert(result.code !== 0, "an unresolvable ref must not return success");
    assertEquals(result.stdout.trim(), "", "no SHA may be printed on failure");
    assertStringIncludes(result.stderr, "Could not resolve commit SHA");
    assertStringIncludes(result.stderr, "gh api");
    assertStringIncludes(result.stderr, "git ls-remote");
    assertStringIncludes(result.stderr, "curl");
  },
});

Deno.test({
  name:
    "resolve_upstream_rev reports the tools that are absent from PATH (#3990)",
  fn: async () => {
    // No stubs at all: every strategy's binary is missing.
    const result = await runResolve({});
    assert(result.code !== 0, "no resolver available means no success");
    assertStringIncludes(result.stderr, "not on PATH");
  },
});

Deno.test({
  name:
    "resolve_upstream_rev separates a missing ref from an unreachable upstream (#3990)",
  fn: async () => {
    // `git ls-remote` exiting 0 with no rows means the remote answered and
    // has no such ref — a stale neatCore.ref, which must not be downgraded to
    // "nothing to bump".
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: "exit 0",
      curl: "exit 22",
    }, { ref: "NoSuchBranch" });
    assertEquals(
      result.code,
      2,
      `a missing ref must report the configuration-error code; stderr=${result.stderr}`,
    );
    assertStringIncludes(result.stderr, "no ref named 'NoSuchBranch'");
  },
});

Deno.test({
  name:
    "resolve_upstream_rev reports an unreachable upstream as the transient code (#3990)",
  fn: async () => {
    // Every strategy errored out without ever being told the ref is absent.
    const result = await runResolve({
      gh: GH_UNAUTHENTICATED,
      git: "exit 128",
      curl: "exit 6",
    });
    assertEquals(
      result.code,
      1,
      `an outage must not be reported as a configuration error; stderr=${result.stderr}`,
    );
  },
});

Deno.test({
  name:
    "resolve_upstream_rev fails loud on a non-numeric lookup timeout (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: `echo "${HEAD_SHA}"`,
    }, { env: "NEAT_CORE_REV_LOOKUP_TIMEOUT_SECONDS=soon" });
    assertEquals(result.code, 2, "a misconfigured timeout is not an outage");
    assertStringIncludes(
      result.stderr,
      "NEAT_CORE_REV_LOOKUP_TIMEOUT_SECONDS",
    );
    assertEquals(result.stdout.trim(), "");
  },
});

Deno.test({
  name:
    "resolve_upstream_rev rejects a malformed SHA rather than passing it on (#3990)",
  fn: async () => {
    const result = await runResolve({
      gh: 'echo "not-a-sha"',
      git: 'echo "zzzz\trefs/heads/Develop"',
      curl: "exit 22",
    });
    assert(result.code !== 0, "a malformed SHA must not be accepted");
    assertEquals(result.stdout.trim(), "");
  },
});
