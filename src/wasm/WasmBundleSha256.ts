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
 *
 * Issue #3743: the address size of the pinned bundle travels the same way, so
 * {@link file://./WasmModuleLoader.ts} can refuse to run a wasm32 copy under a
 * wasm64 pin instead of silently inheriting the 4 GiB linear-memory ceiling.
 *
 * Issue #4097: the wasm-bindgen glue (`wasm_activation.js`) is pinned the same
 * way as the bundle, because it is cached on disk beside the bundle and
 * executed in workers.
 */

import type { WasmMemoryModel } from "@wasm/WasmMemoryModel.ts";

/** Lowercase hex SHA-256 of `wasm_activation/pkg/wasm_activation_bg.wasm`. */
export const EXPECTED_WASM_BUNDLE_SHA256 =
  "c78b937fda7f68978abbe29e679f8539bf4f728f8e72a8b97eb9de4cf0e8a2ea";

/**
 * Lowercase hex SHA-256 of `wasm_activation/pkg/wasm_activation.js` (the
 * wasm-bindgen glue). Issue #4097: the glue is cached on disk beside the
 * bundle and executed in workers, so it needs the same trusted pin.
 */
export const EXPECTED_WASM_GLUE_SHA256 =
  "8697978ca471e44fd69c61d69677bca5f3875629fa1e3b244415d71f6bd2802c";

/**
 * Address size of the pinned linear memory, mirroring `deno.json`
 * `neatCore.memoryModel` and verified against the bundle bytes by
 * `./build.sh` before this file is written.
 */
export const EXPECTED_WASM_MEMORY_MODEL: WasmMemoryModel = "wasm64";
