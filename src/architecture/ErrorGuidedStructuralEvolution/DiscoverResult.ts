import type { CandidateSquash, CandidateSynapse } from "./DiscoverStructure.ts";

export interface DiscoverResult {
  ID: string;
  addHelpfulSynapses: CandidateSynapse[] | undefined;
  removeHarmfulSynapse: CandidateSynapse | undefined;

  candidateSquashes: CandidateSquash[] | undefined;
}
