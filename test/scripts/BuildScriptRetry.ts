import { assert, assertEquals } from "@std/assert";

/**
 * Tests build.sh release-not-found retry behaviour (Issue #2449).
 *
 * NEAT-AI-core's `wasm-bundle.yml` workflow takes ~30–60 s to publish
 * the per-commit Release after a Develop merge. NEAT-AI worker PRs that
 * land within that propagation window otherwise fail immediately. The
 * fix wraps the release probe with a bounded retry that fires only on
 * the "release not found" / 404 outcome — every other error fails fast.
 *
 * Each test runs in an isolated tmp dir with a copy of build.sh, a fake
 * `gh` shim on PATH that records invocations and returns canned
 * responses, and a tar.gz fixture built from the real wasm_activation
 * pkg so that on "successful" download the verification gate passes.
 */

const REPO_ROOT = Deno.cwd();
const FAKE_REV_A = "a".repeat(40);
const FAKE_REV_B = "b".repeat(40);
const UPSTREAM_MARKER = "BUILD_STATUS=upstream-unresolved";

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function buildFixtureTarball(workDir: string): Promise<string> {
  const fixturePath = `${workDir}/wasm_activation-pkg.tar.gz`;
  const cmd = new Deno.Command("tar", {
    args: ["-czf", fixturePath, "-C", `${REPO_ROOT}/wasm_activation`, "pkg"],
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  assertEquals(
    out.code,
    0,
    `tar fixture build failed: ${new TextDecoder().decode(out.stderr)}`,
  );
  return fixturePath;
}

async function sha256Of(path: string): Promise<string> {
  const cmd = new Deno.Command("shasum", {
    args: ["-a", "256", path],
    stdout: "piped",
  });
  const out = await cmd.output();
  return new TextDecoder().decode(out.stdout).trim().split(/\s+/)[0];
}

async function setupFakeRepo(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
  fakeBinDir: string;
  fixturePath: string;
  probeCounterFile: string;
  downloadCounterFile: string;
}> {
  const dir = await Deno.makeTempDir({ prefix: "neat-build-retry-" });
  // Copy build.sh into the fake repo so $SCRIPT_DIR cd's here.
  await Deno.copyFile(`${REPO_ROOT}/build.sh`, `${dir}/build.sh`);
  await Deno.chmod(`${dir}/build.sh`, 0o755);

  // Minimal deno.json — neatCore.rev intentionally differs from the
  // --rev override so the no-op fast path doesn't trigger.
  await Deno.writeTextFile(
    `${dir}/deno.json`,
    JSON.stringify({
      neatCore: {
        repo: "stSoftwareAU/NEAT-AI-core",
        ref: "Develop",
        rev: FAKE_REV_A,
        // Issue #3743: the fixture tarball is built from the real vendored
        // bundle, so the fake repo must declare the same model or build.sh's
        // address-size gate rejects it — which is exactly the point of the gate.
        memoryModel: "wasm64",
      },
      imports: {
        "@errors/": "./src/errors/",
        "@wasm/": "./src/wasm/",
      },
    }) + "\n",
  );

  // Issue #3743: build.sh's memory-model gate runs the repo's own TypeScript
  // decoder, so the fake repo needs that module graph. Copied rather than
  // symlinked so the temp-dir cleanup can never reach the real tree; a new
  // import in the decoder surfaces here as a loud "Module not found".
  await Deno.mkdir(`${dir}/src/wasm`, { recursive: true });
  await Deno.mkdir(`${dir}/src/errors`, { recursive: true });
  await Deno.mkdir(`${dir}/scripts`, { recursive: true });
  await Promise.all([
    "src/wasm/WasmMemoryModel.ts",
    "src/errors/WasmError.ts",
    "scripts/check_wasm_memory_model.ts",
  ].map((file) => Deno.copyFile(`${REPO_ROOT}/${file}`, `${dir}/${file}`)));

  // Empty pkg dir so verify_pkg_matches() returns failure.
  await Deno.mkdir(`${dir}/wasm_activation/pkg`, { recursive: true });

  const fakeBinDir = `${dir}/.fake-bin`;
  await Deno.mkdir(fakeBinDir, { recursive: true });

  const fixturePath = await buildFixtureTarball(dir);

  const probeCounterFile = `${dir}/probe-counter`;
  const downloadCounterFile = `${dir}/download-counter`;
  await Deno.writeTextFile(probeCounterFile, "0");
  await Deno.writeTextFile(downloadCounterFile, "0");

  const cleanup = async () => {
    await Deno.remove(dir, { recursive: true });
  };

  return {
    dir,
    cleanup,
    fakeBinDir,
    fixturePath,
    probeCounterFile,
    downloadCounterFile,
  };
}

async function writeFakeGh(
  fakeBinDir: string,
  opts: {
    probeCounterFile: string;
    downloadCounterFile: string;
    fixturePath: string;
    /** Number of probe calls that should 404 before success. */
    probeFailUntilSuccess?: number;
    /** If set, every probe fails with this stderr (non-404 fatal error). */
    probeFatalStderr?: string;
    /**
     * When set, a `--pattern *.sha256` download writes a real release
     * sidecar with this hash instead of silently missing the file — the
     * only way to anchor a revision advance without --allow-unverified
     * (issue #3515).
     */
    sidecarSha256?: string;
    /**
     * When true, `gh release download` of the tarball fails the way a
     * refused signed-asset host does (Issue #4120). The sidecar download is
     * unaffected: it is best-effort and build.sh never reaches it.
     */
    downloadFails?: boolean;
  },
): Promise<void> {
  const script = `#!/usr/bin/env bash
# Fake gh shim for build.sh retry tests (Issue #2449).
set -e

PROBE_COUNTER="${opts.probeCounterFile}"
DL_COUNTER="${opts.downloadCounterFile}"
FIXTURE="${opts.fixturePath}"
PROBE_FAIL_UNTIL_SUCCESS="${opts.probeFailUntilSuccess ?? 0}"
PROBE_FATAL_STDERR=${JSON.stringify(opts.probeFatalStderr ?? "")}
SIDECAR_SHA256=${JSON.stringify(opts.sidecarSha256 ?? "")}
DOWNLOAD_FAILS="${opts.downloadFails ? "true" : "false"}"

case "$1" in
  api)
    if [[ "$2" == repos/*/releases/tags/* ]]; then
      n=$(cat "$PROBE_COUNTER" 2>/dev/null || echo 0)
      n=$((n + 1))
      echo "$n" > "$PROBE_COUNTER"
      if [[ -n "$PROBE_FATAL_STDERR" ]]; then
        printf '%s\\n' "$PROBE_FATAL_STDERR" >&2
        exit 1
      fi
      if [[ "$n" -le "$PROBE_FAIL_UNTIL_SUCCESS" ]]; then
        echo "gh: Not Found (HTTP 404)" >&2
        exit 1
      fi
      exit 0
    fi
    echo "fake-gh: unsupported api call: $*" >&2
    exit 1
    ;;
  release)
    if [[ "$2" == "download" ]]; then
      d=$(cat "$DL_COUNTER" 2>/dev/null || echo 0)
      d=$((d + 1))
      echo "$d" > "$DL_COUNTER"
      asset_dir=""
      pattern=""
      shift 2
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --dir) asset_dir="$2"; shift 2 ;;
          --pattern) pattern="$2"; shift 2 ;;
          --repo) shift 2 ;;
          *) shift ;;
        esac
      done
      if [[ -z "$asset_dir" || ! -f "$FIXTURE" ]]; then
        echo "fake-gh: missing --dir or fixture" >&2
        exit 1
      fi
      if [[ "$pattern" == *.sha256 ]]; then
        if [[ -n "$SIDECAR_SHA256" ]]; then
          echo "$SIDECAR_SHA256  wasm_activation-pkg.tar.gz" > "$asset_dir/$pattern"
        fi
        # No SIDECAR_SHA256: report success but write nothing, simulating
        # no sidecar published — avoids the curl network fallback in
        # build.sh, which a sandboxed test must not exercise.
        exit 0
      fi
      if [[ "$DOWNLOAD_FAILS" == "true" ]]; then
        echo 'gh: Get "https://release-assets.githubusercontent.com/github-production-release-asset/fake": Forbidden' >&2
        exit 1
      fi
      cp "$FIXTURE" "$asset_dir/$pattern"
      exit 0
    fi
    ;;
esac
echo "fake-gh: unsupported call: $*" >&2
exit 1
`;
  const path = `${fakeBinDir}/gh`;
  await Deno.writeTextFile(path, script);
  await Deno.chmod(path, 0o755);
}

/** A simulated failed release-asset transfer (Issue #4120). */
interface FakeAssetFailure {
  /** curl's exit code, e.g. 56 for a refused CONNECT tunnel, 22 for an HTTP error under -f. */
  exitCode: number;
  /** The `%{http_code}` curl reports; "000" when no HTTP response arrived. */
  httpStatus: string;
  /** curl's own stderr line for the failure. */
  stderr: string;
}

/**
 * Write a fake `curl` into the shim directory (Issue #3990).
 *
 * Since `probe_release` falls through to curl when `gh` cannot answer, the
 * tests would otherwise reach the real GitHub API. The shim answers the
 * release probe with a canned HTTP status and refuses anything else.
 *
 * When `assetFailure` is given (Issue #4120), a request for a
 * `/releases/download/` URL fails the way curl would: it prints its stderr,
 * prints the http_code when `-w` was passed, writes no body to `-o`, and
 * exits with the configured code.
 *
 * @param probeStatus status the probe reports — "000" means curl itself
 *        could not answer, which is what an offline runner looks like.
 * @param assetFailure how the release-asset download fails; omitted means
 *        the asset URL is refused as an unsupported request.
 */
async function writeFakeCurl(
  fakeBinDir: string,
  probeStatus: string,
  assetFailure?: FakeAssetFailure,
): Promise<void> {
  const script = `#!/usr/bin/env bash
PROBE_STATUS=${JSON.stringify(probeStatus)}
ASSET_RC=${assetFailure?.exitCode ?? -1}
ASSET_HTTP_STATUS=${JSON.stringify(assetFailure?.httpStatus ?? "")}
ASSET_STDERR=${JSON.stringify(assetFailure?.stderr ?? "")}
for arg in "$@"; do
  case "$arg" in
    *releases/tags/*) printf '%s' "$PROBE_STATUS"; exit 0 ;;
  esac
done
if [[ "$ASSET_RC" -ge 0 ]]; then
  want_status=false
  for arg in "$@"; do
    case "$arg" in
      *releases/download/*)
        printf '%s\\n' "$ASSET_STDERR" >&2
        if [[ "$want_status" == true ]]; then printf '%s' "$ASSET_HTTP_STATUS"; fi
        exit "$ASSET_RC"
        ;;
    esac
    if [[ "$arg" == "-w" ]]; then want_status=true; fi
  done
fi
echo "fake-curl: unsupported request: $*" >&2
exit 1
`;
  const path = `${fakeBinDir}/curl`;
  await Deno.writeTextFile(path, script);
  await Deno.chmod(path, 0o755);
}

async function runBuild(
  cwd: string,
  args: string[],
  fakeBinDir: string,
  extraEnv: Record<string, string>,
): Promise<RunResult> {
  const path = `${fakeBinDir}:${Deno.env.get("PATH") ?? ""}`;
  const env: Record<string, string> = {
    PATH: path,
    HOME: Deno.env.get("HOME") ?? "",
    ...extraEnv,
  };
  const cmd = new Deno.Command("bash", {
    args: ["./build.sh", ...args],
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
  });
  const out = await cmd.output();
  return {
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
    code: out.code,
  };
}

Deno.test({
  name:
    "build.sh retries 404 release-not-found and succeeds when release appears",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const setup = await setupFakeRepo();
    try {
      // The fixture pins neatCore.rev to FAKE_REV_A while --rev targets
      // FAKE_REV_B, i.e. a revision advance. Since issue #3515 a revision
      // advance requires a real release-sidecar anchor — --allow-unverified
      // no longer suffices — so the fake release publishes a matching
      // .sha256 sidecar here. This test exercises the 404 retry path, not
      // the anchor requirement itself.
      const sidecarSha256 = await sha256Of(setup.fixturePath);
      await writeFakeGh(setup.fakeBinDir, {
        probeCounterFile: setup.probeCounterFile,
        downloadCounterFile: setup.downloadCounterFile,
        fixturePath: setup.fixturePath,
        probeFailUntilSuccess: 2,
        sidecarSha256,
      });
      const result = await runBuild(
        setup.dir,
        ["--rev", FAKE_REV_B],
        setup.fakeBinDir,
        {
          NEAT_CORE_BUNDLE_RETRIES: "5",
          NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS: "0",
        },
      );
      assertEquals(
        result.code,
        0,
        `Expected success after retries; stdout=${result.stdout}\nstderr=${result.stderr}`,
      );
      const probeCalls = parseInt(
        await Deno.readTextFile(setup.probeCounterFile),
        10,
      );
      assertEquals(
        probeCalls,
        3,
        `Expected 3 probe calls (2 x 404 then success); got ${probeCalls}`,
      );
      const downloadCalls = parseInt(
        await Deno.readTextFile(setup.downloadCounterFile),
        10,
      );
      // Two `gh release download` invocations are now expected after the
      // probe succeeds: one for the tarball and one for the optional
      // .sha256 sidecar (Issue #2705 supply-chain hardening). The sidecar
      // is fetched best-effort and skipped when absent.
      assertEquals(
        downloadCalls,
        2,
        `Expected tarball + sidecar downloads after probe success; got ${downloadCalls}`,
      );
      assert(
        result.stderr.includes("not yet published"),
        `Expected retry log line; stderr=${result.stderr}`,
      );
      // Confirm the bundle ended up in place.
      const stat = await Deno.stat(
        `${setup.dir}/wasm_activation/pkg/wasm_activation_bg.wasm`,
      );
      assert(stat.isFile, "wasm bundle should be extracted into pkg/");
    } finally {
      await setup.cleanup();
    }
  },
});

/**
 * Runs one case of the sidecar-less revision-advance guard (issue #3515):
 * the fixture pins neatCore.rev to FAKE_REV_A while --rev targets
 * FAKE_REV_B — a revision advance. deno.json neatCore.assetSha256 cannot
 * anchor a new revision (it only ever records the previous rev's hash),
 * and no release sidecar is published here, so the advance must hard-error
 * regardless of extraArgs — in particular --allow-unverified must not
 * bypass it.
 */
async function assertRevAdvanceBlocked(extraArgs: string[]): Promise<void> {
  const setup = await setupFakeRepo();
  try {
    await writeFakeGh(setup.fakeBinDir, {
      probeCounterFile: setup.probeCounterFile,
      downloadCounterFile: setup.downloadCounterFile,
      fixturePath: setup.fixturePath,
      probeFailUntilSuccess: 0,
    });
    const denoJsonBefore = await Deno.readTextFile(`${setup.dir}/deno.json`);
    const result = await runBuild(
      setup.dir,
      ["--rev", FAKE_REV_B, ...extraArgs],
      setup.fakeBinDir,
      {
        NEAT_CORE_BUNDLE_RETRIES: "5",
        NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS: "0",
      },
    );
    assert(
      result.code !== 0,
      `Expected non-zero exit on a sidecar-less revision advance (args=${
        JSON.stringify(extraArgs)
      }); stdout=${result.stdout}`,
    );
    assert(
      result.stderr.includes("revision advance") &&
        result.stderr.includes("wasm_activation-wasm64-pkg.tar.gz.sha256") &&
        result.stderr.includes(`wasm-bundle-${FAKE_REV_B}`) &&
        result.stderr.includes("--allow-unverified") &&
        result.stderr.includes("wasm-bundle.yml"),
      `Expected the actionable rev-advance error (sidecar name, tag, --allow-unverified note, workflow link); stderr=${result.stderr}`,
    );
    // The bundle must NOT have been extracted into pkg/.
    let extracted = false;
    try {
      const stat = await Deno.stat(
        `${setup.dir}/wasm_activation/pkg/wasm_activation_bg.wasm`,
      );
      extracted = stat.isFile;
    } catch {
      extracted = false;
    }
    assert(
      !extracted,
      "unattested revision advance must not be extracted into pkg/",
    );
    const denoJsonAfter = await Deno.readTextFile(`${setup.dir}/deno.json`);
    assertEquals(
      denoJsonAfter,
      denoJsonBefore,
      "deno.json must not be mutated on a blocked revision advance",
    );
  } finally {
    await setup.cleanup();
  }
}

Deno.test({
  name:
    "build.sh refuses a revision advance with no sidecar, with and without --allow-unverified (issue #3515)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    await Promise.all([
      assertRevAdvanceBlocked([]),
      assertRevAdvanceBlocked(["--allow-unverified"]),
    ]);
  },
});

