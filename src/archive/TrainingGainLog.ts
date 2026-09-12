/**
 * TrainingGainLog.ts — the append-only record of what local search actually
 * bought, per training event (Issue #3934).
 *
 * [Jin (2011)](../../docs/comparison/REFERENCES.md) §5 treats surrogates inside
 * a *memetic* algorithm as budget allocators: local search is a large fixed cost
 * per individual, so the dominant waste is spending it on individuals that will
 * not benefit. NEAT-AI is a memetic algorithm — per-generation backpropagation
 * is its Lamarckian local search — and `selectTrainingCandidates` allocates that
 * budget purely by **current score**. Nothing has ever measured whether current
 * score predicts gain.
 *
 * This log is that measurement, and only that: it observes, and changes no
 * selection behaviour.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant E as evolution loop
 *   participant S as scheduleTraining
 *   participant L as TrainingGainLog
 *   participant W as heavy worker
 *   E->>S: candidate + rank in the sorted population
 *   S->>L: recordDispatch(creature, rank, scoreBefore)
 *   Note over L: descriptor of the *pre-training* creature,<br/>held pending
 *   S->>W: train(creature)
 *   W-->>S: trained creature / failure
 *   S->>L: recordOutcome(uuid, scoreAfter, outcome)
 *   L->>L: pending + outcome -> one record
 *   S->>L: flush() -> one append
 * ```
 *
 * Three properties hold, and every one of them is load-bearing:
 *
 * - **One event is one dispatched gradient step.** A record is written only when
 *   a step was really dispatched, and a step that failed is recorded as
 *   `failed` rather than dropped — it consumed a heavy worker slot, so omitting
 *   it would report a gain per unit wall-clock no run achieved.
 * - **The design point is the pre-training creature.** The question is which
 *   creature a gradient step will reward, so the descriptor is computed before
 *   the step, not after it.
 * - **One feature space.** Records carry their
 *   {@link EVALUATION_DESCRIPTOR_VERSION}; appending to a log whose head was
 *   written by another version is refused loudly rather than silently mixing
 *   two.
 *
 * Cost: one `O(neurons + synapses)` descriptor and one small file append per
 * gradient step — against a step that costs minutes. Measured, and asserted
 * against a budget, in `bench/TrainingGainLogOverhead.ts`.
 *
 * @module TrainingGainLog
 */

import type { Creature } from "@creature";
import {
  type RequiredTrainingGainLogConfig,
  TRAINING_GAIN_LOG_FILE_NAME,
} from "@config/TrainingGainLogConfig.ts";
import { TrainingGainLogError } from "@errors/TrainingGainLogError.ts";
import { getLogger } from "@utils/Logger.ts";
import {
  computeEvaluationDescriptor,
  EVALUATION_DESCRIPTOR_VERSION,
} from "@archive/EvaluationDescriptor.ts";
import {
  assertTrainingGainVersion,
  parseTrainingGainLine,
  toTrainingGainIoError,
  type TrainingEventOutcome,
  type TrainingGainRecord,
} from "@archive/TrainingGainRecord.ts";

/** What {@link TrainingGainLog.recordDispatch} needs at dispatch time. */
export interface TrainingDispatch {
  /** Generation the step was dispatched in. */
  readonly generation: number;
  /** Rank in the score-sorted population; `0` is the fittest. */
  readonly rank: number;
  /** Creatures the rank was taken over. */
  readonly rankedPopulation: number;
  /** Exact score the creature carries into the step. */
  readonly scoreBefore: number;
  /** Training error it carries in, when the run has it tagged. */
  readonly errorBefore?: number;
  /** Reference creature for the descriptor's genetic-distance slot. */
  readonly reference?: Creature;
}

/** What {@link TrainingGainLog.recordOutcome} needs when the step settles. */
export interface TrainingOutcome {
  /** How the step ended. */
  readonly outcome: TrainingEventOutcome;
  /** Score after the step; omit when it produced none. */
  readonly scoreAfter?: number;
  /** Error the step reported, when it reported one. */
  readonly errorAfter?: number;
}

