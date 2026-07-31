/**
 * Issue #2672 — Producer-gate diagnostic dump enrichment.
 *
 * When the producer-side WASM compile gate rejects a freshly bred or mutated
 * creature, the diagnostic dump must contain enough metadata to replay the
 * failure offline. These tests force a rejection via the test seam
 * `__setProducerCompileGateProbeForTesting`, run the producer path, and
 * assert that the resulting dump files (written to a directory owned by this
 * spec — Issue #3583):
 *
 *  - Use the standardised file-name prefix
 *    (`offspring-wasm-compile-trap-<uuid>` / `mutator-wasm-compile-trap-<op>-<uuid>`).
 *  - Carry the new replay-ready context fields: parent UUIDs, breed/PRNG
 *    seed, trap message, pre-fix snapshot, and (for the mutator path) the
 *    pre-mutation creature plus the operator name.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import { Mutator } from "@neat/Mutator.ts";
import { Mutation } from "@neat/Mutation.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { Offspring } from "@architecture/Offspring.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  __setProducerCompileGateProbeForTesting,
} from "@wasm/ProducerCompileGuard.ts";
import { getDiagnosticsDir } from "@utils/Diagnostics.ts";
import {
  createSeededRng,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { getGlobalDebug, setGlobalDebug } from "@globalAccessors";
import { initWasmForTests } from "../_initWasm.ts";
import { useIsolatedDiagnosticsDir } from "../_diagnosticsDir.ts";

const REJECT_PROBE = () => ({
  ok: false as const,
  trapMessage: "test-forced trap (issue #2672)",
});

interface DumpFiles {
  errorPath: string;
  errorText: string;
  contextPath: string;
  context: Record<string, unknown>;
  motherPath?: string;
  fatherPath?: string;
  offspringPath?: string;
  creaturePath?: string;
}

/** Find dump files whose name starts with prefix. */
function findDumpsByPrefix(
  prefix: string,
): {
  error: string[];
  context: string[];
  mother: string[];
  father: string[];
  offspring: string[];
  creature: string[];
} {
  const result = {
    error: [] as string[],
    context: [] as string[],
    mother: [] as string[],
    father: [] as string[],
    offspring: [] as string[],
    creature: [] as string[],
  };
  try {
    for (const entry of Deno.readDirSync(getDiagnosticsDir())) {
      if (!entry.name.startsWith(prefix)) continue;
      if (entry.name.includes("-error-")) result.error.push(entry.name);
      else if (entry.name.includes("-context-")) {
        result.context.push(entry.name);
      } else if (entry.name.includes("-mother-")) {
        result.mother.push(entry.name);
      } else if (entry.name.includes("-father-")) {
        result.father.push(entry.name);
      } else if (entry.name.includes("-offspring-")) {
        result.offspring.push(entry.name);
      } else if (entry.name.includes("-creature-")) {
        result.creature.push(entry.name);
      }
    }
  } catch {
    // ignore
  }
  return result;
}

function readDump(prefix: string): DumpFiles {
  const dir = getDiagnosticsDir();
  const dumps = findDumpsByPrefix(prefix);
  assert(
    dumps.error.length > 0,
    `expected an error dump with prefix '${prefix}', got nothing`,
  );
  assert(
    dumps.context.length > 0,
    `expected a context dump with prefix '${prefix}', got nothing`,
  );
  const errorPath = `${dir}/${dumps.error[0]}`;
  const contextPath = `${dir}/${dumps.context[0]}`;
  return {
    errorPath,
    errorText: Deno.readTextFileSync(errorPath),
    contextPath,
    context: JSON.parse(Deno.readTextFileSync(contextPath)),
    motherPath: dumps.mother[0] ? `${dir}/${dumps.mother[0]}` : undefined,
    fatherPath: dumps.father[0] ? `${dir}/${dumps.father[0]}` : undefined,
    offspringPath: dumps.offspring[0]
      ? `${dir}/${dumps.offspring[0]}`
      : undefined,
    creaturePath: dumps.creature[0] ? `${dir}/${dumps.creature[0]}` : undefined,
  };
}