Deno.test({
  name:
    "build.sh probes the release via curl when gh has no session (Issue #3990)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    // The unattended worker runs with gh installed but unauthenticated. Its
    // 401 must not abort the build: the credential-free curl probe answers,
    // and the internal bump completes.
    const setup = await setupFakeRepo();
    try {
      const sidecarSha256 = await sha256Of(setup.fixturePath);
      await writeFakeGh(setup.fakeBinDir, {
        probeCounterFile: setup.probeCounterFile,
        downloadCounterFile: setup.downloadCounterFile,
        fixturePath: setup.fixturePath,
        probeFatalStderr: "gh: Bad credentials (HTTP 401)",
        sidecarSha256,
      });
      await writeFakeCurl(setup.fakeBinDir, "200");
      const result = await runBuild(
        setup.dir,
        ["--rev", FAKE_REV_B],
        setup.fakeBinDir,
        {
          NEAT_CORE_BUNDLE_RETRIES: "5",
          NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS: "0",
        },
      );
      assertEquals(
        result.code,
        0,
        `an unauthenticated gh must not fail the build; stdout=${result.stdout}\nstderr=${result.stderr}`,
      );
      const stat = await Deno.stat(
        `${setup.dir}/wasm_activation/pkg/wasm_activation_bg.wasm`,
      );
      assert(stat.isFile, "the bundle should still be extracted into pkg/");
      const denoJson = await Deno.readTextFile(`${setup.dir}/deno.json`);
      assert(
        denoJson.includes(FAKE_REV_B),
        "the pin should advance despite the gh probe failing",
      );
    } finally {
      await setup.cleanup();
    }
  },
});

