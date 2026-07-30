import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { runSourcedFns } from "./_buildShHarness.ts";

/**
 * Regression tests for the build.sh bump-to-a-new-revision path (issue #3516).
 *
 * `BuildScriptContentHash.ts` only ever exercises *same-rev* downloads, which
 * is why #3504 shipped: a stale `deno.json` `neatCore.assetSha256` pin was
 * compared against a different revision's tarball and blocked every internal
 * bump. These tests drive the composed anchor decision
 * (`select_tarball_anchor`) and the pin write-back (`update_core_pin`) across
 * a revision advance.
 *
 * No network access: the sidecar is a local file and the tarball a stand-in
 * blob, both under a temp dir. The write-back runs against a temp copy of
 * `deno.json`, so the repo's real pin is untouched.
 */

/** build.sh helpers the anchor decision is composed from, in definition order. */
const ANCHOR_FNS = [
  "verify_tarball_sha256",
  "verify_pinned_asset_sha256",
  "guard_unverified_extract",
  "select_tarball_anchor",
];

const REV_OLD = "a".repeat(40);
const REV_NEW = "b".repeat(40);
const SIDECAR_NAME = "wasm_activation-pkg.tar.gz.sha256";

/** select_tarball_anchor exit codes (see the build.sh header comment). */
const ANCHORED = 0;
const MISMATCH = 1;
const BOOTSTRAP = 2;
const REFUSED = 3;

/** Write a stand-in tarball and return its path plus its real SHA-256. */
async function makeTarball(
  dir: string,
  content: string,
): Promise<{ path: string; sha256: string }> {
  const path = `${dir}/wasm_activation-pkg.tar.gz`;
  await Deno.writeTextFile(path, content);
  const out = await new Deno.Command("shasum", {
    args: ["-a", "256", path],
    stdout: "piped",
  }).output();
  const sha256 = new TextDecoder().decode(out.stdout).trim().split(/\s+/)[0];
  return { path, sha256 };
}

/** Write a release sidecar in `shasum -a 256` output format. */
async function makeSidecar(dir: string, sha256: string): Promise<string> {
  const path = `${dir}/${SIDECAR_NAME}`;
  await Deno.writeTextFile(path, `${sha256}  wasm_activation-pkg.tar.gz\n`);
  return path;
}

/**
 * Invoke `select_tarball_anchor` with the given arguments.
 *
 * @param sidecarPath "" when the release published no sidecar.
 */
function selectAnchor(opts: {
  tarball: string;
  sidecarPath: string;
  pinnedSha256: string;
  pinnedRev: string;
  targetRev: string;
  allowUnverified?: boolean;
}) {
  return runSourcedFns(
    ANCHOR_FNS,
    `select_tarball_anchor '${opts.tarball}' '${opts.sidecarPath}' ` +
      `'${opts.pinnedSha256}' '${opts.pinnedRev}' '${opts.targetRev}' ` +
      `'${opts.allowUnverified ? "true" : "false"}'`,
  );
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "neat-rev-advance-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test({
  name:
    "revision advance: a stale pin is not compared when the sidecar anchors the new rev (issue #3504)",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    await withTempDir(async (dir) => {
      // The tarball is the NEW rev's bundle; the pin still records the OLD
      // rev's hash. Comparing it would mismatch and block the bump.
      const { path, sha256 } = await makeTarball(dir, "bundle-for-rev-new");
      const sidecarPath = await makeSidecar(dir, sha256);

      const result = await selectAnchor({
        tarball: path,
        sidecarPath,
        pinnedSha256: "c".repeat(64),
        pinnedRev: REV_OLD,
        targetRev: REV_NEW,
      });

      assertEquals(
        result.code,
        ANCHORED,
        `a matching sidecar must anchor a revision advance despite the stale ` +
          `pin; stdout=${result.stdout} stderr=${result.stderr}`,
      );
      assertStringIncludes(result.stdout, SIDECAR_NAME);
      assert(
        !result.stdout.includes("neatCore.assetSha256"),
        `the stale pin must not be reported as an anchor; got: ${result.stdout}`,
      );
    });
  },
});

Deno.test({
  name: "same rev: the pin still bites when the tarball hash differs",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    await withTempDir(async (dir) => {
      const { path } = await makeTarball(dir, "tampered-bundle");

      const result = await selectAnchor({
        tarball: path,
        sidecarPath: "",
        pinnedSha256: "0".repeat(64),
        pinnedRev: REV_OLD,
        targetRev: REV_OLD,
      });

      assertEquals(
        result.code,
        MISMATCH,
        `a same-rev pin mismatch must abort; stdout=${result.stdout}`,
      );
      assertStringIncludes(result.stderr, "deno.json neatCore.assetSha256");
      assertStringIncludes(result.stderr, "SHA-256 mismatch");
    });
  },
});

