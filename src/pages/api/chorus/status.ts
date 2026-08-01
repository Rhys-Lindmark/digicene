import type { APIRoute } from "astro";
import { getDatabase, getState } from "../../../chorus/db";
import { clientAddress, json, rateLimit } from "../../../chorus/http";

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
  if (!rateLimit(`status:${clientAddress(request)}`, 120, 60_000))
    return json({ error: "rate_limited" }, { status: 429 });
  const db = getDatabase();
  return json({
    activity: getState(db, "activity", "listening"),
    paused: Boolean(getState(db, "pause_reason")),
  });
};