Deno.test({
  name:
    "build.sh signals an unreachable upstream with exit 3 and the marker (Issue #3990)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    // The contract bump-deps.sh degrades on: BOTH the status and the marker.
    // This asserts the producing side against the real build.sh, so the two
    // scripts cannot drift apart behind green suites.
    const setup = await setupFakeRepo();
    try {
      await Promise.all(["gh", "git", "curl"].map(async (tool) => {
        const stub = `${setup.fakeBinDir}/${tool}`;
        await Deno.writeTextFile(
          stub,
          `#!/bin/sh
printf '%s: unreachable\n' "${tool}" >&2
exit 1
`,
        );
        await Deno.chmod(stub, 0o755);
      }));
      // No --rev: build.sh must resolve neatCore.ref, and every strategy fails.
      const denoJsonBefore = await Deno.readTextFile(`${setup.dir}/deno.json`);
      const result = await runBuild(setup.dir, [], setup.fakeBinDir, {});
      assertEquals(
        result.code,
        3,
        `expected the upstream-unresolved code; stderr=${result.stderr}`,
      );
      assert(
        result.stderr.includes("BUILD_STATUS=upstream-unresolved"),
        `expected the marker on stderr; stderr=${result.stderr}`,
      );
      assertEquals(
        await Deno.readTextFile(`${setup.dir}/deno.json`),
        denoJsonBefore,
        "an unresolved lookup must not write anything",
      );
    } finally {
      await setup.cleanup();
    }
  },
});

