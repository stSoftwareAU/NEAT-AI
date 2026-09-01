/**
 * Barrier semantics between a discovery cleanup and a later writer to the same
 * run directory (GRQ #4609).
 *
 * Ordering is asserted from observed events — what the writer saw when it ran —
 * never from elapsed time.
 */

import { assert, assertEquals } from "@std/assert";
import {
  awaitDiscoveryCleanup,
  trackDiscoveryCleanup,
} from "@discovery/DiscoveryCleanupBarrier.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

Deno.test("awaitDiscoveryCleanup releases the writer only once the cleanup has finished", async () => {
  const id = "barrier-ordered";
  let cleanupDone = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  trackDiscoveryCleanup(
    id,
    gate.then(() => {
      cleanupDone = true;
    }),
  );

  let sawCleanupDone: boolean | undefined;
  const writer = awaitDiscoveryCleanup(id).then(() => {
    sawCleanupDone = cleanupDone;
  });

  release();
  await writer;

  assertEquals(
    sawCleanupDone,
    true,
    "the writer ran while the cleanup was still in flight",
  );
});

Deno.test("awaitDiscoveryCleanup is a no-op for a discovery with no cleanup in flight", async () => {
  await awaitDiscoveryCleanup("barrier-untracked");
});

Deno.test("a failed cleanup still releases the barrier and is not re-thrown", async () => {
  const id = "barrier-failed-cleanup";
  trackDiscoveryCleanup(
    id,
    Promise.reject(new Error("Discovery temp dir cleanup failed")),
  );

  // The removal has finished, however it ended; the writer decides what to do
  // with whatever it finds on disk.
  await awaitDiscoveryCleanup(id);
});

Deno.test("a cleanup that never settles is announced and does not wedge the writer", async () => {
  const id = "barrier-hung-cleanup";
  const logs: string[] = [];
  const original = getLogger();
  const capturing: Logger = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    error: () => {},
  };
  setLogger(capturing);

  let release!: () => void;
  const neverSettlesUntilTestEnds = new Promise<void>((resolve) => {
    release = resolve;
  });
  trackDiscoveryCleanup(id, neverSettlesUntilTestEnds);

  try {
    // The bound, not the wall clock, is what the writer relies on: a zero
    // budget expires on the first turn.
    await awaitDiscoveryCleanup(id, 0);
    assert(
      logs.some((line) => line.includes("cleanup still running")),
      `expected the expiry to be announced, got: ${JSON.stringify(logs)}`,
    );
  } finally {
    setLogger(original);
    release();
    await neverSettlesUntilTestEnds;
  }
});

Deno.test("a settled cleanup no longer holds anything back", async () => {
  const id = "barrier-settled";
  trackDiscoveryCleanup(id, Promise.resolve());
  await awaitDiscoveryCleanup(id);
  // Registered again for the same ID: the second cleanup is the one that holds.
  trackDiscoveryCleanup(id, Promise.resolve());
  await awaitDiscoveryCleanup(id);
});
