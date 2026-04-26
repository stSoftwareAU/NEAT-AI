import { assert } from "@std/assert";

/**
 * Tests that .github/workflows/publish.yml conforms to the CI policy
 * documented in docs/CORE_DEPENDENCY_POLICY.md.
 *
 * Issue #2439 — the publish workflow was failing with
 *   "ERROR: Could not resolve commit SHA for stSoftwareAU/NEAT-AI-core@Develop"
 * because it ran `./build.sh` (no flags) which tries to resolve Develop
 * HEAD via `gh api`. The default GITHUB_TOKEN in this repo cannot read
 * commits in the NEAT-AI-core repo, so resolution fails. CI policy says
 * "CI MUST NOT advance deno.json neatCore.rev automatically" — bumps are
 * an explicit human/worker action. The publish workflow must therefore
 * call `./build.sh --verify-only`, matching quality.yml.
 */

const PUBLISH_WORKFLOW = ".github/workflows/publish.yml";

Deno.test("publish.yml runs build.sh in verify-only mode", async () => {
  const content = await Deno.readTextFile(PUBLISH_WORKFLOW);
  assert(
    content.includes("./build.sh --verify-only"),
    `${PUBLISH_WORKFLOW} must invoke ./build.sh --verify-only so CI does not ` +
      `try to resolve NEAT-AI-core HEAD via gh (issue #2439).`,
  );
});

Deno.test("publish.yml does not auto-advance neatCore.rev", async () => {
  const content = await Deno.readTextFile(PUBLISH_WORKFLOW);
  // No bare `./build.sh` invocation (must always carry --verify-only or
  // an explicit --rev flag). Whitespace-tolerant: any character class
  // after build.sh other than a flag would catch a regression.
  const bareInvocation = /\.\/build\.sh(?:\s*$|\s+(?!--))/m;
  assert(
    !bareInvocation.test(content),
    `${PUBLISH_WORKFLOW} must not call ./build.sh without --verify-only ` +
      `(issue #2439, docs/CORE_DEPENDENCY_POLICY.md).`,
  );
});
