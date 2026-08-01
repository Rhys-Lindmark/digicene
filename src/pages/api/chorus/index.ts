import type { APIRoute } from "astro";
import { getDatabase, listUtterances } from "../../../chorus/db";
import { clientAddress, json, rateLimit } from "../../../chorus/http";
import { getSection } from "../../../chorus/sections";
import { toClientUtterance } from "../../../chorus/types";

export const prerender = false;

export const GET: APIRoute = ({ request, url }) => {
  if (!rateLimit(`list:${clientAddress(request)}`, 90, 60_000))
    return json({ error: "rate_limited" }, { status: 429 });
  const requested = url.searchParams.get("section");
  const sectionId = requested ? getSection(requested).id : undefined;
  return json({
    utterances: listUtterances(getDatabase(), sectionId, 0, 30).map(
      toClientUtterance,
    ),
  });
};
