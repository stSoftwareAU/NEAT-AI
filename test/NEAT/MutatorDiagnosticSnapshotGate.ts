/**
 * Issue #3472 — Gate the Mutator per-creature diagnostic `shallowClone()`
 * behind the debug flag.
 *
 * `Mutator.mutate()` previously deep-cloned every creature that passed the
 * mutation gate purely to seed the producer-gate diagnostic dump — an
 * O(neurons+synapses) allocation per mutated creature, per generation, on the
 * main thread. The snapshot is consumed **only** on the rare compile-failure
 * path. These tests lock in the two halves of the fix:
 *
 *  1. Happy path, diagnostics OFF (no score/memetic, MCMC off, `DEBUG` off):
 *     `Creature.shallowClone` must never be called by `mutate()`.
 *  2. Compile failure, diagnostics ON (`creature.DEBUG = true`): the diagnostic
 *     dump must still carry a correct pre-mutation snapshot.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import {
  __setProducerCompileGateProbeForTesting,
} from "@wasm/ProducerCompileGuard.ts";
import { getDiagnosticsDir } from "@utils/Diagnostics.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { useIsolatedDiagnosticsDir } from "../_diagnosticsDir.ts";

const REJECT_PROBE = () => ({
  ok: false as const,
  trapMessage: "test-forced trap (issue #3472)",
});

/** Read the context dump written by this spec for `prefix`, if any. */
function findContextDump(prefix: string): Record<string, unknown> | undefined {
  const dir = getDiagnosticsDir();
  try {
    for (const entry of Deno.readDirSync(dir)) {
      if (!entry.name.startsWith(prefix)) continue;
      if (!entry.name.includes("-context-")) continue;
      return JSON.parse(Deno.readTextFileSync(`${dir}/${entry.name}`));
    }
  } catch {
    // ignore
  }
  return undefined;
}

Deno.test(
  "Issue #3472: happy path with diagnostics off makes no shallowClone in mutate()",
  async () => {
    await initWasmForTests();

    const config = createNeatConfig({
      populationSize: 10,
      mutationRate: 1.0,
      mutationAmount: 1,
      mutation: [Mutation.MOD_WEIGHT],
      log: 0,
    });
    // Deterministic RNG so mutation selection is stable.
    setRandomNumberGenerator(createSeededRng(20260726));
    const mutator = new Mutator(config);

    // New-offspring style creatures: no score, no memetic, MCMC off, DEBUG off.
    const creatures: Creature[] = [];
    for (let i = 0; i < 5; i++) {
      const c = new Creature(3, 2, { layers: [{ count: 4 }] });
      c.DEBUG = false;
      assertEquals(c.score, undefined, "creature must have no score");
      assertEquals(c.memetic, undefined, "creature must have no memetic data");
      creatures.push(c);
    }

    const originalShallowClone = Creature.prototype.shallowClone;
    let shallowCloneCalls = 0;
    Creature.prototype.shallowClone = function (
      this: Creature,
    ): Creature {
      shallowCloneCalls++;
      return originalShallowClone.call(this);
    };

    try {
      mutator.mutate(creatures);
    } finally {
      Creature.prototype.shallowClone = originalShallowClone;
    }

    assertEquals(
      shallowCloneCalls,
      0,
      "mutate() must not shallowClone on the happy path when diagnostics are off",
    );

    // Sanity: creatures remain structurally valid after mutation.
    for (const creature of creatures) {
      assertEquals(creature.input, 3);
      assertEquals(creature.output, 2);
    }
  },
);

Deno.test(
  "Issue #3472: with DEBUG on, compile failure still records the pre-mutation snapshot",
  async () => {
    await initWasmForTests();

    // Issue #3583: own the dump directory so a spec running in parallel
    // cannot supply a dump with the same `mutator-wasm-compile-trap-` prefix.
    const diagnostics = useIsolatedDiagnosticsDir("mutator-snapshot-gate");
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    try {
      const creature = new Creature(2, 1, {
        layers: [{ count: 2, squash: "TANH" }],
      });
      creature.fix();
      CreatureUtil.makeUUID(creature);
      // Diagnostics ON — the gated clone should be taken for this creature.
      creature.DEBUG = true;

      const mutator = new Mutator(
        createNeatConfig({
          feedbackLoop: false,
          mutationRate: 1,
          mutationAmount: 1,
          mutation: [Mutation.MOD_WEIGHT],
          log: 0,
        }),
      );
      setRandomNumberGenerator(createSeededRng(20260727));

      // Full mutate() path: gate forces a compile failure, which must write a
      // diagnostic dump seeded from the gated pre-mutation snapshot.
      mutator.mutate([creature]);

      const context = findContextDump(
        `mutator-wasm-compile-trap-${Mutation.MOD_WEIGHT.name}-`,
      );
      assert(
        context !== undefined,
        "expected a diagnostic context dump for the forced compile failure",
      );
      assertEquals(
        context.mutationName,
        Mutation.MOD_WEIGHT.name,
        "context.mutationName must record the applied operator",
      );
      assert(
        context.preMutationCreature,
        "context.preMutationCreature must capture the gated pre-mutation snapshot when DEBUG is on",
      );
    } finally {
      restore();
      diagnostics.dispose();
    }
  },
);
