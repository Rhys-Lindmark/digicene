import { describe, expect, it } from "vitest";
import { CHORUS_CONFIG } from "../src/chorus/config";
import { buildSmoothSchedule } from "../src/chorus/selection";

describe("deterministic weighted model schedule", () => {
  it("uses only the pinned low-cost model", () => {
    const schedule = buildSmoothSchedule(CHORUS_CONFIG.models);
    const counts = Object.fromEntries(
      CHORUS_CONFIG.models.map((model) => [
        model.id,
        schedule.filter((item) => item.id === model.id).length,
      ]),
    );
    expect(schedule).toHaveLength(100);
    expect(counts).toEqual({
      "z-ai/glm-4.7-flash": 100,
    });
  });

  it("keeps every beat on the selected model", () => {
    const schedule = buildSmoothSchedule(CHORUS_CONFIG.models);
    expect(schedule.every((model) => model.id === "z-ai/glm-4.7-flash")).toBe(
      true,
    );
  });
});
