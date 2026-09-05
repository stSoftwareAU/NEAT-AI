/**
 * Issue #2743 — every `container.image:` reference in
 * `.github/workflows/*.y*ml` must pin to an immutable `@sha256:<digest>`
 * rather than a moving tag such as `:latest`, `:v1`, or a bare image name.
 *
 * Container images are at least as supply-chain-sensitive as actions:
 * `.github/workflows/semgrep.yml` runs the SAST job inside `image:
 * semgrep/semgrep` while injecting `SEMGREP_APP_TOKEN`. A compromised
 * push to the upstream tag would execute attacker code with that secret in
 * scope. SHA-pinning the image closes the same gap that 40-char SHAs close
 * for `uses:` references.
 *
 * This test scans every workflow file and asserts that any `container:`
 * block (either `container: image: foo` shorthand or the long
 * `container:\n  image: foo` form) is pinned to a `sha256:` digest.
 *
 * Issue #3960 — a digest alone is immutable but *untrackable*. Renovate's
 * `github-actions` manager and Dependabot's `docker` ecosystem both resolve a
 * bump from the tag and then rewrite the digest beside it, so a bare
 * `name@sha256:<digest>` pin is frozen forever: new rule packs and CVE fixes
 * never reach the scan. Every digest-pinned container image must therefore
 * carry an explicit release tag as well — `name:<X.Y.Z>@sha256:<digest>` — which
 * keeps the image byte-for-byte immutable while letting the updater raise bump
 * PRs through the existing 24 h quarantine.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

interface ImageRef {
  workflow: string;
  image: string;
  line: number;
}

/**
 * Extract every container `image:` reference from a workflow source.
 *
 * Matches both the `container: image: foo` shorthand and the long
 * `container:\n  image: foo` form. Also picks up `services.*.image:`
 * which is the same supply-chain surface.
 */
export function extractContainerImages(source: string): ImageRef[] {
  const out: ImageRef[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip trailing comments before matching.
    const code = line.replace(/#.*$/, "");

    // Long form: `image: name` (under `container:` or `services.x:`).
    const longMatch = code.match(/^\s*image:\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (longMatch) {
      out.push({ workflow: "", image: longMatch[1], line: i + 1 });
      continue;
    }

    // Shorthand: `container: name` (no nested image: key).
    const shortMatch = code.match(
      /^\s*container:\s*['"]?([^'"\s{][^'"\s]*)['"]?\s*$/,
    );
    if (shortMatch) {
      out.push({ workflow: "", image: shortMatch[1], line: i + 1 });
    }
  }
  return out;
}

/** The three components of an OCI image reference. */
export interface ParsedImage {
  /** Everything before the tag and digest, registry host included. */
  name: string;
  /** The `:<tag>` component, or null when the reference carries none. */
  tag: string | null;
  /** The `@sha256:<digest>` component, or null when unpinned. */
  digest: string | null;
}

/** A tag a version updater can resolve a bump from: `1.163.0`, `v2`, `3.1.0-rc1`. */
const RELEASE_TAG = /^v?\d+(?:\.\d+)*(?:[.-][0-9A-Za-z.-]+)?$/;

/**
 * Split an image reference into name, tag, and digest.
 *
 * The tag is the last `:` inside the final path segment, so a registry host
 * carrying a port (`registry.local:5000/app`) is not mistaken for a tag.
 */
export function parseImageRef(image: string): ParsedImage {
  const at = image.indexOf("@");
  const digest = at === -1 ? null : image.slice(at + 1);
  const rest = at === -1 ? image : image.slice(0, at);

  const lastSlash = rest.lastIndexOf("/");
  const colon = rest.indexOf(":", lastSlash + 1);
  if (colon === -1) return { name: rest, tag: null, digest };
  return { name: rest.slice(0, colon), tag: rest.slice(colon + 1), digest };
}

/**
 * Whether a tag is one an updater can resolve a version bump from.
 *
 * Moving tags (`latest`, `stable`, `edge`) resolve to a different image over
 * time, so they are no more trackable than no tag at all.
 */
export function isTrackableTag(tag: string | null): boolean {
  if (tag === null || tag === "") return false;
  return RELEASE_TAG.test(tag);
}

async function listWorkflowFiles(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile) continue;
    if (!/\.ya?ml$/.test(entry.name)) continue;
    names.push(entry.name);
  }
  names.sort();
  return names;
}

async function readAllWorkflows(): Promise<
  { name: string; source: string }[]
> {
  const files = await listWorkflowFiles();
  const reads = files.map(async (name) => ({
    name,
    source: await Deno.readTextFile(join(WORKFLOWS_DIR, name)),
  }));
  return await Promise.all(reads);
}

Deno.test("extractContainerImages parses the long `container:\\n  image:` form", () => {
  const src = [
    "jobs:",
    "  semgrep:",
    "    container:",
    "      image: semgrep/semgrep@sha256:abc",
  ].join("\n");
  const refs = extractContainerImages(src);
  assert(refs.length === 1, `expected 1 image ref, got ${refs.length}`);
  assert(refs[0].image === "semgrep/semgrep@sha256:abc");
  assert(refs[0].line === 4);
});

