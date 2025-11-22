import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "./DiscoverStructure.ts";

export interface DiscoverResult {
  ID: string;
  addHelpfulSynapses: CandidateSynapse[] | undefined;
  addHelpfulNeurons: CandidateNeuron[] | undefined;
  removeHarmfulSynapse: CandidateSynapse | undefined;
  removeHarmfulNeurons: CandidateHarmfulNeuron[] | undefined;

  candidateSquashes: CandidateSquash[] | undefined;
}
