import { Hono } from "hono";
import type { Env } from "../index";
import { verifySession } from "../lib/session";
import { createCheckout, verifyWebhook } from "../lib/polar";
import { polarProductId } from "../lib/pricing";

export const checkout = new Hono<{ Bindings: Env }>();

checkout.post("/create", async (c) => {
  const userId = await verifySession(c.req.header("Cookie") ?? null, c.env.SESSION_SECRET);
  if (!userId) return c.json({ error: "Not signed in" }, 401);

  const { jobId } = await c.req.json<{ jobId: string }>();
  const job = await c.env.DB.prepare("SELECT id, user_id, status FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ id: string; user_id: string; status: string }>();
  if (!job || job.user_id !== userId || job.status !== "pending_payment") {
    return c.json({ error: "Job not found or already paid" }, 404);
  }

  // Re-check the uniqueness rule right before checkout (spec 11: a second
  // wizard session or a slow checkout could race past the step-2 check).
  const conflict = await c.env.DB.prepare(
    `SELECT jv.youtube_video_id FROM job_videos jv
     JOIN jobs j ON j.id = jv.job_id
     WHERE j.user_id = ? AND j.status IN ('active','pending_payment') AND j.id != ?
       AND jv.youtube_video_id IN (SELECT youtube_video_id FROM job_videos WHERE job_id = ?)`
  )
    .bind(userId, jobId, jobId)
    .first();
  if (conflict) return c.json({ error: "One of these videos was just claimed by another job" }, 409);

  const user = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>();

  const session = await createCheckout({
    accessToken: c.env.POLAR_ACCESS_TOKEN,
    server: c.env.POLAR_SERVER as "sandbox" | "production",
    productId: polarProductId(c.env),
    successUrl: `${c.env.APP_URL}/account.html?checkout=success`,
    customerEmail: user!.email,
    metadata: { jobId },
  });

  await c.env.DB.prepare("UPDATE jobs SET polar_checkout_id = ? WHERE id = ?").bind(session.id, jobId).run();
  return c.json({ checkoutUrl: session.url });
});

checkout.post("/webhook/polar", async (c) => {
  const rawBody = await c.req.text();
  const valid = await verifyWebhook(c.req.raw, rawBody, c.env.POLAR_WEBHOOK_SECRET);
  if (!valid) return c.text("Invalid signature", 401);

  const event = JSON.parse(rawBody) as { type: string; data: any };
  if (event.type !== "order.paid") return c.text("ok"); // only care about successful payment

  const jobId = event.data.metadata?.jobId as string | undefined;
  if (!jobId) return c.text("ok");

  const job = await c.env.DB.prepare("SELECT user_id FROM jobs WHERE id = ?").bind(jobId).first<{ user_id: string }>();
  if (!job) return c.text("ok");

  const startedAt = new Date();
  const expiresAt = new Date(startedAt);
  expiresAt.setDate(expiresAt.getDate() + 12 * 7);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE jobs SET status = 'active', started_at = ?, expires_at = ? WHERE id = ?"
    ).bind(startedAt.toISOString(), expiresAt.toISOString(), jobId),
    c.env.DB.prepare(
      "INSERT INTO payments (id, user_id, job_id, polar_checkout_id, amount, status) VALUES (?, ?, ?, ?, ?, 'paid')"
    ).bind(crypto.randomUUID(), job.user_id, jobId, event.data.checkout_id ?? null, event.data.amount ?? null),
  ]);

  return c.text("ok");
});
