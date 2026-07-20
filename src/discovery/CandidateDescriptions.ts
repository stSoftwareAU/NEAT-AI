/**
 * Candidate Descriptions Module
 *
 * Handles emoji selection and human-readable description generation
 * for discovery candidates and their combinations.
 *
 * Extracted from DiscoveryCandidates.ts as part of #1473.
 */

import type { CoordinatedStructuralOperation } from "@architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";

/**
 * Abbreviates a long, hyphenated UUID to its last 8 characters, keeping short
 * human-readable ids intact.
 *
 * Issue #1691: the previous guard sliced the last 8 characters of the *whole*
 * id whenever it was longer than 15 chars and contained a `-`. That mangled a
 * short numeric neuron id such as `neuron-876870118` into `76870118` — dropping
 * both the `neuron-` prefix and the leading digit. A canonical UUID has four
 * hyphen-separated groups, so abbreviate only when the id carries at least two
 * dashes; a single-dash `prefix-number` label is rendered whole.
 */
export function shortID(id: string): string {
  let dashCount = 0;
  for (let i = 0; i < id.length; i++) {
    if (id[i] === "-") dashCount++;
  }
  if (id.length > 15 && dashCount >= 2) {
    return id.slice(-8);
  }
  return id;
}

/**
 * User-facing line when a coordinated-structural candidate applies exactly one
 * operation — matches the specificity of other discovery candidate descriptions.
 */
export function describeSingleCoordinatedStructuralOperation(
  op: CoordinatedStructuralOperation,
): string {
  switch (op.type) {
    case "removeSynapse":
      return `✂️ Removed synapse ${shortID(op.fromNeuronUuid)} -> ${
        shortID(op.toNeuronUuid)
      }`;
    case "addSynapse":
      return `🔗 Added synapse ${shortID(op.fromNeuronUuid)} -> ${
        shortID(op.toNeuronUuid)
      }`;
    case "setWeight":
      return `⚙️ Set synapse weight ${shortID(op.fromNeuronUuid)} -> ${
        shortID(op.toNeuronUuid)
      }`;
    case "addNeuron":
      return `💡 Added neuron ${shortID(op.neuronUuid)} (${op.squash})`;
    case "removeNeuron":
      return `🗑️ Removed neuron ${shortID(op.neuronUuid)}`;
    case "changeSquash":
      return `🎨 Changed activation for ${
        shortID(op.neuronUuid)
      } -> ${op.squash}`;
    case "setBias":
      return `📐 Set neuron bias ${shortID(op.neuronUuid)}`;
    default:
      return "🧩 Structural change";
  }
}

/**
 * Emoji legend for discovery candidates (unique emoji per category):
 *
 * **Single Candidates:**
 * - 💡 Add neuron(s)
 * - 🔗 Add synapse(s)
 * - 🎨 Change activation function
 * - 🪶 Remove low-impact neuron
 * - 💀 Remove harmful neuron
 * - ✂️ Remove harmful synapse
 *
 * **Coordinated structural (single operation from Rust):**
 * - ✂️ Remove synapse, 🔗 Add synapse, ⚙️ Set synapse weight
 * - 💡 Add neuron, 🗑️ Remove neuron
 * - 🎨 Change activation, 📐 Set neuron bias
 *
 * **Combination Candidates:**
 * - ✂️ Pruning only (multiple removals)
 * - 🌱 Growth only (add neurons + synapses)
 * - 🧬 Structural changes only (add without removal)
 * - 🦋 Metamorphosis (removal + addition)
 * - ⚡ Optimisation (change squash + other)
 * - 🏆 Multi-category combination (3+ types)
 */

/**
 * Select an appropriate emoji for the combination based on change types.
 * Each combination category has a unique emoji to distinguish at a glance.
 *
 * Module-private helper: only consumed internally by
 * `buildCombinationDescription` (Issue #3150 — dropped the unused `export`).
 */