/** A dispatch waiting for its outcome. */
interface PendingEvent {
  readonly uuid: string;
  readonly generation: number;
  readonly rank: number;
  readonly rankedPopulation: number;
  readonly scoreBefore: number;
  readonly errorBefore?: number;
  readonly referenceUuid?: string;
  readonly descriptor: readonly number[];
  readonly dispatchedAt: string;
  readonly dispatchedMs: number;
}

/**
 * Append-only log of real training events.
 *
 * Instances are created only when `trainingGainLog.enabled` is set, so the
 * default run constructs nothing and touches no disk.
 */
export class TrainingGainLog {
  private readonly config: RequiredTrainingGainLogConfig;
  /** Absolute-or-relative path of the log file. */
  readonly path: string;
  /** Monotonic-enough clock, injectable so tests need no wall-clock sleep. */
  private readonly now: () => number;

  /** Dispatches awaiting an outcome, keyed by creature UUID. */
  private readonly pending = new Map<string, PendingEvent>();

  /** Records awaiting their append. */
  private buffer: TrainingGainRecord[] = [];

  /** Records this run has appended — the `maxRecords` bound is per-run. */
  private appended = 0;

  /** Records refused because the per-run write bound was reached. */
  private refusedOverBound = 0;

  /** Dispatches declined because the creature carried no UUID. */
  private skippedUnidentified = 0;

  /** Dispatches declined because the incoming score was not finite. */
  private skippedUnscored = 0;

  /** Outcomes that arrived with no open event — counted, never silent. */
  private unmatchedOutcomes = 0;

  /** True once the head of an existing log has been version-checked. */
  private headChecked = false;

  /** Tail of the serialised append chain — see {@link flush}. */
  private writing: Promise<void> = Promise.resolve();

  constructor(
    config: RequiredTrainingGainLogConfig,
    deps?: { readonly now?: () => number },
  ) {
    this.config = config;
    this.path = `${config.directory}/${TRAINING_GAIN_LOG_FILE_NAME}`;
    this.now = deps?.now ?? Date.now;
  }

  /** Dispatches still waiting for an outcome. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Records buffered but not yet appended. */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Record that a gradient step was dispatched for `creature`.
   *
   * Synchronous and allocation-light: it computes the descriptor of the
   * pre-training creature and holds it pending. Nothing touches disk.
   *
   * A creature with no UUID is **not** logged — the record could not be joined
   * to its own outcome, let alone to any other observation of the creature, and
   * a fabricated key is worse than a missing row. Counted, not hidden.
   *
   * @param creature - The creature about to be trained.
   * @param dispatch - Rank, score, and generation of the dispatch.
   */
  recordDispatch(creature: Creature, dispatch: TrainingDispatch): void {
    const uuid = creature.uuid;
    if (uuid === undefined) {
      this.skippedUnidentified++;
      return;
    }
    // A step whose starting point is unmeasurable has no gain to report, and
    // `JSON.stringify` writes a `NaN` out as `null` — which this module's own
    // reader then refuses, taking every earlier record in the file with it.
    // Declining the event here keeps the log readable; the tally makes the
    // decline visible.
    if (!Number.isFinite(dispatch.scoreBefore)) {
      this.skippedUnscored++;
      return;
    }
    this.pending.set(uuid, {
      uuid,
      generation: dispatch.generation,
      rank: dispatch.rank,
      rankedPopulation: dispatch.rankedPopulation,
      scoreBefore: dispatch.scoreBefore,
      ...(dispatch.errorBefore !== undefined &&
          Number.isFinite(dispatch.errorBefore)
        ? { errorBefore: dispatch.errorBefore }
        : {}),
      ...(dispatch.reference?.uuid !== undefined
        ? { referenceUuid: dispatch.reference.uuid }
        : {}),
      descriptor: computeEvaluationDescriptor(creature, dispatch.reference),
      dispatchedAt: Temporal.Now.instant().toString(),
      dispatchedMs: this.now(),
    });
  }

