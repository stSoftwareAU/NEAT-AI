/**
 * Configuration for minimum candidates per discovery category.
 *
 * This allows fine-tuning how many candidates from each category are evaluated.
 */
export interface DiscoveryMinCandidatesPerCategory {
  /** Minimum candidates for add-neurons category. Default: 1 */
  addNeurons?: number;
  /** Minimum candidates for add-synapses category. Default: 1 */
  addSynapses?: number;
  /** Minimum candidates for change-squash category. Default: 1 */
  changeSquash?: number;
  /** Minimum candidates for remove-low-impact category. Default: 3 */
  removeLowImpact?: number;
}
