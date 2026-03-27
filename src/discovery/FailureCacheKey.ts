/**
 * Failure Cache Key Module
 *
 * Deterministic cache key generation for discovery candidates,
 * including structural signature building and weight magnitude formatting.
 *
 * Extracted from FailureCache.ts as part of #1598.
 */

import { join } from "@std/path/join";
import { crypto as stdCrypto } from "@std/crypto";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";
import { TopologyError } from "../errors/TopologyError.ts";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";

/**
 * Extracts the exponent from a number's scientific notation.
 * This allows similar weights (same order of magnitude) to map to the same cache key.
 *
 * @param value - The number to extract the exponent from
 * @returns The exponent (e.g., 0.001 -> -3, 100 -> 2)
 */
export function extractExponent(value: number): number {
  if (value === 0) return -999; // Sentinel for zero
  const absValue = Math.abs(value);
  return Math.floor(Math.log10(absValue));
}

/**
 * Formats a weight/bias using only its exponent for cache key generation.
 * This ensures that weights with the same order of magnitude produce the same key.
 *
 * @param weight - The weight or bias value
 * @returns A string like "e-3" or "e2"
 */
export function formatWeight(weight: number): string {
  const exp = extractExponent(weight);
  return `e${exp}`;
}

/**
 * Builds a deterministic cache key for a discovery candidate.
 *
 * The key incorporates:
 * - Change type
 * - For neuron removal: just the neuron UUID (simple, fast lookup)
 * - For synapse removal: just the from/to UUIDs
 * - For other types: structural information and weight magnitudes
 *
 * @param candidate - The discovery candidate to generate a key for
 * @returns A string suitable for use as a cache filename
 */
export function buildCacheKey(candidate: DiscoveryCandidate): string {
  const parts: string[] = [candidate.change.type];

  // Handle different candidate types
  switch (candidate.change.type) {
    case "coordinated-structural": {
      const spec = candidate.change.coordinatedStructuralCandidate;
      if (spec?.operations && Array.isArray(spec.operations)) {
        // Coordinated structural candidates frequently represent "adjust weight"
        // operations as remove+add on the same synapse. We intentionally bucket
        // addSynapse weights by exponent so keys remain stable under normal
        // evolutionary weight drift and do not explode the cache with near
        // duplicates.
        const opKey = `coordinated:` + spec.operations.map((op) => {
          if (!op || typeof op !== "object") return JSON.stringify(op);
          const t = (op as { type?: string }).type;
          if (t === "removeSynapse") {
            const o = op as {
              fromNeuronId?: number;
              toNeuronId?: number;
            };
            return `removeSynapse:${o.fromNeuronId ?? "?"}->${
              o.toNeuronId ?? "?"
            }`;
          }
          if (t === "addSynapse") {
            const o = op as {
              fromNeuronId?: number;
              toNeuronId?: number;
              weight?: number;
            };
            const w = typeof o.weight === "number"
              ? formatWeight(o.weight)
              : "?";
            return `addSynapse:${o.fromNeuronId ?? "?"}->${
              o.toNeuronId ?? "?"
            }:w${w}`;
          }
          if (t === "addNeuron") {
            const o = op as {
              neuronId?: number;
              neuronType?: string;
              squash?: string;
              bias?: number;
              insertBeforeNeuronId?: number;
            };
            const b = typeof o.bias === "number" ? formatWeight(o.bias) : "?";
            return `addNeuron:${o.neuronId ?? "?"}:type${
              o.neuronType ?? "?"
            }:s${o.squash ?? "?"}:b${b}:before${o.insertBeforeNeuronId ?? "-"}`;
          }
          if (t === "removeNeuron") {
            const o = op as { neuronId?: number };
            return `removeNeuron:${o.neuronId ?? "?"}`;
          }
          if (t === "changeSquash") {
            const o = op as { neuronId?: number; squash?: string };
            return `changeSquash:${o.neuronId ?? "?"}:s${o.squash ?? "?"}`;
          }
          if (t === "setBias") {
            const o = op as { neuronId?: number; bias?: number };
            const b = typeof o.bias === "number" ? formatWeight(o.bias) : "?";
            return `setBias:${o.neuronId ?? "?"}:b${b}`;
          }
          return JSON.stringify(op);
        }).join("|");
        parts.push(stableShortHash(opKey));
      } else {
        parts.push(buildStructuralSignature(candidate));
      }
      break;
    }

    case "add-neurons": {
      // For add-neurons, use neuronDetails if available
      const details = candidate.change.neuronDetails;
      if (details) {
        parts.push(
          String(details.fromNeuronId),
          String(details.toNeuronId),
          details.squash,
          formatWeight(details.incomingWeight),
          formatWeight(details.outgoingWeight),
          formatWeight(details.bias),
        );
      } else {
        // Fallback: use creature structure
        parts.push(buildStructuralSignature(candidate));
      }
      break;
    }

    case "remove-low-impact":
    case "remove-neuron": {
      // For neuron removal, prefer the neuron ID from description.
      // If removal failed once, it won't succeed until the creature structure changes
      // significantly (at which point the cache should be cleared anyway).
      const idMatch = candidate.change.description?.match(
        /neuron\s+(\d+)/i,
      );
      if (idMatch) {
        parts.push(idMatch[1]);
      } else {
        // Fallback: use structural signature to avoid cache collisions
        parts.push(buildStructuralSignature(candidate));
      }
      break;
    }

    case "cache-informed-removal": {
      // Multi-neuron removal: use structural signature since multiple neurons
      // are removed and the combination matters for cache identity.
      parts.push(buildStructuralSignature(candidate));
      break;
    }

    case "remove-synapse": {
      // For synapse removal, use from/to UUIDs from synapseDetails.
      // synapseDetails is always set for remove-synapse candidates created by
      // buildDiscoveryCandidates - assert to catch any future code changes.
      const synapseDetails = candidate.change.synapseDetails;
      if (!synapseDetails) {
        throw new TopologyError(
          "remove-synapse candidate missing synapseDetails - this indicates a bug",
          "INVALID_STATE",
        );
      }
      parts.push(
        String(synapseDetails.fromNeuronId),
        String(synapseDetails.toNeuronId),
      );
      break;
    }

    case "change-squash": {
      // For squash changes, include the squash function names from description
      // and a structural signature
      parts.push(buildStructuralSignature(candidate));
      break;
    }

    case "add-synapses":
    default: {
      // For synapses and other types, use structural signature
      parts.push(buildStructuralSignature(candidate));
      break;
    }
  }

  // Create a safe filename from the key parts
  return sanitiseForFilename(parts.join("_"));
}

