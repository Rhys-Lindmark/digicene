import { describe, expect, it } from "vitest";
import { sanitizeText } from "../src/chorus/safety";

describe("sanitizeText", () => {
  it("removes every HTML delimiter from nested tag input", () => {
    expect(sanitizeText("<<script>alert(1)<</script>", 320)).toBe(
      "scriptalert(1)/script",
    );
  });

  it("removes control characters and enforces the character limit", () => {
    expect(sanitizeText("safe\u0000 text", 6)).toBe("safe t");
  });
});
