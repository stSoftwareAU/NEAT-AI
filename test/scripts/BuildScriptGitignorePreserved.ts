import { assert, assertEquals } from "@std/assert";
import { runSourcedFns } from "./_buildShHarness.ts";

/**
 * Regression test for PR #3548: `extract_bundle` must not let the upstream
 * tarball's wasm-pack `.gitignore` (a blanket `*`) clobber this repo's
 * curated `wasm_activation/pkg/.gitignore` allowlist. When it did, the
 * vendored WASM artefacts became gitignored and dropped out of
 * `deno publish` output.
 */
Deno.test({
  name: "extract_bundle preserves the destination .gitignore",
  permissions: { run: true, read: true, write: true },
  fn: async () => {
    const tmp = await Deno.makeTempDir({ prefix: "neat-extract-" });
    try {
      const src = `${tmp}/src`;
      const dest = `${tmp}/dest`;
      await Deno.mkdir(src);
      await Deno.mkdir(dest);
      // wasm-pack's blanket ignore, as shipped inside the bundle.
      await Deno.writeTextFile(`${src}/.gitignore`, "*\n");
      await Deno.writeTextFile(`${src}/wasm_activation.js`, "export {};\n");
      await Deno.writeTextFile(
        `${dest}/.gitignore`,
        "*\n!wasm_activation.js\n",
      );

      const tar = await new Deno.Command("tar", {
        args: ["-czf", `${tmp}/bundle.tar.gz`, "-C", src, "."],
        stdin: "null",
      }).output();
      assertEquals(tar.code, 0, "failed to build the fixture tarball");

      const result = await runSourcedFns(
        ["extract_bundle"],
        `extract_bundle '${tmp}/bundle.tar.gz' '${dest}'`,
      );
      assertEquals(result.code, 0, `extract_bundle failed: ${result.stderr}`);

      assertEquals(
        await Deno.readTextFile(`${dest}/.gitignore`),
        "*\n!wasm_activation.js\n",
        "extract_bundle must leave the repo's curated pkg/.gitignore intact",
      );
      assert(
        await Deno.stat(`${dest}/wasm_activation.js`).then((s) => s.isFile),
        "extract_bundle must still unpack the bundle's payload files",
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
});
