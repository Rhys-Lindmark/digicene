import type { APIRoute } from "astro";
import { getDatabase, hideUtterance } from "../../../chorus/db";
import { isAdmin, json } from "../../../chorus/http";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isAdmin(request))
    return json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    id?: string;
  } | null;
  if (!body?.id || !/^[a-zA-Z0-9-]{10,80}$/.test(body.id))
    return json({ error: "invalid_id" }, { status: 400 });
  return json({ hidden: hideUtterance(getDatabase(), body.id) });
};
