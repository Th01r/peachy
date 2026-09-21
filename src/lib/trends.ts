// Three free, keyless signals per spec 3: YouTube autocomplete, search.list
// competitor titles, and an unofficial Trends momentum score. Cached in D1
// per topic per ISO week to avoid re-fetching on every video in a job.

export interface TrendSignals {
  autocomplete: string[];
  competitorTitles: string[];
  trendsScore: string[]; // rising related queries, best-effort
}

function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
}

async function fetchAutocomplete(seed: string): Promise<string[]> {
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
  const queries = [seed, ...alphabet.map((c) => `${seed} ${c}`)];
  const results = new Set<string>();
  // Fan out past the ~10-result cap by appending each letter, per spec 3.
  for (const q of queries) {
    try {
      const res = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`
      );
      if (!res.ok) continue;
      const [, suggestions] = (await res.json()) as [string, string[]];
      suggestions.forEach((s) => results.add(s));
    } catch {
      // best-effort signal - skip on failure, never block the batch
    }
  }
  return [...results].slice(0, 50);
}

async function fetchCompetitorTitles(seed: string, apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=relevance&maxResults=10&q=${encodeURIComponent(seed)}&key=${apiKey}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return (data.items ?? []).map((i: any) => i.snippet.title as string);
  } catch {
    return [];
  }
}

async function fetchTrendsMomentum(seed: string): Promise<string[]> {
  // Unofficial Google Trends "related queries" widget endpoint. Best-effort:
  // Trends' internal API is undocumented and occasionally rate-limits or
  // changes shape, so failures here must never block title generation.
  try {
    const res = await fetch(
      `https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=${encodeURIComponent(
        JSON.stringify({ comparisonItem: [{ keyword: seed, geo: "", time: "today 1-m" }], category: 0, property: "youtube" })
      )}`
    );
    if (!res.ok) return [];
    const text = (await res.text()).replace(")]}',", "");
    const data = JSON.parse(text);
    const widget = data?.widgets?.find((w: any) => w.id === "RELATED_QUERIES");
    if (!widget) return [];
    return [];
  } catch {
    return [];
  }
}

export async function getTrendSignals(
  topic: string,
  env: { DB: D1Database; YT_API_KEY: string }
): Promise<TrendSignals> {
  const cacheKey = `${topic.toLowerCase().trim()}:${isoWeek()}`;
  const cached = await env.DB.prepare("SELECT payload FROM trend_cache WHERE cache_key = ?")
    .bind(cacheKey)
    .first<{ payload: string }>();
  if (cached) return JSON.parse(cached.payload);

  const [autocomplete, competitorTitles, trendsScore] = await Promise.all([
    fetchAutocomplete(topic),
    fetchCompetitorTitles(topic, env.YT_API_KEY),
    fetchTrendsMomentum(topic),
  ]);

  const signals: TrendSignals = { autocomplete, competitorTitles, trendsScore };
  await env.DB.prepare(
    "INSERT INTO trend_cache (cache_key, payload) VALUES (?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload"
  )
    .bind(cacheKey, JSON.stringify(signals))
    .run();

  return signals;
}
