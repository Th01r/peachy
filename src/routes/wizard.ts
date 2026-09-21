import { Hono } from "hono";
import type { Env } from "../index";
import { verifySession } from "../lib/session";
import { getUploadsPlaylistId, listUploads, refreshAccessToken, getVideoStats } from "../lib/youtube";
import { decrypt } from "../lib/crypto";
import { isFull } from "../lib/capacity";

export const wizard = new Hono<{ Bindings: Env }>();

async function requireUser(c: any): Promise<string | Response> {
  const userId = await verifySession(c.req.header("Cookie") ?? null, c.env.SESSION_SECRET);
  if (!userId) return c.json({ error: "Not signed in" }, 401);
  return userId;
}

// Videos locked by any of the caller's OTHER active/pending_payment jobs.
async function lockedVideoIds(env: Env, userId: string, excludeJobId?: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    `SELECT jv.youtube_video_id FROM job_videos jv
     JOIN jobs j ON j.id = jv.job_id
     WHERE j.user_id = ? AND j.status IN ('active','pending_payment') AND j.id != ?`
  )
    .bind(userId, excludeJobId ?? "")
    .all<{ youtube_video_id: string }>();
  return new Set(rows.results.map((r) => r.youtube_video_id));
}

wizard.post("/session", async (c) => {
  const userId = await requireUser(c);
  if (userId instanceof Response) return userId;
  if (await isFull(c.env)) return c.json({ error: "full", message: "Peachy is temporarily fully booked." }, 503);

  const { prefillFromJobId } = await c.req.json<{ prefillFromJobId?: string }>().catch(() => ({} as any));

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO wizard_sessions (id, user_id, current_step, prefill_from_job_id) VALUES (?, ?, 1, ?)"
  )
    .bind(id, userId, prefillFromJobId ?? null)
    .run();
  return c.json({ sessionId: id });
});

// Step 2: list the user's uploads with the uniqueness rule applied inline.
wizard.get("/videos", async (c) => {
  const userId = await requireUser(c);
  if (userId instanceof Response) return userId;

  const user = await c.env.DB.prepare("SELECT oauth_refresh_token FROM users WHERE id = ?")
    .bind(userId)
    .first<{ oauth_refresh_token: string | null }>();
  if (!user?.oauth_refresh_token) return c.json({ error: "YouTube not linked" }, 400);

  const refreshToken = await decrypt(user.oauth_refresh_token, c.env.ENCRYPTION_KEY);
  const accessToken = await refreshAccessToken(refreshToken, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);

  const uploadsPlaylist = await getUploadsPlaylistId(accessToken);
  const page = await listUploads(accessToken, uploadsPlaylist, c.req.query("pageToken"));
  const videoIds = page.items.map((i: any) => i.contentDetails.videoId);
  const stats = videoIds.length ? await getVideoStats(accessToken, videoIds) : [];
  const statsById = new Map(stats.map((v: any) => [v.id, v.statistics]));

  const locked = await lockedVideoIds(c.env, userId, c.req.query("jobId"));

  const videos = page.items.map((i: any) => ({
    videoId: i.contentDetails.videoId,
    title: i.snippet.title,
    description: i.snippet.description ?? "",
    thumbnail: i.snippet.thumbnails?.default?.url,
    publishedAt: i.contentDetails.videoPublishedAt,
    viewCount: Number(statsById.get(i.contentDetails.videoId)?.viewCount ?? 0),
    locked: locked.has(i.contentDetails.videoId),
  }));

  return c.json({ videos, nextPageToken: page.nextPageToken ?? null });
});

// Step 3: save selected videos (5, exactly) + summaries + style/angle onto the job.
wizard.post("/select", async (c) => {
  const userId = await requireUser(c);
  if (userId instanceof Response) return userId;
  if (await isFull(c.env)) return c.json({ error: "full", message: "Peachy is temporarily fully booked." }, 503);

  const body = await c.req.json<{
    sessionId: string;
    videos: { videoId: string; title: string; description: string; userSummary?: string }[];
    titleStyle: string;
    titleAngle: string;
  }>();

  if (body.videos.length !== 5) return c.json({ error: "Select exactly 5 videos" }, 400);

  const locked = await lockedVideoIds(c.env, userId);
  const conflict = body.videos.find((v) => locked.has(v.videoId));
  if (conflict) {
    return c.json({ error: `"${conflict.title}" is already in another active job`, videoId: conflict.videoId }, 409);
  }

  const session = await c.env.DB.prepare("SELECT prefill_from_job_id FROM wizard_sessions WHERE id = ?")
    .bind(body.sessionId)
    .first<{ prefill_from_job_id: string | null }>();

  const jobId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO jobs (id, user_id, status, title_style, title_angle, renewed_from_job_id) VALUES (?, ?, 'pending_payment', ?, ?, ?)"
    ).bind(jobId, userId, body.titleStyle, body.titleAngle, session?.prefill_from_job_id ?? null),
    ...body.videos.map((v) =>
      c.env.DB.prepare(
        "INSERT INTO job_videos (id, job_id, youtube_video_id, original_title, description, user_summary) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), jobId, v.videoId, v.title, v.description, v.userSummary ?? null)
    ),
    c.env.DB.prepare("UPDATE wizard_sessions SET current_step = 4, completed_at = datetime('now') WHERE id = ?").bind(
      body.sessionId
    ),
  ]);

  return c.json({ jobId });
});