Deno.test({
  name: "build.sh fails fast on non-404 probe error (auth) without retrying",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const setup = await setupFakeRepo();
    try {
      // Behaviour change (Issue #3990): a gh error is no longer the probe's
      // verdict on its own — the credential-free curl probe is consulted
      // next, because an unauthenticated gh is exactly the unattended worker
      // environment. Fail-fast is still what this test asserts: curl reports
      // 000 (it could not answer either), so the probe returns the non-404
      // verdict, does not retry, and never downloads. The following test
      // covers the case where curl *can* answer.
      await writeFakeGh(setup.fakeBinDir, {
        probeCounterFile: setup.probeCounterFile,
        downloadCounterFile: setup.downloadCounterFile,
        fixturePath: setup.fixturePath,
        probeFatalStderr: "gh: Bad credentials (HTTP 401)",
      });
      await writeFakeCurl(setup.fakeBinDir, "000");
      const result = await runBuild(
        setup.dir,
        ["--rev", FAKE_REV_B],
        setup.fakeBinDir,
        {
          NEAT_CORE_BUNDLE_RETRIES: "5",
          // Delay zero so even a (buggy) retry path can't hang the test;
          // probeCalls is the authoritative assertion.
          NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS: "0",
        },
      );
      assert(
        result.code !== 0,
        `Expected non-zero exit on auth error; stdout=${result.stdout}`,
      );
      const probeCalls = parseInt(
        await Deno.readTextFile(setup.probeCounterFile),
        10,
      );
      assertEquals(
        probeCalls,
        1,
        `Expected exactly one probe call (no retries on non-404); got ${probeCalls}`,
      );
      const downloadCalls = parseInt(
        await Deno.readTextFile(setup.downloadCounterFile),
        10,
      );
      assertEquals(
        downloadCalls,
        0,
        `Expected no download after probe failure; got ${downloadCalls}`,
      );
      assert(
        result.stderr.includes("non-404") || result.stderr.includes("401"),
        `Expected non-404 fail-fast message; stderr=${result.stderr}`,
      );
    } finally {
      await setup.cleanup();
    }
  },
});

