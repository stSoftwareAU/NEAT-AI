/*******************************************************************************
                                      CONFIG
*******************************************************************************/
import {
  NetworkExport,
  NetworkInternal,
} from "../architecture/NetworkInterfaces.ts";
import { MutationInterface } from "../methods/mutation.ts";
import { SelectionInterface } from "../methods/Selection.ts";

export interface NeatOptions {
  /** Target error 0 to 1 */
  error?: number;

  costName?: string;
  /** How many new links to create during the creative thinking phase. default 12 */
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
  creatures?: NetworkInternal[] | NetworkExport[];

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
  growth?: number;
  elitism?: number;

  /** Once the number of minutes are reached exit the loop. */
  timeoutMinutes?: number;

  /** the number of training per generation. default: 1  */
  trainPerGen?: number;

  /** The directory to store the networks trace information (optional) */
  traceStore?: string;

  /** Tne maximum number of connections */
  maxConns?: number;

  /** Tne maximum number of nodes */
  maxNodes?: number;

  /** Number of changes per Gene */
  mutationAmount?: number;

  /** Probability of changing a gene */
  mutationRate?: number;

  /** The target population size. 50 by default */
  popSize?: number;

  /** the number of workers */
  threads?: number;

  /** the initial train rate if evolving or the rate to use when training only; default 0.01 */
  trainRate?: number;
  selection?: SelectionInterface;
  mutation?: MutationInterface[];

  iterations?: number;
  log?: number;
  /** verbose logging default: false */
  verbose?: boolean;
}