function stableShortHash(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const buffer = stdCrypto.subtle.digestSync("SHA-1", bytes);
  const hashBytes = new Uint8Array(buffer);
  return [...hashBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds a structural signature from the creature's neurons and synapses.
 * Uses exponents for weights/biases to group similar structures together.
 *
 * Includes both hidden and output neurons (sorted by ID for determinism).
 * Input neurons are excluded as they have no squash/bias.
 */
function buildStructuralSignature(candidate: DiscoveryCandidate): string {
  const exported = structuredClone(
    candidate.creature.exportJSON(),
  ) as CreatureExport;
  normaliseCreatureExport(exported);
  const sigParts: string[] = [];

  // Include neuron signatures (ID, squash, bias exponent)
  // Filter to hidden and output neurons, then sort by ID for determinism
  const relevantNeurons = exported.neurons
    .filter((n) => n.type === "hidden" || n.type === "output")
    .sort((a, b) => (a as { id: number }).id - (b as { id: number }).id);

  for (const neuron of relevantNeurons) {
    sigParts.push(
      `n:${(neuron as { id: number }).id}:${neuron.squash}:${
        formatWeight(neuron.bias)
      }`,
    );
  }

  // Include synapse signatures (from->to, weight exponent)
  // Sort for determinism
  const sortedSynapses = [...exported.synapses].sort((a, b) => {
    const keyA = `${(a as { fromId: number }).fromId}->${
      (a as { toId: number }).toId
    }`;
    const keyB = `${(b as { fromId: number }).fromId}->${
      (b as { toId: number }).toId
    }`;
    return keyA.localeCompare(keyB);
  });

  for (const synapse of sortedSynapses) {
    sigParts.push(
      `s:${(synapse as { fromId: number }).fromId}->${
        (synapse as { toId: number }).toId
      }:${formatWeight(synapse.weight)}`,
    );
  }

  return sigParts.join("|");
}

/**
 * Converts a string to a safe filename by replacing invalid characters.
 */
function sanitiseForFilename(value: string): string {
  // Replace characters not allowed in filenames with underscores
  // Keep alphanumeric, hyphens, underscores, and dots
  return value
    .replace(/[^a-zA-Z0-9_\-.]/g, "_")
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, "") // Remove leading/trailing underscores
    .slice(0, 200); // Limit length for filesystem compatibility
}

/**
 * Gets the cache file path for a candidate.
 */
export function getCacheFilePath(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): string {
  const key = buildCacheKey(candidate);
  const typeDir = candidate.change.type;
  return join(cacheDir, typeDir, `${key}.json`);
}
