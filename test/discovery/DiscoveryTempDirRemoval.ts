/**
 * Tests for verified discovery temp-directory removal (GRQ #4241).
 *
 * The production failure was `Failed to cleanup discovery temp dir: Error:
 * Directory not empty (os error 66)` immediately followed by `cleanup
 * complete.` — a writer was still creating files while the recursive walk ran,
 * the removal failed, and the caller reported success anyway. These tests
 * assert the removal only reports success when the directory is actually gone,
 * and names the leftover entries when it is not.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDirSync } from "@std/fs";
import {
  listDiscoveryLeftovers,
  removeDiscoveryTempDir,
} from "@discovery/DiscoveryTempDirRemoval.ts";

/** Creates a populated discovery-style temp directory. */
function makeTempDir(): string {
  const dir = Deno.makeTempDirSync({ prefix: "discovery-temp-removal-" });
  ensureDirSync(`${dir}/chunks`);
  Deno.writeTextFileSync(`${dir}/discovery_data.parquet`, "parquet");
  Deno.writeTextFileSync(`${dir}/chunks/chunk-0.bin`, "chunk");
  return dir;
}

/** Removes a directory if it survived a test. */
function forceRemove(dir: string): void {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch {
    // Already gone.
  }
}

Deno.test("removeDiscoveryTempDir removes a populated directory", async () => {
  const dir = makeTempDir();
  try {
    await removeDiscoveryTempDir(dir);
    assertEquals(listDiscoveryLeftovers(dir), []);
    assert(
      !existsSync(dir),
      `Expected ${dir} to be removed`,
    );
  } finally {
    forceRemove(dir);
  }
});

Deno.test("removeDiscoveryTempDir succeeds when the directory is already gone", async () => {
  const dir = makeTempDir();
  await Deno.remove(dir, { recursive: true });
  // Must not throw — another cleanup winning the race is not a failure.
  await removeDiscoveryTempDir(dir);
});

Deno.test("removeDiscoveryTempDir reports failure and names the leftover file", async () => {
  const dir = makeTempDir();
  try {
    // Reproduce the production race: the recursive walk empties the directory
    // while a writer creates another file, so the final rmdir sees ENOTEMPTY.
    const racingRemove = (path: string): Promise<void> => {
      Deno.writeTextFileSync(`${path}/late-writer.tmp`, "still writing");
      return Promise.reject(
        new Error(`Directory not empty (os error 66): remove '${path}'`),
      );
    };

    const error = await assertRejects(
      () =>
        removeDiscoveryTempDir(dir, {
          remove: racingRemove,
          attempts: 2,
          retryDelayMs: 0,
        }),
      Error,
    );

    assertStringIncludes(error.message, dir);
    assertStringIncludes(error.message, "late-writer.tmp");
    assertStringIncludes(error.message, "os error 66");
  } finally {
    forceRemove(dir);
  }
});

Deno.test("removeDiscoveryTempDir reports failure when removal claims success but the directory survives", async () => {
  const dir = makeTempDir();
  try {
    const error = await assertRejects(
      () =>
        removeDiscoveryTempDir(dir, {
          // Resolves without removing anything — "no error" is not success.
          remove: () => Promise.resolve(),
          attempts: 1,
          retryDelayMs: 0,
        }),
      Error,
    );
    assertStringIncludes(error.message, dir);
    assertStringIncludes(error.message, "discovery_data.parquet");
  } finally {
    forceRemove(dir);
  }
});

Deno.test("removeDiscoveryTempDir retries a transient failure then succeeds", async () => {
  const dir = makeTempDir();
  try {
    let calls = 0;
    await removeDiscoveryTempDir(dir, {
      remove: (path: string) => {
        calls++;
        if (calls === 1) {
          return Promise.reject(
            new Error(`Directory not empty (os error 66): remove '${path}'`),
          );
        }
        return Deno.remove(path, { recursive: true });
      },
      attempts: 3,
      retryDelayMs: 0,
    });
    assertEquals(calls, 2);
    assert(!existsSync(dir), `Expected ${dir} to be removed on the retry`);
  } finally {
    forceRemove(dir);
  }
});

Deno.test("listDiscoveryLeftovers walks nested entries and honours the limit", () => {
  const dir = makeTempDir();
  try {
    const all = listDiscoveryLeftovers(dir);
    assert(
      all.includes("discovery_data.parquet"),
      `Expected the parquet file in ${JSON.stringify(all)}`,
    );
    assert(
      all.includes("chunks/chunk-0.bin"),
      `Expected the nested chunk in ${JSON.stringify(all)}`,
    );

    assertEquals(listDiscoveryLeftovers(dir, 1).length, 1);
    assertEquals(listDiscoveryLeftovers(dir, 0).length, 0);
    assertEquals(listDiscoveryLeftovers(`${dir}/does-not-exist`), []);
  } finally {
    forceRemove(dir);
  }
});

/** Reports whether a path exists, without throwing. */
function existsSync(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