Deno.test({
  name:
    "build.sh exhausts retries with a clear 'release never appeared' message",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const setup = await setupFakeRepo();
    try {
      await writeFakeGh(setup.fakeBinDir, {
        probeCounterFile: setup.probeCounterFile,
        downloadCounterFile: setup.downloadCounterFile,
        fixturePath: setup.fixturePath,
        // Always 404 — we expect the retry budget to be exhausted.
        probeFailUntilSuccess: 999,
      });
      const result = await runBuild(
        setup.dir,
        ["--rev", FAKE_REV_B],
        setup.fakeBinDir,
        {
          NEAT_CORE_BUNDLE_RETRIES: "3",
          NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS: "0",
        },
      );
      assert(
        result.code !== 0,
        `Expected non-zero exit when release never appears`,
      );
      const probeCalls = parseInt(
        await Deno.readTextFile(setup.probeCounterFile),
        10,
      );
      assertEquals(
        probeCalls,
        3,
        `Expected exactly NEAT_CORE_BUNDLE_RETRIES=3 probe calls; got ${probeCalls}`,
      );
      assert(
        result.stderr.includes(`wasm-bundle-${FAKE_REV_B}`),
        "Final error should reference the wasm-bundle-<SHA> tag",
      );
      assert(
        result.stderr.includes("wasm-bundle.yml"),
        "Final error should point at the NEAT-AI-core wasm-bundle.yml workflow",
      );
      assert(
        result.stderr.includes("never appeared") ||
          result.stderr.includes("did not appear"),
        "Final error should distinguish 'release never appeared' mode",
      );
    } finally {
      await setup.cleanup();
    }
  },
});