  /**
   * Close the event a dispatch opened, buffering one record.
   *
   * @param uuid - UUID of the creature whose step settled.
   * @param outcome - How it ended, and the score it produced.
   * @throws {TrainingGainLogError} `UNKNOWN_EVENT` when no dispatch is pending
   *   for `uuid`. A gain with no design point behind it is not a smaller
   *   measurement, it is a wrong one, so this refuses rather than inventing the
   *   missing half.
   */
  recordOutcome(uuid: string, outcome: TrainingOutcome): void {
    const event = this.pending.get(uuid);
    if (event === undefined) {
      throw new TrainingGainLogError(
        `no training dispatch is pending for creature ${uuid}; refusing to ` +
          `log an outcome with no design point`,
        "UNKNOWN_EVENT",
      );
    }
    this.pending.delete(uuid);

    if (this.appended + this.buffer.length >= this.config.maxRecords) {
      this.refusedOverBound++;
      return;
    }

    this.buffer.push({
      descriptorVersion: EVALUATION_DESCRIPTOR_VERSION,
      runId: this.config.runId,
      generation: event.generation,
      uuid: event.uuid,
      rank: event.rank,
      rankedPopulation: event.rankedPopulation,
      scoreBefore: event.scoreBefore,
      ...(outcome.scoreAfter !== undefined &&
          Number.isFinite(outcome.scoreAfter)
        ? { scoreAfter: outcome.scoreAfter }
        : {}),
      ...(event.errorBefore !== undefined
        ? { errorBefore: event.errorBefore }
        : {}),
      ...(outcome.errorAfter !== undefined &&
          Number.isFinite(outcome.errorAfter)
        ? { errorAfter: outcome.errorAfter }
        : {}),
      wallClockMs: Math.max(0, this.now() - event.dispatchedMs),
      outcome: outcome.outcome,
      dispatchedAt: event.dispatchedAt,
      ...(event.referenceUuid !== undefined
        ? { referenceUuid: event.referenceUuid }
        : {}),
      descriptor: event.descriptor,
    });
  }

  /**
   * Close an event if one is open for this creature, reporting a miss.
   *
   * The production completion path can legitimately arrive with no open event —
   * the dispatch may have been declined (no UUID, no measurable starting score),
   * or a late fault may have followed an outcome already recorded. One outcome
   * per event is the invariant, so a second is not recorded; but a miss is
   * **counted and announced** at the next flush rather than absorbed, because a
   * log quietly recording fewer events than the run dispatched is the failure
   * this tally exists to surface.
   *
   * @param uuid - UUID of the creature whose step settled.
   * @param outcome - How it ended, and the score it produced.
   * @returns True when an event was open and has been closed.
   */
  closeIfOpen(uuid: string, outcome: TrainingOutcome): boolean {
    if (!this.pending.has(uuid)) {
      this.unmatchedOutcomes++;
      return false;
    }
    this.recordOutcome(uuid, outcome);
    return true;
  }

  /**
   * Forget a pending dispatch without logging an event.
   *
   * For the one case where there is genuinely nothing to measure: the run
   * abandoned the task past its hard deadline, so no outcome will ever arrive
   * and the step's cost belongs to the abandon, not to the creature.
   *
   * @param uuid - UUID of the creature whose dispatch is being dropped.
   * @returns True when a dispatch was pending and has been dropped.
   */
  abandon(uuid: string): boolean {
    return this.pending.delete(uuid);
  }

  /**
   * Append everything buffered to the log in a single write.
   *
   * A no-op when nothing is buffered, so calling it after every event costs
   * nothing on the events that logged nothing.
   *
   * @throws {TrainingGainLogError} When the existing log's head was written
   *   under a different descriptor version, or the append fails.
   */
  flush(): Promise<void> {
    // Outcomes settle on several worker promises at once, and two concurrent
    // appends to one file can interleave into a torn line. Chaining the writes
    // makes "one append per flush" true under concurrency; the caller still
    // sees its own flush's error.
    const run = this.writing.catch(() => {}).then(() => this.flushOnce());
    this.writing = run.catch(() => {});
    return run;
  }

