import { Hono } from "hono";
import type { Env } from "../index";
import { verifySession } from "../lib/session";

export const account = new Hono<{ Bindings: Env }>();

async function requireUser(c: any): Promise<string | Response> {
  const userId = await verifySession(c.req.header("Cookie") ?? null, c.env.SESSION_SECRET);
  if (!userId) return c.json({ error: "Not signed in" }, 401);
  return userId;
}

account.get("/me", async (c) => {
  const userId = await requireUser(c);
  if (userId instanceof Response) return userId;
  const user = await c.env.DB.prepare("SELECT id, email, name, youtube_channel_id FROM users WHERE id = ?")
    .bind(userId)
    .first();
  const jobs = await c.env.DB.prepare(
    "SELECT id, status, title_style, title_angle, started_at, expires_at, runs_completed, renewed_from_job_id FROM jobs WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(userId)
    .all();
  return c.json({ user, jobs: jobs.results });
});

account.post("/jobs/:id/cancel", async (c) => {
  const userId = await requireUser(c);
  if (userId instanceof Response) return userId;
  const jobId = c.req.param("id");

  const job = await c.env.DB.prepare("SELECT user_id, status FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ user_id: string; status: string }>();
  if (!job || job.user_id !== userId) return c.json({ error: "Job not found" }, 404);
  if (job.status !== "active") return c.json({ error: "Only active jobs can be cancelled" }, 400);

  // One-time payment, no refund - cancellation only stops future runs.
  await c.env.DB.prepare("UPDATE jobs SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?")
    .bind(jobId)
    .run();
  return c.json({ ok: true });
});

// Renew = new wizard session prefilled from an expired/cancelled job's videos.
account.post("/jobs/:id/renew", async (c) => {
  const userId = await requireUser(c);
  if (userId instanceof Response) return userId;
  const jobId = c.req.param("id");

  const job = await c.env.DB.prepare("SELECT user_id, status FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ user_id: string; status: string }>();
  if (!job || job.user_id !== userId) return c.json({ error: "Job not found" }, 404);
  if (!["expired", "cancelled"].includes(job.status)) {
    return c.json({ error: "Only expired or cancelled jobs can be renewed" }, 400);
  }

  const sessionId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO wizard_sessions (id, user_id, current_step, prefill_from_job_id) VALUES (?, ?, 2, ?)"
  )
    .bind(sessionId, userId, jobId)
    .run();

  const prevVideos = await c.env.DB.prepare(
    "SELECT youtube_video_id, original_title, description, user_summary FROM job_videos WHERE job_id = ?"
  )
    .bind(jobId)
    .all();

  return c.json({ sessionId, prefillVideos: prevVideos.results });
});
