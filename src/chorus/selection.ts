import type { DatabaseSync } from "node:sqlite";
import { CHORUS_CONFIG, type ChorusModel } from "./config";

export function buildSmoothSchedule(models: readonly ChorusModel[]) {
  const total = models.reduce((sum, model) => sum + model.weight, 0);
  const scores = models.map(() => 0);
  const schedule: ChorusModel[] = [];
  for (let slot = 0; slot < total; slot += 1) {
    for (let index = 0; index < models.length; index += 1)
      scores[index] += models[index].weight;
    let selected = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if (scores[index] > scores[selected]) selected = index;
    }
    scores[selected] -= total;
    schedule.push(models[selected]);
  }
  return schedule;
}

const MODEL_SCHEDULE = buildSmoothSchedule(CHORUS_CONFIG.models);

export function selectModel(beat: number) {
  return MODEL_SCHEDULE[
    ((beat % MODEL_SCHEDULE.length) + MODEL_SCHEDULE.length) %
      MODEL_SCHEDULE.length
  ];
}

type IdentityRow = {
  id: string;
  name: string;
  worldview: string;
  memory: string;
  affinities_json: string;
  relationships_json: string;
  last_spoke_at: number | null;
};

export function selectIdentity(
  db: DatabaseSync,
  sectionId: string,
  beat: number,
): IdentityRow {
  const rows = db
    .prepare("SELECT * FROM identities ORDER BY id")
    .all() as unknown as IdentityRow[];
  const last = db
    .prepare(
      "SELECT identity_id FROM utterances ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { identity_id: string } | undefined;
  const eligible = rows.filter((row) => row.id !== last?.identity_id);
  const scored = eligible.map((row, index) => {
    const affinity = (JSON.parse(row.affinities_json) as string[]).includes(
      sectionId,
    )
      ? 1_000_000
      : 0;
    const recency = row.last_spoke_at ?? 0;
    const rotation = (index - beat + rows.length) % rows.length;
    return { row, score: affinity - recency - rotation };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].row;
}