Deno.test({
  name:
    "build.sh validates NEAT_CORE_BUNDLE_RETRIES / DELAY env values fail fast",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const setup = await setupFakeRepo();
    try {
      await writeFakeGh(setup.fakeBinDir, {
        probeCounterFile: setup.probeCounterFile,
        downloadCounterFile: setup.downloadCounterFile,
        fixturePath: setup.fixturePath,
      });
      const badRetries = await runBuild(
        setup.dir,
        ["--rev", FAKE_REV_B],
        setup.fakeBinDir,
        { NEAT_CORE_BUNDLE_RETRIES: "0" },
      );
      assert(
        badRetries.code !== 0,
        "NEAT_CORE_BUNDLE_RETRIES=0 must fail fast",
      );
      const badDelay = await runBuild(
        setup.dir,
        ["--rev", FAKE_REV_B],
        setup.fakeBinDir,
        { NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS: "abc" },
      );
      assert(
        badDelay.code !== 0,
        "Non-numeric NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS must fail fast",
      );
    } finally {
      await setup.cleanup();
    }
  },
});

interface AssetRefusalOutcome {
  result: RunResult;
  denoJsonBefore: string;
  denoJsonAfter: string;
  /** Names of the entries left in wasm_activation/pkg (empty if absent). */
  pkgEntries: string[];
}

