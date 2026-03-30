/**
 * Regression for GRQ-24-sloth.log (Issue #2086): corrupt JSON with NO_INWARD
 * plus duplicate (from,to). `loadFrom` now merges duplicate endpoints and
 * runs orphan cleanup for forward-only NO_INWARD (see GRQ-25). Offline JSON
 * tooling may still call `mergeDuplicateSynapses()` before `fromJSON` — that
 * remains valid and idempotent for duplicate rows.
 *
 * @see https://github.com/stSoftwareAU/NEAT-AI/issues/2086
 */
import { assert } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { mergeDuplicateSynapses } from "@compact/CompactUtils.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test(
  "GRQ-24-sloth: corrupt JSON is valid after fromJSON (load-time merge + orphan repair)",
  async () => {
    await initWasmForTests();

    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 2,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "orphan-hidden",
          squash: "IDENTITY",
          bias: 0,
        },
        { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        // Hidden at index 2: has outward edge only — no inward (NO_INWARD).
        { fromUUID: "orphan-hidden", toUUID: "output-0", weight: 0.1 },
        // Same (from,to) as two rows with different `type` — duplicate endpoints.
        { fromUUID: "input-0", toUUID: "h1", weight: 0.2, type: "condition" },
        { fromUUID: "input-0", toUUID: "h1", weight: 0.3 },
        { fromUUID: "input-1", toUUID: "h1", weight: 0.4 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json, true);

    creature.validate({ forwardOnly: true });

    mergeDuplicateSynapses(json);
    const creatureAfterOfflineMerge = Creature.fromJSON(json, true);
    creatureAfterOfflineMerge.validate({ forwardOnly: true });

    const seen = new Set<string>();
    for (const s of creature.synapses) {
      const key = `${s.from}->${s.to}`;
      assert(!seen.has(key), `duplicate synapse endpoints ${key}`);
      seen.add(key);
    }

    seen.clear();
    for (const s of creatureAfterOfflineMerge.synapses) {
      const key = `${s.from}->${s.to}`;
      assert(!seen.has(key), `duplicate synapse endpoints ${key}`);
      seen.add(key);
    }
  },
);
