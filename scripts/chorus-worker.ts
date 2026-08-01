import { getDatabase } from "../src/chorus/db";
import { isMockMode, runWorker } from "../src/chorus/scheduler";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

console.log(
  `[chorus] worker starting (${isMockMode() ? "mock" : "OpenRouter"} mode)`,
);
await runWorker(getDatabase(), {
  once: process.argv.includes("--once"),
  signal: controller.signal,
});
console.log("[chorus] worker stopped");
