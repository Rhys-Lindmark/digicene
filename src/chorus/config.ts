export type ChorusModel = {
  id: "z-ai/glm-4.7-flash";
  label: string;
  weight: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export const CHORUS_CONFIG = {
  cadenceMs: 5 * 60 * 1_000,
  leaseMs: 60_000,
  rollingWindowMs: 24 * 60 * 60 * 1_000,
  inputTokenTarget: 900,
  publicOutputTokenLimit: 80,
  // The public utterance is capped separately. This larger provider limit also
  // has to hold the required JSON envelope and private memory update.
  maxCompletionTokens: 256,
  temperature: 0.9,
  requestTimeoutMs: 12_000,
  maxAttempts: 2,
  retryBackoffMs: 650,
  targetBudgetUsd: 0.85,
  safetyCutoffUsd: 0.95,
  legalMaximumUsd: 1,
  reservationSafetyMultiplier: 1.35,
  models: [
    {
      id: "z-ai/glm-4.7-flash",
      label: "GLM 4.7 Flash",
      weight: 100,
      inputUsdPerMillionTokens: 0.06,
      outputUsdPerMillionTokens: 0.4,
    },
  ] satisfies ChorusModel[],
} as const;

export type ChorusModelId = (typeof CHORUS_CONFIG.models)[number]["id"];

// Prices are assumptions captured on 2026-07-31. Provider prices can change;
// verify them before production and update this single table when they do.
export function maximumCostForOneAttempt(model: ChorusModel): number {
  return (
    (model.inputUsdPerMillionTokens * CHORUS_CONFIG.inputTokenTarget +
      model.outputUsdPerMillionTokens * CHORUS_CONFIG.maxCompletionTokens) /
    1_000_000
  );
}

export function reservationFor(model: ChorusModel): number {
  return (
    maximumCostForOneAttempt(model) *
    CHORUS_CONFIG.maxAttempts *
    CHORUS_CONFIG.reservationSafetyMultiplier
  );
}