Deno.test("extractContainerImages parses the `container: name` shorthand", () => {
  const src = "    container: alpine:3.20\n";
  const refs = extractContainerImages(src);
  assert(refs.length === 1);
  assert(refs[0].image === "alpine:3.20");
});

Deno.test("extractContainerImages parses `services.x.image:` references", () => {
  const src = [
    "    services:",
    "      postgres:",
    "        image: postgres@sha256:deadbeef",
  ].join("\n");
  const refs = extractContainerImages(src);
  assert(refs.length === 1);
  assert(refs[0].image === "postgres@sha256:deadbeef");
});

Deno.test("extractContainerImages ignores `container:` mapping headers without inline image", () => {
  const src = [
    "    container:",
    "      image: foo@sha256:abc",
    "      env:",
    "        FOO: bar",
  ].join("\n");
  const refs = extractContainerImages(src);
  // Only the image: line should be captured, not the `container:` mapping
  // header (which is followed by a child key, not a value).
  assert(refs.length === 1, `expected 1 ref, got ${refs.length}`);
  assert(refs[0].image === "foo@sha256:abc");
});

Deno.test(
  "every workflow `container.image:` is pinned to a sha256 digest (Issue #2743)",
  async () => {
    const workflows = await readAllWorkflows();
    assert(workflows.length > 0, "expected at least one workflow file");
    for (const { name, source } of workflows) {
      const refs = extractContainerImages(source);
      for (const r of refs) {
        assertMatch(
          r.image,
          /@sha256:[0-9a-f]{64}$/,
          `${name}: container image '${r.image}' on line ${r.line} must be pinned to '@sha256:<64-hex>' to prevent supply-chain attacks on the runner secrets`,
        );
      }
    }
  },
);

Deno.test("parseImageRef splits name, tag, and digest", () => {
  assertEquals(parseImageRef("semgrep/semgrep:1.163.0@sha256:abc"), {
    name: "semgrep/semgrep",
    tag: "1.163.0",
    digest: "sha256:abc",
  });
});

Deno.test("parseImageRef reports a missing tag as null", () => {
  assertEquals(parseImageRef("semgrep/semgrep@sha256:abc"), {
    name: "semgrep/semgrep",
    tag: null,
    digest: "sha256:abc",
  });
});

Deno.test("parseImageRef reports a missing digest as null", () => {
  assertEquals(parseImageRef("alpine:3.20"), {
    name: "alpine",
    tag: "3.20",
    digest: null,
  });
});

Deno.test("parseImageRef does not mistake a registry port for a tag", () => {
  assertEquals(parseImageRef("registry.local:5000/app@sha256:abc"), {
    name: "registry.local:5000/app",
    tag: null,
    digest: "sha256:abc",
  });
  assertEquals(parseImageRef("registry.local:5000/app:2.1.0"), {
    name: "registry.local:5000/app",
    tag: "2.1.0",
    digest: null,
  });
});

Deno.test("isTrackableTag accepts release tags and rejects moving ones", () => {
  for (const tag of ["1.163.0", "v2", "3.1.0-rc1", "1.2"]) {
    assert(isTrackableTag(tag), `expected '${tag}' to be trackable`);
  }
  for (const tag of [null, "", "latest", "stable", "edge", "sha-abc123"]) {
    assert(!isTrackableTag(tag), `expected '${tag}' to be untrackable`);
  }
});

Deno.test(
  "every digest-pinned workflow container image also carries a release tag (Issue #3960)",
  async () => {
    const workflows = await readAllWorkflows();
    assert(workflows.length > 0, "expected at least one workflow file");
    for (const { name, source } of workflows) {
      for (const r of extractContainerImages(source)) {
        const { tag } = parseImageRef(r.image);
        assert(
          isTrackableTag(tag),
          `${name}: container image '${r.image}' on line ${r.line} pins a digest with no release tag, so Renovate and Dependabot cannot resolve a bump from it — use 'name:<X.Y.Z>@sha256:<digest>'`,
        );
      }
    }
  },
);

Deno.test(
  "semgrep.yml container image is pinned and trackable (Issues #2743, #3960)",
  async () => {
    const path = join(WORKFLOWS_DIR, "semgrep.yml");
    const source = await Deno.readTextFile(path);
    const refs = extractContainerImages(source);
    assert(
      refs.length >= 1,
      "expected at least one container image ref in semgrep.yml",
    );
    const semgrep = refs.find((r) => r.image.startsWith("semgrep/semgrep"));
    assert(semgrep, "expected a semgrep/semgrep container image ref");
    assertMatch(
      semgrep.image,
      /^semgrep\/semgrep:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
      `semgrep.yml image must pin semgrep/semgrep to an explicit release tag beside its sha256 digest, got '${semgrep.image}'`,
    );
  },
);
