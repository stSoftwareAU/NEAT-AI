/**
 * Shared fixtures for the racing tests (Issue #3928).
 *
 * The racing suites all need the same three things: a forward-only population
 * the batch scorer accepts, a tiny corpus to point it at, and a worker handler
 * that records whether the per-creature path was reached. Kept in one place so
 * a change to the batch-eligibility rules moves one file, not four.
 *
 * Not a test file itself — it declares no `Deno.test`, so the runner imports it
 * only as a dependency of the suites that use it.
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";

/** `--help` text of a scorer binary that carries the racing surface. */
export const HELP_WITH_RACING =
  "Options:\n      --cost <NAME>\n      --race-stdio\n      --gpu <MODE>\n";

/** `--help` text of a binary predating NEAT-AI-scorer#308's stdio surface. */
export const HELP_WITHOUT_RACING =
  "Options:\n      --cost <NAME>\n      --gpu <MODE>\n";

/** A four-record dataset — enough to make a real data directory. */
export function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 4; i++) {
    rows.push({
      input: new Float32Array([i, 4 - i]),
      output: new Float32Array([i > 2 ? 1 : -1]),
    });
  }
  return rows;
}

/**
 * `count` distinct forward-only creatures, each with a UUID already assigned
 * so the batch bridge can use it as the on-disk filename stem.
 */
export function buildForwardOnlyPopulation(count: number): Creature[] {
  const base: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
    forwardOnly: true,
  };
  const creatures: Creature[] = [];
  for (let i = 0; i < count; i++) {
    const forked = structuredClone(base);
    forked.neurons[0].bias = 0.1 * (i + 1);
    const creature = Creature.fromJSON(forked);
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
  }
  return creatures;
}

/**
 * Worker stand-in that counts evaluations. In the racing suites a non-zero
 * count means work leaked off the batch path.
 */
export class MockWorkerHandler {
  public evaluateCallCount = 0;
  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  // deno-lint-ignore require-await
  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluateCallCount++;
    return { evaluate: { error: 0.5 } };
  }
}

/** Map each creature's UUID to the error the scorer should report for it. */
export function errorsFor(
  population: readonly Creature[],
  errors: readonly number[],
): Map<string, number> {
  const map = new Map<string, number>();
  population.forEach((creature, i) => map.set(creature.uuid!, errors[i]));
  return map;
}
