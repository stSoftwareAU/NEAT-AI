/**
 * ScoreProvenance.ts — a score and the data it was measured on are one fact.
 *
 * GRQ #4537. A creature's `score` tag records a measurement. The moment a
 * weight, a bias, a squash or the structure changes, that measurement no
 * longer describes the creature carrying it — but the tag used to travel on
 * regardless, because only the creature-level `uuid` was shed at the mutation
 * site. Downstream that stale number is indistinguishable from a fresh one, so
 * consumers grew workarounds to guess which it was.
 *
 * Two rules live here:
 *
 * 1. **Every in-process change sheds the score**, at the mutation site, by the
 *    same call that sheds the `uuid` — see {@link shedIdentity}. A creature
 *    that still carries a `score` tag has not been touched since it was
 *    measured, so a present score is valid for exactly this creature and an
 *    absent one means *not yet measured* rather than *unknown provenance*.
 *
 * 2. **The training-data SHA travels with the score.** {@link DATA_SHA_TAG}
 *    names the corpus the number was measured against; it is written by the
 *    same call that writes the score ({@link recordScore}) and dropped by the
 *    same call that drops it ({@link shedScore}). Neither half can outlive the
 *    other, so the pair cannot drift into a score attributed to a corpus it was
 *    never measured on.
 *
 * NEAT-AI does not invent the SHA. It identifies training data by directory
 * path only, and a digest computed here would be a *second* definition that
 * could disagree with the host's. The host supplies its own value through
 * {@link setTrainingDataSha} and NEAT-AI stamps that, so there stays exactly
 * one definition of the number.
 *
 * Absence is never faked: with no SHA configured, {@link recordScore} removes
 * any inherited `dataSha` rather than stamping a placeholder, because a wrong
 * corpus attribution is worse than none.
 *
 * @module
 */

import type { TagsInterface } from "@stsoftware/tags/mod";
import { addTag, removeTag } from "@stsoftware/tags/mod";
import { getTrainingDataSha } from "@globalAccessors";

/** Tag naming the measured fitness score. */
export const SCORE_TAG = "score";

/** Tag naming the training corpus {@link SCORE_TAG} was measured against. */
export const DATA_SHA_TAG = "dataSha";

/**
 * Anything carrying a creature-level identity alongside its tags.
 *
 * Structural rather than `Creature` so this module stays free of an import
 * cycle — every mutation site in `src/` reaches for {@link shedIdentity}.
 */
export interface IdentifiableTaggable extends TagsInterface {
  uuid?: string;
}

/**
 * Drops the recorded score and the training-data SHA it was measured on.
 *
 * Both tags go together: they are one fact, and a `dataSha` left behind would
 * claim a corpus for a score that is no longer there. Safe to call on a
 * creature that carries neither.
 */
export function shedScore(taggable: TagsInterface): void {
  removeTag(taggable, SCORE_TAG);
  removeTag(taggable, DATA_SHA_TAG);
}

/**
 * Sheds everything a change invalidates: the content-derived `uuid` and the
 * score measured before that change.
 *
 * This is the single call every in-process mutation site makes — see the
 * mutation contract in `AGENTS.md`. It replaced a bare `delete creature.uuid`,
 * which shed the identity but let the stale score ride along.
 *
 * Idempotent, and safe on a creature that was never scored.
 */
export function shedIdentity(creature: IdentifiableTaggable): void {
  delete creature.uuid;
  shedScore(creature);
}

/**
 * Records a measured score together with the corpus it was measured on.
 *
 * `dataSha` defaults to the host-configured value ({@link setTrainingDataSha}).
 * When neither is available the `dataSha` tag is *removed* rather than stamped
 * with a placeholder, so a creature never claims a corpus it cannot name.
 *
 * @param taggable the creature (or creature export) being stamped
 * @param score the measured score
 * @param dataSha overrides the host-configured training-data SHA
 */
export function recordScore(
  taggable: TagsInterface,
  score: number | string,
  dataSha?: string,
): void {
  const sha = dataSha ?? getTrainingDataSha();
  if (!sha) {
    recordScoreWithoutCorpus(taggable, score);
    return;
  }

  addTag(taggable, SCORE_TAG, `${score}`);
  addTag(taggable, DATA_SHA_TAG, sha);
}

/**
 * Records a score that was **not** measured against a training corpus —
 * episodic / reinforcement-learning rewards, and scores replayed from a
 * memetic record.
 *
 * Any inherited `dataSha` is dropped rather than carried onto the new number:
 * a corpus tag that outlived the score it described is exactly the stale claim
 * this module exists to prevent.
 */
export function recordScoreWithoutCorpus(
  taggable: TagsInterface,
  score: number | string,
): void {
  addTag(taggable, SCORE_TAG, `${score}`);
  removeTag(taggable, DATA_SHA_TAG);
}
