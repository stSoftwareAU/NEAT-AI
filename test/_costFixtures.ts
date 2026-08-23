/**
 * Shared deterministic creature + dataset used by the cost-aggregation tests
 * (Issue #3853).
 *
 * Outputs are `LOGISTIC`, so every value lands in (0, 1), and every target is a
 * positive value inside the same interval. That keeps all seven built-in costs
 * — including `MAPE`, `MSLE` and `CROSS_ENTROPY`, which are undefined or
 * clamped at zero — finite and comparable between engines.
 *
 * The per-record error is deliberately uneven: alternate records get an easy
 * and a hard target so `mean(sqrt(e))` and `sqrt(mean(e))` are separated by far
 * more than float noise. A dataset of identical per-record errors would make
 * the RMSE aggregation tests pass either way.
 */
import { Creature } from "../mod.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";

/** Input neuron count of the fixture creature. */
export const FIXTURE_INPUTS = 3;
/** Output neuron count of the fixture creature. */
export const FIXTURE_OUTPUTS = 2;
/** Record count of the fixture dataset. */
export const FIXTURE_RECORDS = 64;

/**
 * Deterministic creature: 3 inputs → 2 hidden (TANH) → 2 outputs (LOGISTIC).
 *
 * @param forwardOnly - When false the creature gains a self-loop, so it is
 *   genuinely recurrent and `evaluateDir` takes the per-record path instead of
 *   the fused WASM batch path.
 */
export function buildFixtureCreature(forwardOnly: boolean): Creature {
  const hiddenBase = FIXTURE_INPUTS;
  const outputBase = FIXTURE_INPUTS + 2;
  const neurons: CreatureInternal["neurons"] = [];
  const synapses: CreatureInternal["synapses"] = [];

  for (let h = 0; h < 2; h++) {
    neurons.push({
      type: "hidden",
      index: hiddenBase + h,
      bias: h === 0 ? 0.25 : -0.4,
      squash: "TANH",
    });
    for (let i = 0; i < FIXTURE_INPUTS; i++) {
      synapses.push({
        from: i,
        to: hiddenBase + h,
        weight: 0.3 + 0.17 * i - 0.11 * h,
      });
    }
  }

  for (let o = 0; o < FIXTURE_OUTPUTS; o++) {
    neurons.push({
      type: "output",
      index: outputBase + o,
      bias: o === 0 ? -0.15 : 0.35,
      squash: "LOGISTIC",
    });
    for (let h = 0; h < 2; h++) {
      synapses.push({
        from: hiddenBase + h,
        to: outputBase + o,
        weight: 0.9 - 0.4 * h + 0.25 * o,
      });
    }
  }

  if (!forwardOnly) {
    synapses.push({ from: hiddenBase, to: hiddenBase, weight: 0.2 });
  }

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: FIXTURE_INPUTS,
    output: FIXTURE_OUTPUTS,
  });
  creature.forwardOnly = forwardOnly;
  return creature;
}

/**
 * Fixture dataset with deliberately uneven per-record error.
 *
 * Every target sits above the creature's output range (which spans roughly
 * 0.57 … 0.84), because `MSLE` is the signed `log(target) - log(output)` and
 * the native scorer rejects a negative average error outright. Alternating
 * rows still keep the per-record error spread wide.
 */
export function buildFixtureDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let r = 0; r < FIXTURE_RECORDS; r++) {
    const t = r / FIXTURE_RECORDS;
    rows.push({
      input: new Float32Array([t, 1 - t, (t * 3) % 1]),
      output: new Float32Array(
        r % 2 === 0 ? [0.99, 0.97] : [0.87 + 0.08 * t, 0.86 + 0.09 * t],
      ),
    });
  }
  return rows;
}
