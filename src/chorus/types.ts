export type PublicUtterance = {
  id: string;
  identityId: string;
  identityName: string;
  utterance: string;
  sectionId: string;
  replyToUtteranceId: string | null;
  mood: string;
  createdAt: number;
};

export type ClientUtterance = Pick<
  PublicUtterance,
  "id" | "utterance" | "sectionId" | "createdAt"
>;

export function toClientUtterance(utterance: PublicUtterance): ClientUtterance {
  return {
    id: utterance.id,
    utterance: utterance.utterance,
    sectionId: utterance.sectionId,
    createdAt: utterance.createdAt,
  };
}

export type ModelOutput = {
  identityId: string;
  utterance: string;
  sectionId: string;
  replyToUtteranceId: string | null;
  mood: string;
  memoryUpdate: string;
};
