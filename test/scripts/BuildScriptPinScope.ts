import { assert, assertEquals } from "@std/assert";
import { runSourcedFns } from "./_buildShHarness.ts";

/**
 * Tests that build.sh scopes the deno.json `neatCore.assetSha256` pin to the
 * revision it was recorded against (issue #3514).
 *
 * The pin sits next to `neatCore.rev` and is by construction the hash of that
 * rev's tarball, so comparing it against a bundle downloaded for a different
 * rev always mismatches and blocks every revision advance. The pin must be
 * enforced when the target rev equals the pinned rev, and skipped — visibly —
 * otherwise.
 */

const PIN_FNS = ["verify_tarball_sha256", "verify_pinned_asset_sha256"];

const REV_A = "a".repeat(40);
const REV_B = "b".repeat(40);

/** Write a stand-in tarball and return its path plus real SHA-256. */
async function makeTarball(
  dir: string,
  content: string,
): Promise<{ path: string; sha256: string }> {
  const path = `${dir}/wasm_activation-pkg.tar.gz`;
  await Deno.writeTextFile(path, content);
  const cmd = new Deno.Command("shasum", {
    args: ["-a", "256", path],
    stdout: "piped",
  });
  const out = await cmd.output();
  const sha256 = new TextDecoder().decode(out.stdout).trim().split(/\s+/)[0];
  return { path, sha256 };
}

Deno.test({
  name: "pin is enforced when the target rev equals the pinned rev",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-pin-scope-" });
    try {
      const { path, sha256 } = await makeTarball(tmpDir, "bundle-for-rev-a");
      const ok = await runSourcedFns(
        PIN_FNS,
        `verify_pinned_asset_sha256 '${path}' '${sha256}' '${REV_A}' '${REV_A}'`,
      );
      assertEquals(
        ok.code,
        0,
        `matching pin on the pinned rev must verify; stderr=${ok.stderr}`,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "pin mismatch on the pinned rev is a hard failure",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-pin-scope-" });
    try {
      const { path } = await makeTarball(tmpDir, "tampered-bundle");
      const bad = await runSourcedFns(
        PIN_FNS,
        `verify_pinned_asset_sha256 '${path}' '${
          "0".repeat(64)
        }' '${REV_A}' '${REV_A}'`,
      );
      assertEquals(bad.code, 1, "same-rev hash mismatch must return 1 (abort)");
      assert(
        bad.stderr.includes("deno.json neatCore.assetSha256"),
        `Expected the pin source label in the error; got: ${bad.stderr}`,
      );
      assert(
        bad.stderr.includes("SHA-256 mismatch"),
        `Expected a SHA-256 mismatch error; got: ${bad.stderr}`,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "pin is skipped, and the skip logged, when the target rev differs",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-pin-scope-" });
    try {
      // The tarball is the NEW rev's bundle; the pin is the OLD rev's hash.
      const { path } = await makeTarball(tmpDir, "bundle-for-rev-b");
      const skipped = await runSourcedFns(
        PIN_FNS,
        `verify_pinned_asset_sha256 '${path}' '${
          "c".repeat(64)
        }' '${REV_A}' '${REV_B}'`,
      );
      assertEquals(
        skipped.code,
        2,
        `a foreign-rev pin must be skipped (2), not compared; stderr=${skipped.stderr}`,
      );
      const log = skipped.stdout + skipped.stderr;
      assert(
        log.includes(REV_A.slice(0, 7)) && log.includes(REV_B.slice(0, 7)),
        `Skip note must name both short SHAs; got: ${log}`,
      );
      assert(
        log.includes("neatCore.assetSha256"),
        `Skip note must name the pin being skipped; got: ${log}`,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "an unset pin is silently inapplicable",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "neat-pin-scope-" });
    try {
      const { path } = await makeTarball(tmpDir, "bundle-no-pin");
      const unset = await runSourcedFns(
        PIN_FNS,
        `verify_pinned_asset_sha256 '${path}' '' '' '${REV_B}'`,
      );
      assertEquals(unset.code, 2, "an unset pin contributes no anchor (2)");
      assertEquals(
        (unset.stdout + unset.stderr).trim(),
        "",
        "an unset pin must not print a skip note",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});
