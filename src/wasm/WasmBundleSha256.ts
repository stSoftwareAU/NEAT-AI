/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by `./build.sh` from `wasm_activation/pkg/wasm_activation_bg.wasm`
 * each time the vendored NEAT-AI-core bundle is refreshed, and committed
 * alongside `deno.json` and `wasm_activation/pkg/**`.
 *
 * Issue #3680: `deno.json` `neatCore.assetSha256` pins the *release tarball*
 * and is enforced only at build time, so the runtime had no value to compare
 * the instantiated bundle against. This constant is part of the module graph —
 * it travels with the published package and is integrity-checked by Deno's own
 * JSR/lockfile verification — which makes it the trusted expectation used by
 * {@link file://./WasmBundleCache.ts} to verify bytes coming from the
 * environment-controlled disk cache or the network.
 */

/** Lowercase hex SHA-256 of `wasm_activation/pkg/wasm_activation_bg.wasm`. */
export const EXPECTED_WASM_BUNDLE_SHA256 =
  "ae0726be3ed4882f7c13ca5be3cf3fd19342b99f1b55c0b969b44201f0bab813";
