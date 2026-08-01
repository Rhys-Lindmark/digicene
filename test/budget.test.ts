import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHORUS_CONFIG } from "../src/chorus/config";
import {
  currentRollingSpend,
  openDatabase,
  reconcileBudget,
  reserveBudget,
} from "../src/chorus/db";

const databases: ReturnType<typeof openDatabase>[] = [];
function freshDatabase() {
  const db = openDatabase(
    join(mkdtempSync(join(tmpdir(), "chorus-budget-")), "test.db"),
  );
  databases.push(db);
  return db;
}
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe("rolling budget ledger", () => {
  it("reserves atomically against the target and never admits work near the cutoff", () => {
    const db = freshDatabase();
    expect(
      reserveBudget(db, "one", CHORUS_CONFIG.models[0].id, 0.84, 1_000).allowed,
    ).toBe(true);
    expect(
      reserveBudget(db, "two", CHORUS_CONFIG.models[0].id, 0.02, 1_001).allowed,
    ).toBe(false);
    expect(currentRollingSpend(db, 1_001)).toBeCloseTo(0.84);
    expect(currentRollingSpend(db, 1_001)).toBeLessThan(
      CHORUS_CONFIG.legalMaximumUsd,
    );
  });

  it("reconciles to actual provider cost and includes fallback reasoning cost", () => {
    const db = freshDatabase();
    reserveBudget(db, "one", CHORUS_CONFIG.models[0].id, 0.1, 2_000);
    reconcileBudget(
      db,
      "one",
      CHORUS_CONFIG.models[0].id,
      0.1,
      0.025,
      { promptTokens: 500, completionTokens: 60, reasoningTokens: 10 },
      2_001,
    );
    expect(currentRollingSpend(db, 2_001)).toBeCloseTo(0.025);
  });

  it("automatically frees spend after the rolling window", () => {
    const db = freshDatabase();
    reserveBudget(db, "one", CHORUS_CONFIG.models[0].id, 0.84, 10_000);
    reconcileBudget(
      db,
      "one",
      CHORUS_CONFIG.models[0].id,
      0.84,
      0.2,
      { promptTokens: 500, completionTokens: 50, reasoningTokens: 0 },
      20_000,
    );
    const later = 10_000 + CHORUS_CONFIG.rollingWindowMs + 1;
    expect(currentRollingSpend(db, later)).toBe(0);
    expect(
      reserveBudget(db, "two", CHORUS_CONFIG.models[0].id, 0.2, later).allowed,
    ).toBe(true);
  });
});
