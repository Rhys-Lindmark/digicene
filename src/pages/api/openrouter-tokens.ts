import type { APIRoute } from "astro";

export const prerender = false;

const OPENROUTER_DAILY_URL =
  "https://openrouter.ai/api/v1/datasets/rankings-daily";
const OPENROUTER_PUBLIC_URL =
  "https://openrouter.ai/api/frontend/v1/rankings/model-rankings-chart";
const DAY_MS = 86_400_000;
const CACHE_MS = 6 * 60 * 60 * 1000;

type DailyRow = {
  date: string;
  total_tokens: string;
};

type DailyResponse = {
  data: DailyRow[];
  meta: {
    as_of: string;
  };
};

type TokenSummary = {
  asOf: string;
  latestDate: string;
  latestDailyTokens: string;
  previousDate: string;
  previousDailyTokens: string;
  dailyChangeTokens: string;
  dailyChangePercent: number;
  method: "daily" | "weekly-average";
  tokensPerSecond: number;
};

type PublicWeeklyResponse = {
  data: {
    data: Array<{
      x: string;
      ys: Record<string, number>;
    }>;
  };
};

let cache: { expiresAt: number; value: TokenSummary } | undefined;

const utcDate = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control":
        status === 200
          ? "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400"
          : "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const summarize = (
  previous: [string, bigint],
  latest: [string, bigint],
  asOf: string,
  method: TokenSummary["method"],
): TokenSummary => {
  const change = latest[1] - previous[1];
  return {
    asOf,
    latestDate: latest[0],
    latestDailyTokens: latest[1].toString(),
    previousDate: previous[0],
    previousDailyTokens: previous[1].toString(),
    dailyChangeTokens: change.toString(),
    dailyChangePercent: Number((change * 10_000n) / previous[1]) / 100,
    method,
    tokensPerSecond: Number(latest[1]) / 86_400,
  };
};

const fetchPublicWeeklyAverage = async (now: number) => {
  const response = await fetch(OPENROUTER_PUBLIC_URL);
  if (!response.ok) throw new Error("Public token data unavailable");

  const payload = (await response.json()) as PublicWeeklyResponse;
  const completedWeeks = payload.data.data
    .filter((row) => Date.parse(`${row.x}T00:00:00Z`) + 7 * DAY_MS <= now)
    .map(
      (row) =>
        [
          row.x,
          BigInt(
            Math.round(
              Object.values(row.ys).reduce((total, value) => total + value, 0) /
                7,
            ),
          ),
        ] as [string, bigint],
    );
  const previous = completedWeeks.at(-2);
  const latest = completedWeeks.at(-1);
  if (!previous || !latest || previous[1] === 0n)
    throw new Error("Not enough public token data");

  return summarize(
    previous,
    latest,
    new Date(now).toISOString(),
    "weekly-average",
  );
};

export const GET: APIRoute = async () => {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return json(cache.value);

  const apiKey = import.meta.env.OPENROUTER_API_KEY;

  const latestCompletedDay = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() - 1,
  );
  const url = new URL(OPENROUTER_DAILY_URL);
  url.searchParams.set("start_date", utcDate(latestCompletedDay - 6 * DAY_MS));
  url.searchParams.set("end_date", utcDate(latestCompletedDay));

  try {
    let value: TokenSummary | undefined;

    if (apiKey) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const payload = (await response.json()) as DailyResponse;
        const totals = new Map<string, bigint>();

        for (const row of payload.data) {
          totals.set(
            row.date,
            (totals.get(row.date) ?? 0n) + BigInt(row.total_tokens),
          );
        }

        const days = [...totals.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        );
        const previous = days.at(-2);
        const latest = days.at(-1);
        if (previous && latest && previous[1] !== 0n) {
          value = summarize(previous, latest, payload.meta.as_of, "daily");
        }
      }
    }

    value ??= await fetchPublicWeeklyAverage(now);

    cache = { expiresAt: now + CACHE_MS, value };
    return json(value);
  } catch {
    return json({ error: "token_data_unavailable" }, 502);
  }
};
