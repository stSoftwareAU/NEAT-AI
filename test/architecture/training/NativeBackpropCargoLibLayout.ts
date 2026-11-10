/**
 * Issue #4146 — the `$CARGO_HOME/lib` install layout.
 *
 * GRQ hosts install `libneat_ai_backpropagation` under `~/.cargo/lib` and run
 * with no `NEAT_AI_BACKPROP_LIB_PATH`. If resolution missed that layout the
 * worker would silently train on a different backend than the operator
 * expects. These cases pin that the library is found there, ahead of any
 * checkout-relative build, and that an absent library is reported as absent
 * (never as an empty-string path).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  findNativeBackpropLibraryFromOptions,
  nativeBackpropLibFileName,
} from "@architecture/training/NativeBackpropLibrary.ts";

function writeLib(dir: string): string {
  Deno.mkdirSync(dir, { recursive: true });
  const path = join(dir, nativeBackpropLibFileName());
  Deno.writeTextFileSync(path, "");
  return path;
}

Deno.test("Issue #4146: the library is found in the ~/.cargo/lib install layout with no override", () => {
  const root = Deno.makeTempDirSync({ prefix: "backprop-cargo-layout-" });
  try {
    const installed = writeLib(join(root, "home", ".cargo", "lib"));
    const found = findNativeBackpropLibraryFromOptions({
      homeDir: join(root, "home"),
      cwd: join(root, "empty-cwd"),
      siblingDir: join(root, "missing-sibling"),
    });
    assertEquals(found, installed);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Issue #4146: the ~/.cargo/lib install wins over a build in the working directory", () => {
  const root = Deno.makeTempDirSync({ prefix: "backprop-cargo-layout-" });
  try {
    const installed = writeLib(join(root, "home", ".cargo", "lib"));
    writeLib(join(root, "cwd", "target", "release"));
    const found = findNativeBackpropLibraryFromOptions({
      homeDir: join(root, "home"),
      cwd: join(root, "cwd"),
      siblingDir: join(root, "missing-sibling"),
    });
    assertEquals(found, installed);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("Issue #4146: a home with no ~/.cargo/lib install resolves to no library", () => {
  const root = Deno.makeTempDirSync({ prefix: "backprop-cargo-layout-" });
  try {
    Deno.mkdirSync(join(root, "home", ".cargo"), { recursive: true });
    const found = findNativeBackpropLibraryFromOptions({
      homeDir: join(root, "home"),
      cwd: join(root, "empty-cwd"),
      siblingDir: join(root, "missing-sibling"),
    });
    assertEquals(found, null);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});
