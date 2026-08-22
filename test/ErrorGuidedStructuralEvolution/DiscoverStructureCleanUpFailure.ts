/**
 * Regression tests for discovery temp-dir cleanup failure reporting (GRQ #4241).
 *
 * `cleanUp()` used to swallow a failed `Deno.remove(tempDir, { recursive:
 * true })` into a warn line and resolve, so the caller logged `Discovery <id>
 * cleanup complete.` over a directory that was still on disk. It must now
 * reject, naming the leftover entries, and resolve only when the directory is
 * genuinely gone.
 */

import { assert, assertRejects, assertStringIncludes } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";

function makeMinimalCreature(): Creature {
  const exportJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.75 },
    ],
  };

  const creature = Creature.fromJSON(exportJSON);
  CreatureUtil.makeUUID(creature);
  creature.validate();
  return creature;
}

/** Reports whether a path exists, without throwing. */
function existsSync(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "cleanUp rejects when a stray file keeps the temp dir alive",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const creature = makeMinimalCreature();
    const baseDirectory = await Deno.makeTempDir({
      prefix: "discovery-cleanup-failure-",
    });
    const tempDir = `${baseDirectory}/${creature.uuid}`;

    // Reproduce the observed failure: a writer outside the set cleanup knows
    // about drops a file into the temp dir, so the removal reports ENOTEMPTY.
    const racingRemove = (dir: string): Promise<void> => {
      Deno.writeTextFileSync(`${dir}/late-writer.tmp`, "still writing");
      return Promise.reject(
        new Error(`Directory not empty (os error 66): remove '${dir}'`),
      );
    };

    const discovery = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
      {
        isRustDiscoveryEnabled: () => true,
        removeTempDir: racingRemove,
      },
      { baseDirectory },
    );

    try {
      discovery.initialize(new Map<number, Promise<void>>());

      const error = await assertRejects(() => discovery.cleanUp(), Error);
      assertStringIncludes(error.message, tempDir);
      assertStringIncludes(error.message, "late-writer.tmp");
      assert(
        existsSync(tempDir),
        "The temp dir is still on disk — that is what the failure reports",
      );
    } finally {
      await Deno.remove(baseDirectory, { recursive: true });
    }
  },
});

Deno.test({
  name: "cleanUp resolves and removes the temp dir on the happy path",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const creature = makeMinimalCreature();
    const baseDirectory = await Deno.makeTempDir({
      prefix: "discovery-cleanup-success-",
    });
    const tempDir = `${baseDirectory}/${creature.uuid}`;

    const discovery = new DiscoverStructure(
      creature,
      5,
      DEFAULT_RUST_FLUSH_RECORDS,
      { isRustDiscoveryEnabled: () => true },
      { baseDirectory },
    );

    try {
      discovery.initialize(new Map<number, Promise<void>>());
      // A non-empty directory must still be removed — the removal is recursive.
      await Deno.writeTextFile(`${tempDir}/discovery_data.parquet`, "parquet");

      await discovery.cleanUp();

      assert(!existsSync(tempDir), `Expected ${tempDir} to be removed`);
    } finally {
      await Deno.remove(baseDirectory, { recursive: true });
    }
  },
});
