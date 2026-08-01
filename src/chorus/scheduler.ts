import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CHORUS_CONFIG, reservationFor } from "./config";
import {
  getActiveSection,
  getState,
  listIdentityUtterances,
  listUtterances,
  nextBeatNumber,
  reconcileBudget,
  recordError,
  releaseLease,
  reserveBudget,
  saveUtterance,
  setState,
  tryAcquireLease,
} from "./db";
import { getSection } from "./sections";
import {
  conservativeUnknownAttemptCost,
  generateMock,
  generateWithOpenRouter,
} from "./model";
import { selectIdentity, selectModel } from "./selection";

export type BeatResult =
  "generated" | "not-leader" | "paused" | "killed" | "failed";

export function isMockMode() {
  if (process.env.CHORUS_MOCK_MODE === "true") return true;
  if (process.env.CHORUS_MOCK_MODE === "false") return false;
  return !process.env.OPENROUTER_API_KEY;
}

export async function runGenerationBeat(
  db: DatabaseSync,
  ownerId: string,
  now = Date.now(),
): Promise<BeatResult> {
  if (process.env.CHORUS_KILL_SWITCH === "true") {
    setState(db, "activity", "listening");
    setState(db, "pause_reason", "kill_switch");
    return "killed";
  }
  if (!tryAcquireLease(db, ownerId, now)) return "not-leader";

  const beat = nextBeatNumber(db);
  const model = selectModel(beat);
  const requestId = randomUUID();
  const reservation = isMockMode() ? 0 : reservationFor(model);
  const budget = reserveBudget(db, requestId, model.id, reservation, now);
  if (!budget.allowed) {
    setState(db, "activity", "listening");
    setState(db, "pause_reason", "rolling_budget");
    return "paused";
  }

  const section = getSection(getActiveSection(db, now));
  const selected = selectIdentity(db, section.id, beat);
  const recent = listUtterances(db, section.id, 0, 2);
  const ownPrior = listIdentityUtterances(db, selected.id, 0, 3);
  const identity = {
    id: selected.id,
    name: selected.name,
    worldview: selected.worldview,
    memory: selected.memory,
    relationships: JSON.parse(selected.relationships_json) as string[],
  };
  setState(db, "activity", "forming a response");
  setState(db, "pause_reason", "");

  try {
    const result = isMockMode()
      ? await generateMock(
          {
            model,
            identity,
            section,
            sharedMemory: getState(db, "shared_memory"),
            recent,
            ownPrior,
          },
          beat,
        )
      : await generateWithOpenRouter({
          model,
          identity,
          section,
          sharedMemory: getState(db, "shared_memory"),
          recent,
          ownPrior,
        });
    const unknownRetryCost =
      result.failedAttempts * conservativeUnknownAttemptCost(model);
    reconcileBudget(
      db,
      requestId,
      model.id,
      reservation,
      result.actualCostUsd + unknownRetryCost,
      result.usage,
    );
    saveUtterance(
      db,
      randomUUID(),
      result.output,
      model.id,
      result.usage,
      Date.now(),
    );
    setState(
      db,
      "shared_memory",
      `The chorus last gathered around ${section.label.toLowerCase()}. ${identity.name} spoke in a ${result.output.mood} mood: ${result.output.utterance}`.slice(
        0,
        420,
      ),
    );
    setState(db, "activity", "reading");
    return "generated";
  } catch (error) {
    // Keep the conservative reservation charged: a timed-out provider request may still be billable.
    reconcileBudget(db, requestId, model.id, reservation, reservation, {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
    });
    const message = error instanceof Error ? error.message : String(error);
    recordError(db, model.id, "generation_failed", message);
    setState(db, "activity", "listening");
    return "failed";
  }
}

export async function runWorker(
  db: DatabaseSync,
  options: { once?: boolean; signal?: AbortSignal } = {},
) {
  const ownerId = `${process.pid}:${randomUUID()}`;
  const waitFor = (milliseconds: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timeout = setTimeout(finish, milliseconds);
      options.signal?.addEventListener("abort", finish, { once: true });
    });
  try {
    if (!options.once) {
      const lastBeatStartedAt = Number(
        getState(db, "last_beat_started_at", "0"),
      );
      const initialWait = Math.max(
        0,
        CHORUS_CONFIG.cadenceMs - (Date.now() - lastBeatStartedAt),
      );
      if (lastBeatStartedAt > 0 && initialWait > 0) await waitFor(initialWait);
    }
    do {
      if (options.signal?.aborted) break;
      const started = Date.now();
      setState(db, "last_beat_started_at", String(started));
      await runGenerationBeat(db, ownerId, started);
      if (options.once) break;
      const remaining = Math.max(
        100,
        CHORUS_CONFIG.cadenceMs - (Date.now() - started),
      );
      await waitFor(remaining);
    } while (!options.signal?.aborted);
  } finally {
    releaseLease(db, ownerId);
  }
}
