/**
 * Batch scorer failure diagnostics (Issue #2518).
 *
 * When the rust batch scorer rejects a generation, the raw stderr message is
 * not actionable on its own — it embeds an ephemeral temp directory path,
 * names at most a single offender, and does not surface the population's
 * `forwardOnly` composition. These helpers enrich a {@link BatchScorerError}
 * (or any wrapped scorer failure) with:
 *
 * - the offending creature UUIDs extracted from the rust scorer stderr;
 * - the same UUIDs cross-referenced against the in-memory population to add
 *   the `source` tag, `forwardOnly` flag, neuron/synapse counts, and the
 *   structural hash;
 * - population composition counters (`forwardOnly=true` vs `forwardOnly=false`)
 *   so any failure mode (INVALID_JSON, MISSING_KEYS, EXTRA_KEYS, etc.) carries
 *   the breadcrumb operators need to trace the producer of the bad creature(s).
 *
 * The output is a structured `BatchScorerDiagnostic` that callers can both
 * format into a single consolidated `error` log line and emit as a structured
 * payload to a log aggregator.
 *
 * @module BatchScorerDiagnostics
 */
import { getTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { BatchScorerError } from "./BatchScorerReconciler.ts";

/** Default cap for the per-creature detail list emitted in the log line. */
const DEFAULT_OFFENDER_DETAIL_CAP = 10;

/**
 * `forwardOnly` composition counters for a population. Any creature whose
 * `forwardOnly` flag is anything other than the literal `true` is counted as
 * recurrent — this matches the rust scorer's directory-mode contract which
 * requires `forwardOnly === true` on every creature.
 */
export interface PopulationComposition {
  forwardOnlyCount: number;
  recurrentCount: number;
}

/**
 * Compact metadata the diagnostic emits per offending creature. Only
 * non-PII identifiers and topology sizes are included so the log line stays
 * safe to emit on production aggregators.
 */
export interface OffenderMetadata {
  uuid: string;
  source?: string;
  forwardOnly: boolean;
  neuronCount: number;
  synapseCount: number;
  structuralHash: string;
  /** True when the UUID was extracted from stderr but not found in the population. */
  unknown: boolean;
}

/** Structured payload suitable for emission to a log aggregator. */
export interface BatchScorerDiagnostic {
  reason: string;
  composition: PopulationComposition;
  offendingStems: string[];
  offenders: OffenderMetadata[];
  truncated: number;
  message: string;
}

/**
 * Count `forwardOnly=true` vs `forwardOnly=false` (or unset) creatures in the
 * population. Cheap enough to call before invoking the rust scorer.
 */
export function summariseForwardOnlyComposition(
  creatures: readonly Creature[],
): PopulationComposition {
  let forwardOnlyCount = 0;
  let recurrentCount = 0;
  for (const creature of creatures) {
    if (creature.forwardOnly === true) forwardOnlyCount++;
    else recurrentCount++;
  }
  return { forwardOnlyCount, recurrentCount };
}

// Match a UUID stem inside a `Creature '...<uuid>.json'` reference. The path
// in front of the stem is ephemeral (per-invocation temp dir) so we anchor on
// the file extension and capture the immediately preceding stem segment. We
// allow either single or double quotes — and no quotes at all — because the
// rust scorer wording has shifted historically. Stems are lower-case
// canonical UUIDs (8-4-4-4-12); we accept upper-case as well to be lenient.
const CREATURE_STEM_REGEX =
  /Creature\s+['"]?[^'"\s]*?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.json['"]?/g;

/**
 * Extract every creature UUID referenced by the rust scorer's stderr or
 * stdout. Duplicates are removed but the original order is preserved so
 * operators can trace which creature was reported first.
 */
export function extractOffendingStems(text: string | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of text.matchAll(CREATURE_STEM_REGEX)) {
    const stem = match[1];
    if (!seen.has(stem)) {
      seen.add(stem);
      ordered.push(stem);
    }
  }
  return ordered;
}

