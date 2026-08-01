import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, tryAcquireLease } from "../src/chorus/db";
import { runGenerationBeat } from "../src/chorus/scheduler";

const databases: ReturnType<typeof openDatabase>[] = [];
function databasePair() {
  const path = join(
    mkdtempSync(join(tmpdir(), "chorus-scheduler-")),
    "test.db",
  );
  const pair = [openDatabase(path), openDatabase(path)] as const;
  databases.push(...pair);
  return pair;
}
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe("scheduler lease", () => {
  it("has only one owner and transfers only after expiry", () => {
    const [first, second] = databasePair();
    expect(tryAcquireLease(first, "worker-a", 1_000, 500)).toBe(true);
    expect(tryAcquireLease(second, "worker-b", 1_200, 500)).toBe(false);
    expect(tryAcquireLease(second, "worker-b", 1_501, 500)).toBe(true);
  });

  it("allows only one concurrent mock generation beat", async () => {
    process.env.CHORUS_MOCK_MODE = "true";
    const [first, second] = databasePair();
    const [a, b] = await Promise.all([
      runGenerationBeat(first, "worker-a"),
      runGenerationBeat(second, "worker-b"),
    ]);
    expect([a, b].sort()).toEqual(["generated", "not-leader"]);
    const count = first
      .prepare("SELECT COUNT(*) AS count FROM utterances")
      .get() as { count: number };
    expect(count.count).toBe(1);
  });
});
