/**
 * Native neat-core backprop (Issue #3741). Native `libneat_core` is
 * opt-in (`NEAT_AI_NATIVE_CORE_BACKPROP=1`). Resolution tests use temp
 * files so they do not depend on a built library path. The
 * NoChange-sentinel test talks to the real library when it is present
 * and skips otherwise. Existing propagate tests stay on WASM by default.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  closeNativeCoreLibrary,
  findNativeCoreLibrary,
  findNativeCoreLibraryFromOptions,
  getNativeCoreVersion,
  isNativeCoreAvailable,
  isNativeCoreBackpropEnabled,
  nativeCoreLibFileName,
  nativePropagateTopological,
} from "@wasm/NativeCoreLibrary.ts";

function writeDummyLib(dir: string): string {
  const path = join(dir, nativeCoreLibFileName());
  Deno.writeFileSync(path, new Uint8Array([1, 2, 3, 4]));
  return path;
}

Deno.test("native core library: override file path wins", () => {
  const root = Deno.makeTempDirSync({ prefix: "native-core-override-" });
  try {
    const override = writeDummyLib(root);
    const home = join(root, "home");
    Deno.mkdirSync(join(home, ".cargo", "lib"), { recursive: true });
    writeDummyLib(join(home, ".cargo", "lib"));

    const found = findNativeCoreLibraryFromOptions({
      overridePath: override,
      homeDir: home,
      cwd: join(root, "cwd"),
      siblingDir: join(root, "missing-sibling"),
    });
    assertEquals(found, override);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("native core library: cargo lib is used when override is absent", () => {
  const root = Deno.makeTempDirSync({ prefix: "native-core-cargo-" });
  try {
    Deno.mkdirSync(join(root, ".cargo", "lib"), { recursive: true });
    const cargoLib = writeDummyLib(join(root, ".cargo", "lib"));
    const found = findNativeCoreLibraryFromOptions({
      homeDir: root,
      cwd: join(root, "cwd"),
      siblingDir: join(root, "missing-sibling"),
    });
    assertEquals(found, cargoLib);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("native core library: missing candidates return null", () => {
  const root = Deno.makeTempDirSync({ prefix: "native-core-missing-" });
  try {
    const found = findNativeCoreLibraryFromOptions({
      homeDir: join(root, "no-home"),
      cwd: join(root, "no-cwd"),
      siblingDir: join(root, "no-sibling"),
    });
    assertEquals(found, null);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("native core backprop is opt-in unless NEAT_AI_NATIVE_CORE_BACKPROP=1", () => {
  // Do not mutate process env: parallel tests share it. The default quality.sh
  // run leaves the flag unset. `--next` now enables the Rust trainDir app,
  // not this FFI loop.
  const raw = Deno.env.get("NEAT_AI_NATIVE_CORE_BACKPROP");
  const expected = raw !== undefined &&
    ["1", "true", "yes"].includes(raw.trim().toLowerCase());
  assertEquals(isNativeCoreBackpropEnabled(), expected);
});

/** True when sibling/env libneat_core resolves and actually loads via dlopen. */
function nativeCoreLoads(): boolean {
  if (findNativeCoreLibrary() === null) return false;
  try {
    const ok = isNativeCoreAvailable();
    closeNativeCoreLibrary();
    return ok;
  } catch {
    closeNativeCoreLibrary();
    return false;
  }
}

Deno.test({
  name: "native core library: sibling dylib can be loaded without an env var",
  sanitizeResources: false,
  sanitizeOps: false,
  // Skip when absent *or* when the path exists but cannot load (stale/stub
  // dylib on disk). A broken sibling must not fail ./quality.sh --next, which
  // does not build neat-core.
  ignore: !nativeCoreLoads(),
  fn: () => {
    try {
      assert(
        isNativeCoreAvailable(),
        "libneat_core was resolved but failed to load",
      );
    } finally {
      closeNativeCoreLibrary();
    }
  },
});

/**
 * Same 2→1 identity, expected == activation fixture as
 * `zero_error_output_writes_no_change_sentinel` in NEAT-AI-core.
 */
function zeroErrorIdentityBuffer(): Uint8Array {
  const bytes = new Uint8Array(36 + 3 * 24 + 2 * 20 + 3 * 8 + 2 * 4 + 4 + 4);
  const view = new DataView(bytes.buffer);
  let o = 0;
  const u32 = (v: number) => {
    view.setUint32(o, v, true);
    o += 4;
  };
  const u8 = (v: number) => {
    view.setUint8(o, v);
    o += 1;
  };
  const f32 = (v: number) => {
    view.setFloat32(o, v, true);
    o += 4;
  };
  const f64 = (v: number) => {
    view.setFloat64(o, v, true);
    o += 8;
  };

  u32(3);
  u32(2);
  u32(1);
  u32(2);
  u32(1);
  u32(2);
  f64(1e-7);
  u8(0);
  u8(0);
  u8(0);
  u8(0);

  for (const [kind, act] of [[0, 0.5], [0, 0.5], [2, 1.0]] as const) {
    u8(0);
    u8(kind);
    u8(1);
    u8(1);
    f32(0);
    f32(-1e6);
    f32(1e6);
    f32(act);
    f32(0);
  }
  for (const [from, to] of [[0, 2], [1, 2]] as const) {
    u32(from);
    u32(to);
    f32(1);
    f32(1);
    u8(0);
    u8(0);
    u8(0);
    u8(0);
  }
  for (const [start, count] of [[0, 0], [0, 0], [0, 2]] as const) {
    u32(start);
    u32(count);
  }
  u32(0);
  u32(1);
  u32(2);
  f32(1);
  return bytes.subarray(0, o);
}

Deno.test({
  name:
    "native core library: zero-error identity output uses the NoChange sentinel",
  sanitizeResources: false,
  sanitizeOps: false,
  ignore: !nativeCoreLoads(),
  fn: () => {
    try {
      const version = getNativeCoreVersion();
      assert(version !== undefined && version.length > 0);

      const packed = nativePropagateTopological(zeroErrorIdentityBuffer());
      assert(
        packed !== undefined,
        "native backprop should return a packed result",
      );
      const cached = packed[2 * 7 + 1];
      assert(
        cached === Number.NEGATIVE_INFINITY,
        `expected NoChange sentinel, got ${cached}`,
      );
    } finally {
      closeNativeCoreLibrary();
    }
  },
});
