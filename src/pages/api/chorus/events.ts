import type { APIRoute } from "astro";
import { getDatabase, listUtterances } from "../../../chorus/db";
import { clientAddress, rateLimit } from "../../../chorus/http";
import { toClientUtterance } from "../../../chorus/types";

export const prerender = false;

const encoder = new TextEncoder();

export const GET: APIRoute = ({ request }) => {
  if (!rateLimit(`sse:${clientAddress(request)}`, 20, 60_000))
    return new Response("rate limited", { status: 429 });
  let after = Number(request.headers.get("last-event-id") || 0);
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const poll = () => {
        for (const utterance of listUtterances(
          getDatabase(),
          undefined,
          after,
          30,
        )) {
          after = Math.max(after, utterance.createdAt);
          send(
            `id: ${utterance.createdAt}\nevent: utterance\ndata: ${JSON.stringify(toClientUtterance(utterance))}\n\n`,
          );
        }
      };
      send("retry: 2500\nevent: connected\ndata: {}\n\n");
      poll();
      const interval = setInterval(poll, 1_000);
      const heartbeat = setInterval(() => send(": listening\n\n"), 15_000);
      const lifetime = setTimeout(() => {
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
        controller.close();
      }, 55_000);
      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          clearInterval(interval);
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
        { once: true },
      );
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
};