function buildHealthyCreature(): Creature {
  const c = new Creature(2, 1, {
    layers: [{ count: 2, squash: "TANH" }],
  });
  c.fix();
  CreatureUtil.makeUUID(c);
  return c;
}

/**
 * Build a structurally rich, deterministically seeded creature suitable for
 * the offspring path. Two creatures built with different seeds combine via
 * `Offspring.breed` to produce a child whose UUID differs from both parents
 * — needed so the breed reaches the producer-gate instead of short-
 * circuiting at the "child is a clone of a parent" guard.
 */
function buildBreedingParent(seed: number): Creature {
  setRandomNumberGenerator(createSeededRng(seed));
  const c = new Creature(4, 2);
  c.fix();
  const op = new AddNeuron(c);
  for (let i = 0; i < 5; i++) op.mutate();
  c.fix();
  delete c.uuid;
  CreatureUtil.makeUUID(c);
  return c;
}

Deno.test(
  "Issue #2672: Offspring.breed dump uses standardised prefix and embeds replay metadata",
  async () => {
    await initWasmForTests();

    // Use a deterministic RNG so the dump records a concrete `breedSeed`.
    setRandomNumberGenerator(createSeededRng(20260515));

    // Issue #3473: the pre-fix genome export is now deferred and only runs when
    // diagnostics are enabled. Turn diagnostics on so the compile-failure dump
    // carries the genuine pre-fix snapshot (asserted below), rather than the
    // "skipped" placeholder emitted on the non-debug default path.
    const prevDebug = getGlobalDebug();
    setGlobalDebug(true);

    // Issue #3583: dumps land in a directory owned by this spec so a spec
    // running in parallel cannot supply a dump with the same prefix.
    const diagnostics = useIsolatedDiagnosticsDir("offspring-gate");
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    try {
      const mother = buildBreedingParent(100);
      const father = buildBreedingParent(999);
      const motherUuid = mother.uuid;
      const fatherUuid = father.uuid;
      assert(motherUuid, "mother must have a uuid");
      assert(fatherUuid, "father must have a uuid");
      assertNotEquals(
        motherUuid,
        fatherUuid,
        "test parents must have distinct uuids",
      );

      // Reset RNG *after* construction (Creature ctor consumes randomness)
      // so the recorded breedSeed reflects the seeded RNG at gate time.
      // Seed 2 reliably produces an offspring whose UUID differs from both
      // parents and therefore reaches the producer-gate.
      const BREED_SEED = 2;
      setRandomNumberGenerator(createSeededRng(BREED_SEED));

      const result = Offspring.breed(mother, father, { forwardOnly: true });
      assertEquals(
        result,
        undefined,
        "Offspring.breed must drop the offspring when the producer gate rejects",
      );

      const dump = readDump("offspring-wasm-compile-trap-");

      // Trap message threaded through to the error file.
      assert(
        dump.errorText.includes("test-forced trap (issue #2672)"),
        `error file should include trap message, got: ${dump.errorText}`,
      );

      // Replay context fields (Issue #2672).
      assertEquals(
        dump.context.motherUuid,
        motherUuid,
        "context.motherUuid must match the mother creature uuid",
      );
      assertEquals(
        dump.context.fatherUuid,
        fatherUuid,
        "context.fatherUuid must match the father creature uuid",
      );
      assertEquals(
        typeof dump.context.offspringUuid,
        "string",
        "context.offspringUuid must be a string",
      );
      assertEquals(
        dump.context.breedSeed,
        BREED_SEED,
        "context.breedSeed must record the active PRNG seed",
      );
      assertEquals(
        dump.context.prngSeeded,
        true,
        "context.prngSeeded must reflect the active RNG",
      );
      assertEquals(
        dump.context.trapMessage,
        "test-forced trap (issue #2672)",
        "context.trapMessage must include the validator output",
      );
      // Issue #3473: the deferred capture must still embed the genuine
      // *pre-fix* genome (not a placeholder string, and not a snapshot taken
      // after the repair steps mutated the offspring). A structured export
      // with populated neuron/synapse arrays confirms a real pre-fix genome
      // was serialised at the pre-repair capture site.
      const preFix = dump.context.preFixOffspring as {
        neurons?: unknown[];
        synapses?: unknown[];
      };
      assert(
        preFix && typeof preFix === "object" && !Array.isArray(preFix),
        "context.preFixOffspring must be a structured export, not a skipped/failed placeholder string",
      );
      assert(
        Array.isArray(preFix.neurons) && preFix.neurons.length > 0,
        "context.preFixOffspring must carry the pre-fix neurons",
      );
      assert(
        Array.isArray(preFix.synapses) && preFix.synapses.length > 0,
        "context.preFixOffspring must carry the pre-fix synapses",
      );

      // Per-creature dumps still land alongside the context.
      assert(dump.motherPath, "mother dump file must exist");
      assert(dump.fatherPath, "father dump file must exist");
      assert(dump.offspringPath, "offspring dump file must exist");
    } finally {
      restore();
      setGlobalDebug(prevDebug);
      diagnostics.dispose();
    }
  },
);