/**
 * Runs build.sh where the gh tarball download fails and the curl fallback
 * fails as `asset` describes (Issue #4120). The probe succeeds, so the
 * download is the first thing that can go wrong.
 */
async function runAssetRefusal(
  asset: FakeAssetFailure,
  extraArgs: string[],
): Promise<AssetRefusalOutcome> {
  const setup = await setupFakeRepo();
  try {
    await writeFakeGh(setup.fakeBinDir, {
      probeCounterFile: setup.probeCounterFile,
      downloadCounterFile: setup.downloadCounterFile,
      fixturePath: setup.fixturePath,
      downloadFails: true,
    });
    await writeFakeCurl(setup.fakeBinDir, "200", asset);
    const denoJsonBefore = await Deno.readTextFile(`${setup.dir}/deno.json`);
    const result = await runBuild(
      setup.dir,
      ["--rev", FAKE_REV_B, ...extraArgs],
      setup.fakeBinDir,
      {
        NEAT_CORE_BUNDLE_RETRIES: "5",
        NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS: "0",
      },
    );
    const denoJsonAfter = await Deno.readTextFile(`${setup.dir}/deno.json`);
    const pkgEntries: string[] = [];
    try {
      for await (
        const entry of Deno.readDir(`${setup.dir}/wasm_activation/pkg`)
      ) {
        pkgEntries.push(entry.name);
      }
    } catch (err) {
      // --clean deletes pkg/ outright; a missing directory holds no files.
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    return { result, denoJsonBefore, denoJsonAfter, pkgEntries };
  } finally {
    await setup.cleanup();
  }
}

/**
 * Asserts an asset-host refusal is reported as upstream-unresolved: exit 3,
 * the marker, curl's own stderr still shown, and nothing changed (Issue #4120).
 */
function assertAssetHostUnreachable(
  outcome: AssetRefusalOutcome,
  asset: FakeAssetFailure,
): void {
  const { result } = outcome;
  assertEquals(
    result.code,
    3,
    `expected the upstream-unresolved code for a refused asset host; stderr=${result.stderr}`,
  );
  assert(
    result.stderr.includes(UPSTREAM_MARKER),
    `expected the marker on stderr; stderr=${result.stderr}`,
  );
  assert(
    result.stderr.includes("Could not download"),
    `the ERROR lines must still be printed; stderr=${result.stderr}`,
  );
  assert(
    result.stderr.includes(asset.stderr),
    `curl's own stderr must not be swallowed; stderr=${result.stderr}`,
  );
  assert(
    result.stderr.includes(`curl exit code ${asset.exitCode}`) &&
      result.stderr.includes(`HTTP status ${asset.httpStatus}`),
    `expected the curl exit code and HTTP status to be named; stderr=${result.stderr}`,
  );
  assertEquals(
    outcome.denoJsonAfter,
    outcome.denoJsonBefore,
    "deno.json must not be mutated when the asset host is unreachable",
  );
  assert(
    outcome.denoJsonAfter.includes(FAKE_REV_A),
    "the pinned neatCore.rev must still be FAKE_REV_A",
  );
  assertEquals(
    outcome.pkgEntries,
    [],
    "no bundle files may be extracted into pkg/",
  );
}

const CONNECT_TUNNEL_REFUSED: FakeAssetFailure = {
  exitCode: 56,
  httpStatus: "000",
  stderr: "curl: (56) CONNECT tunnel failed, response 403",
};

const ASSET_FORBIDDEN: FakeAssetFailure = {
  exitCode: 22,
  httpStatus: "403",
  stderr: "curl: (22) The requested URL returned error: 403",
};

const ASSET_NOT_FOUND: FakeAssetFailure = {
  exitCode: 22,
  httpStatus: "404",
  stderr: "curl: (22) The requested URL returned error: 404",
};

const ASSET_GONE: FakeAssetFailure = {
  exitCode: 22,
  httpStatus: "410",
  stderr: "curl: (22) The requested URL returned error: 410",
};

Deno.test({
  name:
    "build.sh signals a refused asset tunnel (curl 56 / 000) with exit 3 and the marker (Issue #4120)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const outcome = await runAssetRefusal(CONNECT_TUNNEL_REFUSED, []);
    assertAssetHostUnreachable(outcome, CONNECT_TUNNEL_REFUSED);
  },
});

