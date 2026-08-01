import type { APIRoute } from "astro";
import { getDatabase, recordSectionSignal } from "../../../chorus/db";
import { clientAddress, json, rateLimit } from "../../../chorus/http";
import { ESSAY_SECTIONS } from "../../../chorus/sections";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const address = clientAddress(request);
  if (!rateLimit(`signal:${address}`, 60, 60_000))
    return json({ error: "rate_limited" }, { status: 429 });
  const body = (await request.json().catch(() => null)) as {
    sectionId?: string;
    sessionId?: string;
  } | null;
  if (
    !body?.sectionId ||
    !ESSAY_SECTIONS.some((section) => section.id === body.sectionId)
  )
    return json({ error: "invalid_section" }, { status: 400 });
  if (!body.sessionId || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.sessionId))
    return json({ error: "invalid_session" }, { status: 400 });
  recordSectionSignal(
    getDatabase(),
    `${address}:${body.sessionId}`,
    body.sectionId,
  );
  return json({ ok: true });
};
