import type { APIRoute } from "astro";
import { CHORUS_CONFIG } from "../../../chorus/config";
import { currentRollingSpend, getDatabase, getState } from "../../../chorus/db";
import { isAdmin, json } from "../../../chorus/http";

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  if (!isAdmin(request))
    return json({ error: "unauthorized" }, { status: 401 });
  const db = getDatabase();
  const since = Date.now() - CHORUS_CONFIG.rollingWindowMs;
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS request_count, COALESCE(AVG(prompt_tokens), 0) AS avg_prompt,
		COALESCE(AVG(completion_tokens), 0) AS avg_completion, COALESCE(AVG(reasoning_tokens), 0) AS avg_reasoning
		FROM budget_events WHERE kind = 'reconciliation' AND created_at > ?`,
    )
    .get(since);
  const models = db
    .prepare(
      `SELECT model_id, COUNT(*) AS count FROM budget_events
		WHERE kind = 'reconciliation' AND created_at > ? GROUP BY model_id ORDER BY count DESC`,
    )
    .all(since);
  const errors = db
    .prepare(
      `SELECT code, COUNT(*) AS count, MAX(created_at) AS latest FROM generation_errors
		WHERE created_at > ? GROUP BY code ORDER BY count DESC`,
    )
    .all(since);
  const pauseReason = getState(db, "pause_reason");
  return json({
    rolling24hSpendUsd: currentRollingSpend(db),
    targetBudgetUsd: CHORUS_CONFIG.targetBudgetUsd,
    safetyCutoffUsd: CHORUS_CONFIG.safetyCutoffUsd,
    generationPaused: Boolean(pauseReason),
    pauseReason: pauseReason || null,
    activity: getState(db, "activity", "listening"),
    totals,
    modelDistribution: models,
    errors,
  });
};