/**
 * Look up a creature in the population and capture diagnostic metadata.
 * Falls back to a sparse record (`unknown: true`) when the UUID was reported
 * by stderr but is not present in the in-memory list — this can happen if a
 * caller passes a different population to the diagnostic builder than was
 * passed to the bridge.
 */
function describeCreature(
  stem: string,
  byUuid: Map<string, Creature>,
): OffenderMetadata {
  const creature = byUuid.get(stem);
  if (!creature) {
    return {
      uuid: stem,
      source: undefined,
      forwardOnly: false,
      neuronCount: 0,
      synapseCount: 0,
      structuralHash: stem,
      unknown: true,
    };
  }
  const source = getTag(creature, "source");
  return {
    uuid: creature.uuid ?? stem,
    source: source ?? undefined,
    forwardOnly: creature.forwardOnly === true,
    neuronCount: creature.neurons.length,
    synapseCount: creature.synapses.length,
    structuralHash: CreatureUtil.makeUUID(creature),
    unknown: false,
  };
}

/** Render a single offender as `uuid=<stem> source=<tag> forwardOnly=<bool>...`. */
function formatOffender(meta: OffenderMetadata): string {
  const parts: string[] = [`uuid=${meta.uuid}`];
  if (meta.source) parts.push(`source=${meta.source}`);
  parts.push(`forwardOnly=${meta.forwardOnly}`);
  parts.push(`neurons=${meta.neuronCount}`);
  parts.push(`synapses=${meta.synapseCount}`);
  if (meta.unknown) parts.push("unknown=true");
  return parts.join(" ");
}

/**
 * Build a consolidated diagnostic for a batch scorer failure. Combines the
 * stems carried on the typed error (missing/extra/malformed) with any UUIDs
 * embedded in the stderr-bearing message, then enriches each one against the
 * supplied population.
 */
export function buildBatchScorerDiagnostic(
  error: BatchScorerError | Error,
  creatures: readonly Creature[],
  options: { detailCap?: number } = {},
): BatchScorerDiagnostic {
  const cap = options.detailCap ?? DEFAULT_OFFENDER_DETAIL_CAP;
  const composition = summariseForwardOnlyComposition(creatures);

  const stems = new Set<string>();
  const ordered: string[] = [];
  const pushStem = (stem: string) => {
    if (!stem) return;
    if (stems.has(stem)) return;
    stems.add(stem);
    ordered.push(stem);
  };

  const errAny = error as BatchScorerError;
  if (Array.isArray(errAny.missingKeys)) {
    for (const k of errAny.missingKeys) pushStem(k);
  }
  if (Array.isArray(errAny.extraKeys)) {
    for (const k of errAny.extraKeys) pushStem(k);
  }
  if (Array.isArray(errAny.malformedKeys)) {
    for (const k of errAny.malformedKeys) pushStem(k);
  }
  for (const stem of extractOffendingStems(error.message)) {
    pushStem(stem);
  }

  const byUuid = new Map<string, Creature>();
  for (const creature of creatures) {
    if (creature.uuid) byUuid.set(creature.uuid, creature);
  }

  const offenders = ordered.map((stem) => describeCreature(stem, byUuid));
  const detail = offenders.slice(0, cap).map(formatOffender);
  const truncated = Math.max(0, offenders.length - cap);
  if (truncated > 0) detail.push(`+${truncated} more`);

  const reason = (errAny.reason as string | undefined) ?? "UNKNOWN";
  const message = `Batch scorer rejected ${offenders.length} creature(s) ` +
    `(forwardOnly=true=${composition.forwardOnlyCount}, ` +
    `forwardOnly=false=${composition.recurrentCount}): [${detail.join(", ")}]`;

  return {
    reason,
    composition,
    offendingStems: ordered,
    offenders,
    truncated,
    message,
  };
}
