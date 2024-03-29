/*******************************************************************************
                                      CONFIG
*******************************************************************************/
import {
  CreatureExport,
  CreatureInternal,
} from "../architecture/CreatureInterfaces.ts";
import { MutationInterface } from "../methods/mutation.ts";
import { SelectionInterface } from "../methods/Selection.ts";
import { TrainOptions } from "./TrainOptions.ts";

export interface NeatOptions extends TrainOptions {
  costName?: string;
  /** How many new links to create during the creative thinking phase */
  creativeThinkingConnectionCount?: number;

  /** The directory to store the creatures (optional) */
  creatureStore?: string;

  /** number of records per dataset file. default: 2000 */
  dataSetPartitionBreak?: number;

  /** debug (much slower) */
  debug?: boolean;

  /** The directory to store the experiments (optional) */
  experimentStore?: string;

  /** List of creatures to start with */
  creatures?: CreatureInternal[] | CreatureExport[];

  /**
   * Feedback loop ( previous result feeds back into next interaction
   * https://www.mathworks.com/help/deeplearning/ug/design-time-series-narx-feedback-neural-networks.html;jsessionid=2d7fa2c64f0bd39c86dec46870cd
   */
  feedbackLoop?: boolean;

  /** The list of observations to focus one */
  focusList?: number[];

  /** Focus rate */
  focusRate?: number;

  /** Cost of growth */
  costOfGrowth?: number;
  elitism?: number;

  /** Once the number of minutes are reached exit the loop. */
  timeoutMinutes?: number;

  /** the number of training per generation. default: 1  */
  trainPerGen?: number;

  /** The maximum number of connections */
  maxConns?: number;

  /** The maximum number of nodes */
  maximumNumberOfNodes?: number;

  /** Number of changes per Gene */
  mutationAmount?: number;

  /** Probability of changing a gene */
  mutationRate?: number;

  /** The target population size. 50 by default */
  populationSize?: number;

  /** the number of workers */
  threads?: number;

  selection?: SelectionInterface;
  mutation?: MutationInterface[];

  iterations?: number;
  log?: number;
  /** verbose logging default: false */
  verbose?: boolean;
}
