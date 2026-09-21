import { Hono } from "hono";
import type { Env } from "../index";
import { refreshAccessToken, updateVideoTitle } from "../lib/youtube";
import { decrypt } from "../lib/crypto";

export const revert = new Hono<{ Bindings: Env }>();

revert.get("/:token", async (c) => {
  const token = c.req.param("token");

  const change = await c.env.DB.prepare(
    `SELECT tc.id, tc.old_title, tc.reverted_at, jv.youtube_video_id, j.user_id
     FROM title_changes tc
     JOIN job_videos jv ON jv.id = tc.job_video_id
     JOIN weekly_runs wr ON wr.id = tc.weekly_run_id
     JOIN jobs j ON j.id = wr.job_id
     WHERE tc.revert_token = ?`
  )
    .bind(token)
    .first<{ id: string; old_title: string; reverted_at: string | null; youtube_video_id: string; user_id: string }>();

  if (!change) return c.text("This revert link is invalid.", 404);
  if (change.reverted_at) return c.text("This title was already reverted.", 200);

  const user = await c.env.DB.prepare("SELECT oauth_refresh_token FROM users WHERE id = ?")
    .bind(change.user_id)
    .first<{ oauth_refresh_token: string }>();

  const refreshToken = await decrypt(user!.oauth_refresh_token, c.env.ENCRYPTION_KEY);
  const accessToken = await refreshAccessToken(refreshToken, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);

  await updateVideoTitle(accessToken, change.youtube_video_id, change.old_title);
  await c.env.DB.prepare("UPDATE title_changes SET reverted_at = datetime('now') WHERE id = ?")
    .bind(change.id)
    .run();

  return c.text(`Title reverted to: "${change.old_title}"`, 200);
});
