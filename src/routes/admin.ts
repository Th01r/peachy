import { Hono } from "hono";
import type { Env } from "../index";
import { bookedJobCount } from "../lib/capacity";

export const admin = new Hono<{ Bindings: Env }>();

admin.get("/stats", async (c) => {
  const secret = c.req.header("x-batch-secret");
  if (secret !== c.env.BATCH_SECRET) return c.text("Unauthorized", 401);

  const [jobsByStatus, transcriptFallback, reverts, restarts, leadgen, booked] = await Promise.all([
    c.env.DB.prepare("SELECT status, COUNT(*) as n FROM jobs GROUP BY status").all(),
    c.env.DB.prepare("SELECT transcript_status, COUNT(*) as n FROM title_changes GROUP BY transcript_status").all(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN reverted_at IS NOT NULL THEN 1 ELSE 0 END) as reverted FROM title_changes"
    ).first(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM jobs WHERE renewed_from_job_id IS NOT NULL").first(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as total, SUM(contacted) as contacted FROM leadgen_samples"
    ).first(),
    bookedJobCount(c.env),
  ]);

  return c.json({
    jobsByStatus: jobsByStatus.results,
    transcriptFallbackRate: transcriptFallback.results,
    reverts,
    restarts,
    leadgen,
    capacity: { booked, max: Number(c.env.MAX_ACTIVE_JOBS) },
  });
});
