import { Hono } from "hono";
import type { Env } from "../index";
import { refreshAccessToken, getVideoStats, updateVideoTitle } from "../lib/youtube";
import { decrypt } from "../lib/crypto";
import { getTranscript } from "../lib/transcript";
import { getTrendSignals } from "../lib/trends";
import { createLLM } from "../lib/llm";
import { createMailer, digestEmailHtml } from "../lib/email";

export const batch = new Hono<{ Bindings: Env }>();

batch.post("/run-weekly-batch", async (c) => {
  const secret = c.req.header("x-batch-secret");
  if (secret !== c.env.BATCH_SECRET) return c.text("Unauthorized", 401);

  const jobs = await c.env.DB.prepare(
    "SELECT id, user_id, title_style, title_angle, runs_completed FROM jobs WHERE status = 'active' AND runs_completed < 12"
  ).all<{ id: string; user_id: string; title_style: string; title_angle: string; runs_completed: number }>();

  const results = [];
  for (const job of jobs.results) {
    try {
      results.push(await processJob(c.env, job));
    } catch (err) {
      console.error(`Job ${job.id} failed:`, err);
      results.push({ jobId: job.id, error: String(err) });
    }
  }
  return c.json({ processed: results.length, results });
});

async function processJob(
  env: Env,
  job: { id: string; user_id: string; title_style: string; title_angle: string; runs_completed: number }
) {
  const user = await env.DB.prepare("SELECT email, oauth_refresh_token FROM users WHERE id = ?")
    .bind(job.user_id)
    .first<{ email: string; oauth_refresh_token: string }>();
  const refreshToken = await decrypt(user!.oauth_refresh_token, env.ENCRYPTION_KEY);
  const accessToken = await refreshAccessToken(refreshToken, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);

  const jobVideos = await env.DB.prepare(
    "SELECT id, youtube_video_id, user_summary FROM job_videos WHERE job_id = ?"
  )
    .bind(job.id)
    .all<{ id: string; youtube_video_id: string; user_summary: string | null }>();

  const runNumber = job.runs_completed + 1;
  const runId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO weekly_runs (id, job_id, run_number, status) VALUES (?, ?, ?, 'ok')")
    .bind(runId, job.id, runNumber)
    .run();

  const llm = createLLM(env);
  const digestChanges: { oldTitle: string; newTitle: string; revertUrl: string }[] = [];

  for (const jv of jobVideos.results) {
    // Step 1: current title/description straight from YouTube (not the stale snapshot).
    const [current] = await getVideoStats(accessToken, [jv.youtube_video_id]);
    const currentTitle = current.snippet.title as string;
    const description = current.snippet.description as string;

    // Step 2: transcript with contingency chain (never blocks the batch).
    const transcript = await getTranscript(jv.youtube_video_id);

    // Steps 3-4: user summary + trend inference (cached per topic/week).
    const trends = await getTrendSignals(currentTitle, env);

    // Step 5: generate the new title.
    const newTitle = await llm.generateTitle({
      currentTitle,
      description,
      transcriptExcerpt: transcript.text,
      userSummary: jv.user_summary ?? undefined,
      style: job.title_style,
      angle: job.title_angle,
      competitorTitles: trends.competitorTitles,
      trendingKeywords: trends.autocomplete,
    });

    // Step 6: apply it (fetch-then-merge snippet, only title changes).
    await updateVideoTitle(accessToken, jv.youtube_video_id, newTitle);

    // Step 7: log with a long, random, single-use revert token.
    const revertToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    await env.DB.prepare(
      `INSERT INTO title_changes (id, job_video_id, weekly_run_id, old_title, new_title, revert_token, transcript_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), jv.id, runId, currentTitle, newTitle, revertToken, transcript.status)
      .run();

    digestChanges.push({
      oldTitle: currentTitle,
      newTitle,
      revertUrl: `${env.APP_URL}/api/revert/${revertToken}`,
    });
  }

  // Step 8: increment runs_completed, expire at 12.
  const newRunsCompleted = runNumber;
  const nowExpired = newRunsCompleted >= 12;
  await env.DB.prepare(
    `UPDATE jobs SET runs_completed = ?, status = CASE WHEN ? THEN 'expired' ELSE status END WHERE id = ?`
  )
    .bind(newRunsCompleted, nowExpired ? 1 : 0, job.id)
    .run();

  // Step 9: digest email.
  const mailer = createMailer(env);
  await mailer.send(
    user!.email,
    `Peachy: week ${runNumber} title updates`,
    digestEmailHtml({ jobId: job.id, runNumber, changes: digestChanges, isFinalRun: nowExpired, appUrl: env.APP_URL })
  );

  return { jobId: job.id, runNumber, videosUpdated: digestChanges.length, expired: nowExpired };
}
