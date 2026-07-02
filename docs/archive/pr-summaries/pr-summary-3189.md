# Declare the `license` field in deno.json (SPDX Apache-2.0)

## Summary

`@stsoftware/neat-ai` is published to JSR, so `deno.json` is consumer-facing
metadata. The manifest declared `name`, `exports`, and `version` but had **no
`license` key**, even though the repo ships an Apache-2.0 `LICENSE` file.
Without a machine-readable licence, JSR's package page, SBOM generators, and
dependency-licence scanners cannot cross-check the manifest against the
`LICENSE` file and must fall back to heuristics.

This PR adds the exact SPDX short code matching the committed `LICENSE`:

```json
"license": "Apache-2.0"
```

Closes #3189.

## Evidence

Backend/metadata change — no web interface to screenshot. Verified via the new
CI tests and the quality gate:

- `deno test test/ci/LicenseMetadata.ts` — 2 passed, 0 failed.
- `./quality.sh --check-only` — `deno fmt`, `deno lint`, and `deno check` all
  pass cleanly with the change applied.

The SPDX identifier `Apache-2.0` is the canonical short code from
<https://spdx.org/licenses/> and agrees with the `LICENSE` file
(`Apache License, Version 2.0`).

## Test Plan

Added `test/ci/LicenseMetadata.ts` following TDD (failed before the manifest
change, passes after):

- `deno.json declares an SPDX license field` — asserts `license` equals
  `Apache-2.0`.
- `declared license agrees with the committed LICENSE file` — asserts the
  `LICENSE` file is Apache-2.0 and the manifest short code matches it, so the
  two can never silently drift.
