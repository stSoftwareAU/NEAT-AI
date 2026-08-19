/**
 * SquashBudgetConfig.ts - Opt-in squash budget / activation prior for mutation
 * (Issue #3263).
 *
 * CPU scoring cost scales with the 34-type squash zoo (dispatch + libm mix),
 * and the GPU scorer directory only hosts a small activation set. If mutation
 * freely invents rare or expensive squashes, every kernel win is partially
 * undone by the next generation's mix.
 *
 * This config lets an operator restrict which activation (squash) functions
 * mutation and neuron creation may introduce. It is an **evolutionary prior**,
 * not a kernel change: the default is the free 34-type mix (empty allow-list),
 * so existing runs are unaffected.
 */

/**
 * Configuration for the opt-in squash budget.
 */
export interface SquashBudgetConfig {
  /**
   * Hard allow-list of squash (activation) names that mutation and neuron
   * creation may use. Names may be canonical (e.g. `"TANH"`) or aliases
   * (e.g. `"RELU"`); aliases are canonicalised when the budget is applied.
   *
   * An empty array (the default) means **no restriction** — the free 34-type
   * mix. When non-empty, `Activations.pickRandomSquash` only ever returns a
   * squash from this set, so a disallowed activation can never be introduced.
   *
   * Unknown names fail loud at configuration time (Issue #3234).
   */
  allowedSquashes?: string[];

  /**
   * Issue #3797: pin every **output** neuron to this squash (activation).
   * The name may be canonical (e.g. `"TANH"`) or an alias (e.g. `"RELU"`).
   *
   * When set, output neurons keep this squash through every mutation path —
   * `MOD_SQUASH` skips them and any other rewrite resolves back to the pin —
   * and an imported seed whose output neurons disagree is normalised to it
   * with a warning rather than silently diverging (Issue #3234). Hidden
   * neurons are unaffected.
   *
   * Use it when the training target is bounded (e.g. -1..1 pairs naturally
   * with `TANH`) and evolving the output activation only creates false paths.
   *
   * An empty string (the default) means **no pin** — today's behaviour, where
   * output squashes evolve like hidden ones. Unknown names fail loud at
   * configuration time.
   */
  fixedOutputSquash?: string;
}

/**
 * Required version of {@link SquashBudgetConfig} with all fields populated.
 */
export type RequiredSquashBudgetConfig = Required<SquashBudgetConfig>;

/**
 * Default values for the squash budget: an empty allow-list, i.e. the free
 * mix, and no output-squash pin. The feature is opt-in and off by default.
 */
export const DEFAULT_SQUASH_BUDGET_CONFIG: RequiredSquashBudgetConfig = {
  allowedSquashes: [],
  fixedOutputSquash: "",
};
