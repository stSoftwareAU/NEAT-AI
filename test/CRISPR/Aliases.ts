import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CRISPR, CrisprInterface } from "../../src/reconstruct/CRISPR.ts";

Deno.test("editAliases", () => {
  const dna: CrisprInterface = {
    id: "edit test",
    mode: "insert",
    synapses: [{
      fromUUID: "abc",
      toUUID: "xyz",
      weight: 1,
    }],
  };
  const aliases: Record<string, string> = {
    "abc": "input-1",
  };

  const result = CRISPR.editAliases(dna, aliases);

  assert(result.synapses);
  const synapse = result.synapses[0];
  assertEquals(synapse.fromUUID, "input-1");
});
