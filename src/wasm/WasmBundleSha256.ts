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
 */

import type { WasmMemoryModel } from "@wasm/WasmMemoryModel.ts";

/** Lowercase hex SHA-256 of `wasm_activation/pkg/wasm_activation_bg.wasm`. */
export const EXPECTED_WASM_BUNDLE_SHA256 =
  "beaf7a0df789571e6f076847b4541c950b5fede8c36a24e92189be1ab5ee70fe";

/**
 * Address size of the pinned linear memory, mirroring `deno.json`
 * `neatCore.memoryModel` and verified against the bundle bytes by
 * `./build.sh` before this file is written.
 */
export const EXPECTED_WASM_MEMORY_MODEL: WasmMemoryModel = "wasm64";