Deno.test({
  name:
    "revision advance: no sidecar refuses to extract, even with --allow-unverified",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    await withTempDir(async (dir) => {
      const { path } = await makeTarball(dir, "bundle-for-rev-new");
      const noSidecar = {
        tarball: path,
        sidecarPath: "",
        pinnedSha256: "c".repeat(64),
        pinnedRev: REV_OLD,
        targetRev: REV_NEW,
      };

      const strict = await selectAnchor(noSidecar);
      assertEquals(
        strict.code,
        REFUSED,
        `an unanchored revision advance must refuse; stdout=${strict.stdout}`,
      );

      const permissive = await selectAnchor({
        ...noSidecar,
        allowUnverified: true,
      });
      assertEquals(
        permissive.code,
        REFUSED,
        "--allow-unverified must not rescue an unanchored revision advance " +
          "(issue #3515)",
      );
    });
  },
});

Deno.test({
  name: "revision advance: a mismatching sidecar fails loud",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    await withTempDir(async (dir) => {
      const { path } = await makeTarball(dir, "bundle-for-rev-new");
      // The sidecar attests some other blob — a substituted release asset.
      const sidecarPath = await makeSidecar(dir, "d".repeat(64));

      const result = await selectAnchor({
        tarball: path,
        sidecarPath,
        pinnedSha256: "",
        pinnedRev: REV_OLD,
        targetRev: REV_NEW,
        allowUnverified: true,
      });

      assertEquals(
        result.code,
        MISMATCH,
        `a mismatching sidecar must abort; stdout=${result.stdout}`,
      );
      assertStringIncludes(result.stderr, `release sidecar ${SIDECAR_NAME}`);
      assertStringIncludes(result.stderr, "SHA-256 mismatch");
    });
  },
});

Deno.test({
  name:
    "same rev with no anchor keeps its --allow-unverified bootstrap (issue #2744)",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    await withTempDir(async (dir) => {
      const { path } = await makeTarball(dir, "fresh-setup-bundle");
      const fresh = {
        tarball: path,
        sidecarPath: "",
        pinnedSha256: "",
        pinnedRev: "",
        targetRev: REV_NEW,
      };

      const strict = await selectAnchor(fresh);
      assertEquals(strict.code, REFUSED, "no anchor and no opt-in must refuse");

      const permissive = await selectAnchor({
        ...fresh,
        allowUnverified: true,
      });
      assertEquals(
        permissive.code,
        BOOTSTRAP,
        "a same-rev/fresh-setup run must still bootstrap under " +
          "--allow-unverified",
      );
    });
  },
});

Deno.test({
  name: "write-back on a successful advance records the new rev and hash",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    await withTempDir(async (dir) => {
      const configPath = `${dir}/deno.json`;
      const newSha256 = "e".repeat(64);
      await Deno.writeTextFile(
        configPath,
        JSON.stringify(
          {
            name: "@stsoftware/neat",
            neatCore: { rev: REV_OLD, assetSha256: "c".repeat(64) },
          },
          null,
          2,
        ) + "\n",
      );

      const result = await runSourcedFns(
        ["update_core_pin"],
        `update_core_pin '${configPath}' '${REV_NEW}' '${newSha256}' ` +
          `'${REV_OLD}' '${"c".repeat(64)}'`,
      );
      assertEquals(
        result.code,
        0,
        `write-back must succeed; stderr=${result.stderr}`,
      );

      const updated = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(updated.neatCore.rev, REV_NEW);
      assertEquals(updated.neatCore.assetSha256, newSha256);
      assertEquals(
        updated.name,
        "@stsoftware/neat",
        "unrelated deno.json keys must be preserved",
      );
    });
  },
});

Deno.test({
  name: "write-back is a no-op when the rev and hash are already current",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    await withTempDir(async (dir) => {
      const configPath = `${dir}/deno.json`;
      const sha256 = "e".repeat(64);
      const original = JSON.stringify(
        { neatCore: { rev: REV_NEW, assetSha256: sha256 } },
        null,
        2,
      ) + "\n";
      await Deno.writeTextFile(configPath, original);

      const result = await runSourcedFns(
        ["update_core_pin"],
        `update_core_pin '${configPath}' '${REV_NEW}' '${sha256}' ` +
          `'${REV_NEW}' '${sha256}'`,
      );
      assertEquals(result.code, 0);
      assertEquals(
        await Deno.readTextFile(configPath),
        original,
        "an already-current pin must leave deno.json byte-identical",
      );
    });
  },
});
