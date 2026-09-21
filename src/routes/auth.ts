import { Hono } from "hono";
import type { Env } from "../index";
import { googleAuthUrl, exchangeCode, decodeIdToken } from "../lib/youtube";
import { encrypt } from "../lib/crypto";
import { createSessionCookie } from "../lib/session";
import { isFull } from "../lib/capacity";

export const auth = new Hono<{ Bindings: Env }>();

const IDENTITY_SCOPE = "openid email profile";
const YOUTUBE_SCOPE = `${IDENTITY_SCOPE} https://www.googleapis.com/auth/youtube.force-ssl`;

// Plain sign-in - identity only, no YouTube consent.
auth.get("/google/start", (c) => {
  const state = crypto.randomUUID();
  const url = googleAuthUrl({
    clientId: c.env.GOOGLE_CLIENT_ID,
    redirectUri: `${c.env.APP_URL}/api/auth/google/callback`,
    scope: IDENTITY_SCOPE,
    state,
  });
  return c.redirect(url);
});

// Wizard step 1 - fuller YouTube data consent, unverified-app warning expected.
auth.get("/google/youtube/start", (c) => {
  const state = c.req.query("wizard") ?? crypto.randomUUID();
  const url = googleAuthUrl({
    clientId: c.env.GOOGLE_CLIENT_ID,
    redirectUri: `${c.env.APP_URL}/api/auth/google/callback`,
    scope: YOUTUBE_SCOPE,
    state,
  });
  return c.redirect(url);
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code) return c.text("Missing code", 400);

  const tokens = await exchangeCode({
    code,
    clientId: c.env.GOOGLE_CLIENT_ID,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${c.env.APP_URL}/api/auth/google/callback`,
  });
  const identity = decodeIdToken(tokens.id_token);

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(identity.sub)
    .first();

  if (!existing) {
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, name) VALUES (?, ?, ?)"
    )
      .bind(identity.sub, identity.email, identity.name ?? null)
      .run();
  }

  // Only present when the youtube.force-ssl scope was granted (wizard step 1).
  if (tokens.refresh_token) {
    const encrypted = await encrypt(tokens.refresh_token, c.env.ENCRYPTION_KEY);
    await c.env.DB.prepare("UPDATE users SET oauth_refresh_token = ? WHERE id = ?")
      .bind(encrypted, identity.sub)
      .run();
  }

  const cookie = await createSessionCookie(identity.sub, c.env.SESSION_SECRET);
  c.header("Set-Cookie", cookie);

  if (!tokens.refresh_token) {
    // Plain identity sign-in only - no wizard involved.
    return c.redirect("/account.html");
  }

  if (await isFull(c.env)) {
    return c.redirect("/wizard.html?full=1");
  }

  // `state` carries an existing wizard session id on renew (see account.ts /renew);
  // otherwise this is a fresh job, so create the wizard session now that we have a user.
  let sessionId = state;
  const existingSession = sessionId
    ? await c.env.DB.prepare("SELECT id FROM wizard_sessions WHERE id = ?").bind(sessionId).first()
    : null;
  if (!existingSession) {
    sessionId = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO wizard_sessions (id, user_id, current_step) VALUES (?, ?, 2)"
    )
      .bind(sessionId, identity.sub)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE wizard_sessions SET current_step = 2 WHERE id = ?").bind(sessionId).run();
  }

  return c.redirect(`/wizard.html?session=${sessionId}&step=2`);
});