function selectCombinationEmoji(types: string[]): string {
  const typeSet = new Set(types);
  const hasRemoval = typeSet.has("remove-low-impact") ||
    typeSet.has("remove-neuron") ||
    typeSet.has("remove-synapse") ||
    typeSet.has("cache-informed-removal");
  const hasAddition = typeSet.has("add-neurons") || typeSet.has("add-synapses");
  const hasSquashChange = typeSet.has("change-squash");

  // Multi-category combinations (3+ distinct types)
  if (typeSet.size >= 3) {
    return "🏆"; // Achievement - comprehensive improvement
  }

  // Metamorphosis: removal + addition (structural transformation)
  if (hasRemoval && hasAddition) {
    return "🦋"; // Metamorphosis - shedding old, gaining new
  }

  // Optimisation: squash change + other changes
  if (hasSquashChange && (hasRemoval || hasAddition)) {
    return "⚡"; // Optimisation - performance tuning
  }

  // Pure removal combinations (pruning)
  if (hasRemoval && !hasAddition && !hasSquashChange) {
    return "✂️"; // Pruning - trimming excess
  }

  // Pure addition combinations (growth)
  if (hasAddition && !hasRemoval && !hasSquashChange) {
    if (typeSet.has("add-neurons") && typeSet.has("add-synapses")) {
      return "🌱"; // Growing - adding neurons and connections
    }
    return "🧬"; // Structural - adding structure
  }

  // Squash-only combinations
  if (hasSquashChange && !hasRemoval && !hasAddition) {
    return "🎭"; // Transformation - changing behaviour
  }

  return "🔬"; // Generic scientific discovery
}

/**
 * Build a human-readable description for a combination of changes.
 * Uses proper grammar suitable for git commit messages.
 *
 * @param appliedTypes The types of changes that were applied
 * @param appliedCount The number of changes applied
 * @param isRemovalOnly Whether all changes are removal operations
 */
export function buildCombinationDescription(
  appliedTypes: string[],
  appliedCount: number,
  isRemovalOnly: boolean,
): string {
  const emoji = selectCombinationEmoji(appliedTypes);

  // Single type combinations - use specific descriptions
  // IMPORTANT: Check this BEFORE isRemovalOnly to handle remove-synapse correctly
  if (appliedTypes.length === 1) {
    const type = appliedTypes[0];
    switch (type) {
      case "add-neurons":
        return `${emoji} Added ${appliedCount} neurons`;
      case "add-synapses":
        return `${emoji} Added ${appliedCount} synapses`;
      case "change-squash":
        return `${emoji} Changed ${appliedCount} activation functions`;
      case "remove-low-impact":
      case "remove-neuron":
      case "cache-informed-removal":
        return `${emoji} Pruned ${appliedCount} low-impact neurons`;
      case "remove-synapse":
        return `${emoji} Removed ${appliedCount} synapses`;
      default:
        return `${emoji} Applied ${appliedCount} ${type} changes`;
    }
  }

  // Multi-type pure removal combinations (neuron removals) - use "Pruned" verb
  // Note: This is for combinations of remove-low-impact, remove-neuron types
  // but NOT for pure remove-synapse combinations (handled above as single-type)
  if (isRemovalOnly) {
    // Check if this is synapse-only removal combination
    const isSynapseOnly = appliedTypes.every((t) => t === "remove-synapse");
    if (isSynapseOnly) {
      return `${emoji} Removed ${appliedCount} synapses`;
    }
    // Mixed removal types or neuron-only removals
    return `${emoji} Pruned ${appliedCount} low-impact neurons`;
  }

  // Multi-type combinations - describe the overall effect
  const hasRemoval = appliedTypes.some((t) =>
    t.includes("remove") || t === "remove-low-impact" ||
    t === "cache-informed-removal"
  );
  const hasAddition = appliedTypes.some((t) =>
    t === "add-neurons" || t === "add-synapses"
  );
  const hasSquash = appliedTypes.includes("change-squash");

  if (hasRemoval && hasAddition) {
    return `${emoji} Restructured network: pruned and expanded`;
  }
  if (hasSquash && (hasRemoval || hasAddition)) {
    return `${emoji} Optimised network structure and activations`;
  }
  if (hasAddition) {
    return `${emoji} Expanded network with new structure`;
  }

  return `${emoji} Applied ${appliedCount} structural improvements`;
}
