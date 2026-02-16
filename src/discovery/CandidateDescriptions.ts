/**
 * Candidate Descriptions Module
 *
 * Handles emoji selection and human-readable description generation
 * for discovery candidates and their combinations.
 *
 * Extracted from DiscoveryCandidates.ts as part of #1473.
 */

/** Returns the last 8 characters of a UUID or the full ID if short. */
export function shortID(id: string): string {
  if (id.length > 15 && id.includes("-")) {
    return id.slice(-8);
  }
  return id;
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
 */
export function selectCombinationEmoji(types: string[]): string {
  const typeSet = new Set(types);
  const hasRemoval = typeSet.has("remove-low-impact") ||
    typeSet.has("remove-neuron") ||
    typeSet.has("remove-synapse");
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
    t.includes("remove") || t === "remove-low-impact"
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