Deno.test(
  "Issue #2672: Mutator.repairAfterMutation dump uses standardised prefix and embeds replay metadata",
  async () => {
    await initWasmForTests();

    // Issue #3583: dumps land in a directory owned by this spec so a spec
    // running in parallel cannot supply a dump with the same prefix.
    const diagnostics = useIsolatedDiagnosticsDir("offspring-gate");
    const restore = __setProducerCompileGateProbeForTesting(REJECT_PROBE);
    try {
      const creature = buildHealthyCreature();
      const preMutation = creature.shallowClone();
      const mutator = new Mutator(
        createNeatConfig({
          feedbackLoop: false,
          mutationRate: 1,
          mutationAmount: 1,
          mutation: [Mutation.MOD_WEIGHT],
          log: 0,
        }),
      );
      // createNeatConfig replaces the global RNG with an unseeded one. Set
      // a deterministic seed *after* the config is built so the diagnostic
      // dump records a concrete `prngSeed` value.
      setRandomNumberGenerator(createSeededRng(20260516));

      // Mimic the call pattern from Mutator.mutate() — apply, then repair
      // with diagnostic context.
      const changed = mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
      assert(changed, "MOD_WEIGHT must report a change for the test creature");
      const repairOk = mutator.repairAfterMutation(creature, {
        preMutationSnapshot: preMutation,
        mutationName: Mutation.MOD_WEIGHT.name,
      });
      assertEquals(
        repairOk,
        false,
        "repairAfterMutation must return false when the gate rejects",
      );

      const dump = readDump(
        `mutator-wasm-compile-trap-${Mutation.MOD_WEIGHT.name}-`,
      );

      assert(
        dump.errorText.includes("test-forced trap (issue #2672)"),
        `error file should include trap message, got: ${dump.errorText}`,
      );

      assertEquals(
        dump.context.mutationName,
        Mutation.MOD_WEIGHT.name,
        "context.mutationName must record the operator that was applied",
      );
      assertEquals(
        dump.context.prngSeed,
        20260516,
        "context.prngSeed must record the active PRNG seed",
      );
      assertEquals(
        dump.context.prngSeeded,
        true,
        "context.prngSeeded must reflect the active RNG",
      );
      assertEquals(
        dump.context.trapMessage,
        "test-forced trap (issue #2672)",
        "context.trapMessage must surface the validator output",
      );
      assert(
        dump.context.preMutationCreature,
        "context.preMutationCreature must capture the snapshot taken before mutate()",
      );
      assert(
        dump.context.preFixCreature,
        "context.preFixCreature must capture the snapshot taken before fix()",
      );

      assert(dump.creaturePath, "creature dump file must exist");
    } finally {
      restore();
      diagnostics.dispose();
    }
  },
);
