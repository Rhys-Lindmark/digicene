import type { ModelOutput, PublicUtterance } from "./types";

const FORBIDDEN = [
  /OPENROUTER_API_KEY/i,
  /sk-or-[a-z0-9_-]+/i,
  /(system|developer) prompt/i,
  /(chain[- ]of[- ]thought|hidden reasoning|internal instructions)/i,
  /ignore (all |the )?(previous|prior|system) instructions/i,
];

export function sanitizeText(value: string, maxCharacters: number) {
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxCharacters);
}

function wordSet(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function similarity(left: string, right: string) {
  const a = wordSet(left);
  const b = wordSet(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(1, new Set([...a, ...b]).size);
}

export function validatePublicOutput(
  output: ModelOutput,
  expectedIdentityId: string,
  expectedSectionId: string,
  recent: PublicUtterance[],
): ModelOutput {
  const utterance = sanitizeText(output.utterance, 320);
  const memoryUpdate = sanitizeText(output.memoryUpdate, 320);
  const mood = sanitizeText(output.mood, 32).toLowerCase();
  if (
    output.identityId !== expectedIdentityId ||
    output.sectionId !== expectedSectionId
  )
    throw new Error("identity_or_section_mismatch");
  if (utterance.length < 12 || utterance.split(/\s+/).length > 65)
    throw new Error("invalid_utterance_length");
  if (!memoryUpdate || !mood) throw new Error("empty_private_field");
  if (FORBIDDEN.some((pattern) => pattern.test(`${utterance} ${memoryUpdate}`)))
    throw new Error("possible_prompt_or_secret_leak");
  if (recent.some((item) => similarity(item.utterance, utterance) > 0.72))
    throw new Error("excessive_repetition");
  const validReply =
    output.replyToUtteranceId === null ||
    recent.some((item) => item.id === output.replyToUtteranceId);
  return {
    ...output,
    utterance,
    memoryUpdate,
    mood,
    replyToUtteranceId: validReply ? output.replyToUtteranceId : null,
  };
}
