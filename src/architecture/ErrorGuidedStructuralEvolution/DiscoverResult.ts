import type {
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "./DiscoverStructure.ts";

export interface DiscoverResult {
  ID: string;
  addHelpfulSynapses: CandidateSynapse[] | undefined;
  addHelpfulNeurons: CandidateNeuron[] | undefined;
  removeHarmfulSynapse: CandidateSynapse | undefined;

  candidateSquashes: CandidateSquash[] | undefined;
}
