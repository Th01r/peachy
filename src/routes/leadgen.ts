import { Hono } from "hono";
import type { Env } from "../index";
import { getPublicVideo } from "../lib/youtube";
import { getTranscript } from "../lib/transcript";
import { getTrendSignals } from "../lib/trends";
import { createLLM } from "../lib/llm";

export const leadgen = new Hono<{ Bindings: Env }>();

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

leadgen.post("/sample", async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  const videoId = extractVideoId(url ?? "");
  if (!videoId) return c.json({ error: "Not a valid YouTube video URL" }, 400);

  const video = await getPublicVideo(videoId, c.env.YT_API_KEY);
  if (!video) return c.json({ error: "Video not found or not public" }, 404);

  const [transcript, trends] = await Promise.all([
    getTranscript(videoId),
    getTrendSignals(video.snippet.title, c.env),
  ]);

  const llm = createLLM(c.env);
  const newTitle = await llm.generateTitle({
    currentTitle: video.snippet.title,
    description: video.snippet.description ?? "",
    transcriptExcerpt: transcript.text,
    style: "direct_seo",
    angle: "curiosity_gap",
    competitorTitles: trends.competitorTitles,
    trendingKeywords: trends.autocomplete,
  });

  await c.env.DB.prepare(
    "INSERT INTO leadgen_samples (id, youtube_video_id, original_title, generated_title) VALUES (?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), videoId, video.snippet.title, newTitle)
    .run();

  return c.json({ originalTitle: video.snippet.title, suggestedTitle: newTitle });
});