Deno.test({
  name:
    "build.sh signals a 403 on the release asset with exit 3 and the marker (Issue #4120)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const outcome = await runAssetRefusal(ASSET_FORBIDDEN, []);
    assertAssetHostUnreachable(outcome, ASSET_FORBIDDEN);
  },
});

Deno.test({
  name:
    "build.sh keeps a genuinely missing release asset (curl 22 / 404) a hard failure, exit 1 with no marker (Issue #4120)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const outcome = await runAssetRefusal(ASSET_NOT_FOUND, []);
    const { result } = outcome;
    assertEquals(
      result.code,
      1,
      `a 404 for the asset must stay a hard failure; stderr=${result.stderr}`,
    );
    assert(
      !result.stderr.includes(UPSTREAM_MARKER),
      `a missing asset must not carry the upstream-unresolved marker; stderr=${result.stderr}`,
    );
    assert(
      result.stderr.includes("Could not download"),
      `the ERROR lines must still be printed; stderr=${result.stderr}`,
    );
  },
});

Deno.test({
  name:
    "build.sh keeps a gone release asset (curl 22 / 410) a hard failure, exit 1 with no marker (Issue #4120)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    const outcome = await runAssetRefusal(ASSET_GONE, []);
    const { result } = outcome;
    assertEquals(
      result.code,
      1,
      `a 410 for the asset must stay a hard failure; stderr=${result.stderr}`,
    );
    assert(
      !result.stderr.includes(UPSTREAM_MARKER),
      `a gone asset must not carry the upstream-unresolved marker; stderr=${result.stderr}`,
    );
    assert(
      result.stderr.includes("Could not download"),
      `the ERROR lines must still be printed; stderr=${result.stderr}`,
    );
  },
});

Deno.test({
  name:
    "build.sh keeps an asset refusal a hard failure under --clean, exit 1 with no marker (Issue #4120)",
  permissions: { run: true, read: true, write: true, env: true },
  fn: async () => {
    // --clean already deleted pkg/, so "nothing was changed" is false and the
    // refusal cannot be treated as a skip.
    const outcome = await runAssetRefusal(CONNECT_TUNNEL_REFUSED, ["--clean"]);
    const { result } = outcome;
    assertEquals(
      result.code,
      1,
      `--clean must keep an asset refusal a hard failure; stderr=${result.stderr}`,
    );
    assert(
      !result.stderr.includes(UPSTREAM_MARKER),
      `--clean must not carry the upstream-unresolved marker; stderr=${result.stderr}`,
    );
    assert(
      result.stderr.includes("Could not download"),
      `the ERROR lines must still be printed; stderr=${result.stderr}`,
    );
  },
});