  /** One append: the body {@link flush} serialises. */
  private async flushOnce(): Promise<void> {
    this.reportSkipped();
    if (this.buffer.length === 0) return;
    const pending = this.buffer;
    this.buffer = [];

    try {
      await Deno.mkdir(this.config.directory, { recursive: true });
      if (!this.headChecked) {
        await assertLogHeadVersion(this.path);
        this.headChecked = true;
      }
      const chunk = pending.map((record) => JSON.stringify(record)).join("\n") +
        "\n";
      await Deno.writeTextFile(this.path, chunk, { append: true });
      this.appended += pending.length;
    } catch (error) {
      // The failure is loud, and the records survive it: a caller that fixes
      // the fault and flushes again loses nothing. Discarding them here would
      // make a loud error quietly destructive.
      this.buffer = [...pending, ...this.buffer];
      throw error instanceof TrainingGainLogError
        ? error
        : toTrainingGainIoError(error, this.path, "append to");
    }
  }

  /**
   * Report, once per flush, what the log declined to record.
   *
   * A log that silently stopped writing is worse than a run that stops, so both
   * legitimate refusals are counted and announced rather than absorbed. The
   * bound message fires on the flush that follows the first refusal and then
   * again only when more are refused, so a long run past the bound says so
   * without flooding the log.
   */
  private reportSkipped(): void {
    if (this.refusedOverBound > 0) {
      getLogger().warn(
        `[NEAT-AI] Training-gain log reached its per-run bound of ` +
          `${this.config.maxRecords} records and refused ` +
          `${this.refusedOverBound} further event(s); they are not in the log.`,
      );
      this.refusedOverBound = 0;
    }
    if (this.skippedUnidentified > 0) {
      getLogger().warn(
        `[NEAT-AI] Training-gain log skipped ${this.skippedUnidentified} ` +
          `dispatch(es) for creature(s) without a UUID; those training ` +
          `events are not in the log.`,
      );
      this.skippedUnidentified = 0;
    }
    if (this.skippedUnscored > 0) {
      getLogger().warn(
        `[NEAT-AI] Training-gain log skipped ${this.skippedUnscored} ` +
          `dispatch(es) whose pre-training score was not finite; a gain cannot ` +
          `be measured from one, so those events are not in the log.`,
      );
      this.skippedUnscored = 0;
    }
    if (this.unmatchedOutcomes > 0) {
      getLogger().warn(
        `[NEAT-AI] Training-gain log saw ${this.unmatchedOutcomes} outcome(s) ` +
          `with no open event; those training events are not in the log.`,
      );
      this.unmatchedOutcomes = 0;
    }
    // A dispatch still open at a flush has no outcome yet, which is ordinary
    // mid-run. At the run-end flush it means the step never reported one, and
    // an event nobody closed is an event nobody counted: say so rather than let
    // the missing record read as a step that was never dispatched.
    if (this.pending.size > 0) {
      getLogger().warn(
        `[NEAT-AI] Training-gain log is holding ${this.pending.size} ` +
          `dispatch(es) with no outcome yet; if the run is over, those ` +
          `training events are not in the log.`,
      );
    }
  }
}

/**
 * Refuse to append to a log whose first record came from another version.
 *
 * Only the head is read, and only the first line of it. The log is appended to
 * across runs, so the question at open time is whether *this* build writes the
 * same feature space the file already holds — which the oldest record answers.
 * `readTrainingGainLog` remains the exhaustive check.
 *
 * @param path - Log file path.
 * @throws {TrainingGainLogError} When the head carries a foreign descriptor
 *   version, is malformed, or cannot be read.
 */
async function assertLogHeadVersion(path: string): Promise<void> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw toTrainingGainIoError(error, path, "open");
  }
  try {
    const buffer = new Uint8Array(64 * 1024);
    const read = await file.read(buffer);
    if (read === null || read === 0) return;
    const slice = buffer.subarray(0, read);
    const newlineAt = slice.indexOf(0x0a);
    // A head with no newline in 64 KiB is not a record this build wrote — the
    // reader would fail on it too, and failing here names the fault before more
    // is appended beneath it.
    const head = new TextDecoder().decode(
      newlineAt === -1 ? slice : slice.subarray(0, newlineAt),
    );
    assertTrainingGainVersion(parseTrainingGainLine(head, path, 1), path, 1);
  } finally {
    file.close();
  }
}
