# Include LICENSE in the JSR publish set and declare an SPDX licence

## Summary

`deno.json` declared no `license` field, and its `publish.include` allowlist did
not list `LICENSE`, so the published `@stsoftware/neat-ai` artefact carried its
licence only by whatever `deno publish` happened to auto-include, with no SPDX
identifier for consumers or SBOM / licence-compliance tooling to read.

Two additive manifest changes fix that:

- `"license": "Apache-2.0"` — the SPDX identifier, matching the Apache Licence
  2.0 text in `LICENSE` and the licence stated in `README.md`.
- `"LICENSE"` added to `publish.include` — the licence text is now shipped
  because the allowlist says so, satisfying Apache-2.0 §4.1 explicitly rather
  than implicitly.

Neither change alters code or the publish flow. Closes #3674.

## Evidence

Backend/packaging change only — no web interface to screenshot. Verified via the
new tests, which fail against the unfixed manifest and pass after it:

```text
$ deno test --allow-read --allow-run test/scripts/PublishLicenceMetadata.ts
# before the fix
deno.json declares the Apache-2.0 SPDX identifier (Issue #3674) ... FAILED
  Values are not equal: undefined vs "Apache-2.0"
publish.include lists LICENSE explicitly (Issue #3674) ... FAILED
  found: ["README.md","mod.ts","src/**","wasm_activation/pkg/**"]
FAILED | 2 passed | 2 failed

# after the fix
ok | 4 passed | 0 failed (425ms)
```

`deno publish --dry-run --allow-dirty` lists `LICENSE (11.09KB)` in the
published file set, which the fourth test asserts on directly.

## Test Plan

New file `test/scripts/PublishLicenceMetadata.ts`:

- `deno.json declares the Apache-2.0 SPDX identifier` — parses the committed
  manifest and asserts `license === "Apache-2.0"` (regression test for the
  missing field).
- `the declared SPDX identifier matches the LICENSE file` — asserts the root
  `LICENSE` really is the Apache Licence 2.0 text, so the identifier is
  truthful.
- `publish.include lists LICENSE explicitly` — asserts the allowlist carries
  `LICENSE` (regression test for the missing entry).
- `deno publish ships the LICENSE file` — runs `deno publish --dry-run` and
  asserts `LICENSE` appears in the published file set, so the outcome is
  verified rather than just the manifest text.

`./quality.sh` was run to completion over the full suite.
