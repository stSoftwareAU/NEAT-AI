/**
 * Unit tests for CandidateDescriptions.
 *
 * Issue #3150: `selectCombinationEmoji` is a module-private helper (no longer
 * exported). Its emoji-selection behaviour is verified here through the public
 * `buildCombinationDescription` API, which prefixes every description with the
 * emoji chosen for the supplied change types. Covers each combination category.
 */

import { assert, assertEquals } from "@std/assert";
import {
  buildCombinationDescription,
  describeSingleCoordinatedStructuralOperation,
  shortID,
} from "@discovery/CandidateDescriptions.ts";

Deno.test("shortID - truncates long UUID to last 8 chars", () => {
  assertEquals(shortID("abcdef12-3456-7890-abcd-ef1234567890"), "34567890");
});

Deno.test("shortID - returns short ids unchanged", () => {
  assertEquals(shortID("short"), "short");
});

Deno.test("shortID - keeps a single-dash numeric neuron id intact (Issue #1691)", () => {
  // Regression: `neuron-876870118` used to be mangled to `76870118` (the
  // `neuron-` prefix and the leading digit dropped). A single-dash label is
  // rendered whole; only multi-dash hyphenated UUIDs are abbreviated.
  assertEquals(shortID("neuron-876870118"), "neuron-876870118");
});

Deno.test("buildCombinationDescription - 3+ types uses 🏆 emoji", () => {
  const out = buildCombinationDescription(
    ["add-neurons", "remove-neuron", "change-squash"],
    3,
    false,
  );
  assert(out.startsWith("🏆"), `expected 🏆 prefix, got: ${out}`);
});

Deno.test("buildCombinationDescription - removal + addition uses 🦋 emoji", () => {
  const out = buildCombinationDescription(
    ["remove-neuron", "add-neurons"],
    2,
    false,
  );
  assert(out.startsWith("🦋"), `expected 🦋 prefix, got: ${out}`);
});

Deno.test("buildCombinationDescription - squash + removal uses ⚡ emoji", () => {
  const out = buildCombinationDescription(
    ["change-squash", "remove-neuron"],
    2,
    false,
  );
  assert(out.startsWith("⚡"), `expected ⚡ prefix, got: ${out}`);
});

Deno.test("buildCombinationDescription - pure neuron removal uses ✂️ emoji", () => {
  // Multi-type pure-removal combination (not a single remove-synapse type).
  const out = buildCombinationDescription(
    ["remove-neuron", "remove-low-impact"],
    4,
    true,
  );
  assert(out.startsWith("✂️"), `expected ✂️ prefix, got: ${out}`);
  assertEquals(out, "✂️ Pruned 4 low-impact neurons");
});

Deno.test("buildCombinationDescription - neurons + synapses uses 🌱 emoji", () => {
  const out = buildCombinationDescription(
    ["add-neurons", "add-synapses"],
    2,
    false,
  );
  assert(out.startsWith("🌱"), `expected 🌱 prefix, got: ${out}`);
});

Deno.test("buildCombinationDescription - single add-neurons describes count", () => {
  // Pure addition without paired synapses selects the 🧬 structural emoji.
  assertEquals(
    buildCombinationDescription(["add-neurons"], 3, false),
    "🧬 Added 3 neurons",
  );
});

Deno.test("buildCombinationDescription - single remove-synapse describes count", () => {
  assertEquals(
    buildCombinationDescription(["remove-synapse"], 5, true),
    "✂️ Removed 5 synapses",
  );
});

Deno.test("describeSingleCoordinatedStructuralOperation - addNeuron", () => {
  const out = describeSingleCoordinatedStructuralOperation({
    type: "addNeuron",
    neuronUuid: "abcdef12-3456-7890-abcd-ef1234567890",
    squash: "TANH",
  } as never);
  assertEquals(out, "💡 Added neuron 34567890 (TANH)");
});
