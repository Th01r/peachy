# Peachy — setup, implementation & deployment

Stack confirmed at build time (Sept 2026): **Cloudflare Workers + static assets**
(not Pages — Cloudflare's own recommended default since 2026 unifies frontend/backend
in one Worker), **D1**, **Hono**, **Groq→Gemini** LLM fallback, **Resend** email,
**Polar** checkout, **GitHub Actions** cron. All free, no credit card except at the
customer's Polar checkout.

## 0. What's in this repo

```
peachy/
  wrangler.jsonc          Worker config (name, D1 binding, assets dir)
  migrations/0001_init.sql D1 schema
  src/
    index.ts              Hono app entry + Env type (all bindings/secrets)
    lib/                  llm, email, transcript, trends, youtube, polar, crypto, session
    routes/                leadgen, auth, wizard, checkout, account, batch, revert, admin
    prompts/title.ts       single reusable title-gen prompt
  public/                 landing, pricing, wizard, account, admin (static, served free)
  .github/workflows/weekly-batch.yml
  .dev.vars.example        copy -> .dev.vars for local dev
```

## 1. Prerequisites (no local install required)

- A GitHub account (free) and a Cloudflare account (free tier, no CC to sign up).
- That's it. Everything below happens in the Cloudflare dashboard and GitHub's
  web UI — no Node, no `wrangler`, nothing installed on your machine.

## 2. Push this folder to GitHub (web UI, no `git` needed)

1. https://github.com/new → create a new repo (e.g. `peachy`), don't initialize
   it with a README.
2. On the empty repo's page, click **"uploading an existing file"**, then drag
   in every file/folder from this project (keep the folder structure — GitHub's
   uploader preserves paths when you drop a whole folder). Commit.

## 3. Connect Cloudflare to the repo (this replaces `wrangler d1 create` + `wrangler deploy`)

1. https://dash.cloudflare.com → **Workers & Pages → Create → Connect to Git**.
2. Pick the `peachy` repo, branch `main`.
3. Cloudflare reads `wrangler.jsonc`, sees the `d1_databases` entry has no
   `database_id`, and **auto-provisions a new D1 database for you** on first
   deploy, writing the id back into the config it runs with. No CLI step.
4. Build command: leave blank (static assets need no build step).
   Deploy command: leave as the default (`npm run deploy` — this repo's
   `package.json` already chains `wrangler d1 migrations apply DB --remote`
   before `wrangler deploy`, so your schema is applied automatically on
   every push, including the first one).
5. Click **Save and Deploy**. Every future `git push` (via GitHub's web editor,
   or the "Upload files" button again) redeploys automatically.

## 4. Google Cloud Console (OAuth)

1. Create a project at https://console.cloud.google.com (free, no CC).
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type: External.
   - Publishing status: **In production** (not Testing — Testing expires refresh
     tokens every 7 days; Production+unverified does not, per the hard constraint).
   - You will NOT submit for verification. Google will show users an "unverified
     app" warning at consent — the landing page already explains this in advance.
   - Scopes: add `openid`, `email`, `profile`, and
     `https://www.googleapis.com/auth/youtube.force-ssl`.
4. **Credentials → Create Credentials → OAuth client ID** (Web application).
   - Authorized redirect URI: `https://<your-worker-subdomain>.workers.dev/api/auth/google/callback`
     (find your exact `*.workers.dev` URL on the Worker's Cloudflare dashboard
     page after step 3; add your custom domain too, once you attach one).
5. **Credentials → Create Credentials → API key**, restrict it to YouTube Data
   API v3 — this is `YT_API_KEY`.

> Unverified-in-production apps have a **lifetime cap of 100 connected users**,
> not resettable without going through verification.

## 5. LLM keys

- Groq: https://console.groq.com → sign up with email, no CC → API Keys → create.
- Gemini: https://aistudio.google.com/apikey → no CC for the free tier.

Both are swappable behind `src/lib/llm.ts`.

## 6. Email — Resend

https://resend.com/signup → free tier, no CC, 3,000 emails/mo / 100/day. Verify
a sending domain, create an API key → `RESEND_API_KEY`. `FROM_EMAIL` must be on
the verified domain.

## 7. Polar (payments)

1. https://polar.sh → create an organization (free, no CC).
2. Create **two Products**, both one-time price:
   - "Peachy — Launch price" at **$65** → copy its ID → `POLAR_PRODUCT_ID_LAUNCH`
   - "Peachy — Regular price" at **$79** → copy its ID → `POLAR_PRODUCT_ID_REGULAR`
   The app automatically checkouts against whichever one is currently active
   based on `LAUNCH_PRICE_ENDS` (§11) — nobody has to remember to raise the
   price by hand, and the displayed price can never drift from the charged price.
3. **Settings → Developers** → create an access token → `POLAR_ACCESS_TOKEN`.
4. **Settings → Webhooks** → Add endpoint:
   `https://<your-worker>.workers.dev/api/checkout/webhook/polar`, subscribe to
   `order.paid`. Copy the signing secret → `POLAR_WEBHOOK_SECRET`.
5. Start with `POLAR_SERVER=sandbox` and https://sandbox.polar.sh to test the
   full checkout→webhook loop before flipping to `production`.

## 8. Secrets — all set from the dashboard, no CLI

Generate two random 32-byte base64 keys (`ENCRYPTION_KEY`, `SESSION_SECRET`)
and one random string (`BATCH_SECRET`) using any online secure-random-string
generator (e.g. https://generate-random.org/api-key-generator, 32+ chars) —
or, if you do have any machine with Node handy for 10 seconds:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Then, in Cloudflare dashboard → your Worker → **Settings → Variables and
Secrets → Add**, add each of these as an encrypted secret:

```
APP_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GROQ_API_KEY GEMINI_API_KEY
RESEND_API_KEY FROM_EMAIL YT_API_KEY POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET
POLAR_PRODUCT_ID_LAUNCH POLAR_PRODUCT_ID_REGULAR POLAR_SERVER
ENCRYPTION_KEY SESSION_SECRET BATCH_SECRET
```

`APP_URL` is your `*.workers.dev` URL (or custom domain once attached). Saving
secrets triggers a redeploy automatically — nothing else to run.

`MAX_ACTIVE_JOBS`, `LAUNCH_PRICE`, `REGULAR_PRICE`, and `LAUNCH_PRICE_ENDS`
are plain, non-secret vars already set in `wrangler.jsonc` — edit them there
and push to change them, or override per-environment in the same Variables screen.

## 9. GitHub Actions weekly cron

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:
- `PEACHY_APP_URL` — your deployed Worker URL
- `PEACHY_BATCH_SECRET` — same value as the `BATCH_SECRET` Worker secret

`.github/workflows/weekly-batch.yml` (already in the repo you uploaded) runs
every Monday 14:00 UTC entirely on GitHub's servers, and can also be triggered
manually from the repo's **Actions** tab (`workflow_dispatch`) — use that for
your first end-to-end test instead of trusting the schedule, and instead of
running `curl` locally.

Cloudflare's own Cron Triggers require a paid Workers plan, which is why the
scheduler lives in GitHub Actions instead, calling the same secured endpoint.

## 10. Manual testing before going live

All from a browser, no terminal needed:

1. Visit your deployed URL, sign in with Google, link YouTube on your own channel.
2. Run through the wizard against a Polar **sandbox** checkout.
3. Confirm the webhook fired (Polar dashboard → Webhooks → delivery log) and
   the job shows `active` on `/account.html`.
4. Trigger the batch manually from GitHub's **Actions** tab → `Weekly title
   batch` → **Run workflow**.
5. Confirm: title actually changed on YouTube, digest email arrived, revert
   link works, and `/admin.html` (paste your `BATCH_SECRET`) shows the run.
6. Only then flip `POLAR_SERVER` to `production` in the dashboard secrets and
   let the GH Actions schedule take over.

## 11. Capacity failsafe — "temporarily fully booked"

`MAX_ACTIVE_JOBS` (default 150, in `wrangler.jsonc`) caps how many jobs can be
`active` or `pending_payment` at once, so the weekly batch never tries to push
more `videos.update` calls than the YouTube API quota safely covers.

- **Enforced server-side** at the moment a job is actually created
  (`POST /api/wizard/select`, `src/routes/wizard.ts`) — this is the
  authoritative gate; nothing client-side can bypass it.
- Also checked right after OAuth (`src/routes/auth.ts`) so someone doesn't
  grant YouTube access only to be told no on the next screen.
- `GET /api/capacity` is a public, unauthenticated read (`src/routes/capacity.ts`)
  the frontend polls to show the "Temporarily fully booked" modal
  (`public/js/capacity.js`) proactively on the landing page CTA and wizard
  entry, before someone invests time in the flow.
- `/admin.html` shows current booked/max so you can watch it approach the cap.

To raise the cap later (e.g. after confirming real quota headroom), change
`MAX_ACTIVE_JOBS` in `wrangler.jsonc` and push — no other code changes needed.

## 12. Launch pricing & the pre-checkout comparison screen

- `src/lib/pricing.ts` is the single source of truth: `LAUNCH_PRICE_ENDS`
  (an ISO datetime var in `wrangler.jsonc`) decides both what price is
  *displayed* (`GET /api/pricing`, used by `pricing.html` and the wizard's
  payment step) and what Polar product is actually *charged*
  (`polarProductId()` in `checkout.ts`) — they can't drift apart.
- To end the launch window early, just change `LAUNCH_PRICE_ENDS` to a past
  date and push. Nothing else to touch.
- The wizard's step 4 ("Payment") shows the anchored price ($79 struck
  through, $65 current, with the "good through [date]" line) and a
  three-row comparison table against a freelance thumbnail redesign, an
  hour of a freelance editor's time, and YouTube's own recommended minimum
  ad spend to promote a video — all framed as **per-video** cost, not
  per-week, so the copy doesn't draw attention to the 12-week duration of a
  one-time purchase (that duration-reveal is a documented way per-unit
  framing backfires on big one-time purchases). The comparison figures live
  in `src/routes/pricing.ts` (`COMPARISONS`) — update them if your market
  rates change; they're static, not fetched live, so no ongoing cost or
  fragility from calling out to a third party.
- This shape (real anchor price, time-boxed and honestly justified, modest
  ~18% discount rather than a steep one) was chosen deliberately over a
  blanket low price: for a new, unverified-app-warning brand, pricing too
  low can itself read as a quality/risk signal, which is the opposite of
  what you want at this stage.

## 13. Internal dashboard

`https://<your-worker>.workers.dev/admin.html` — paste your `BATCH_SECRET` to
pull jobs-by-status, transcript fallback rate, revert rate, restart rate, and
current capacity from `/api/admin/stats`. It's unauthenticated beyond the
shared secret, which is fine at this scale — don't index it (already `noindex`
+ excluded from the sitemap) and don't share the secret outside your own tooling.

## 14. What's deliberately not built (YAGNI, per the brief)

- No Google OAuth verification/CASA flow — intentional, tracked against the
  100-user lifetime cap instead.
- No Supabase — D1 covers every requirement here; the fallback clause in the
  brief was never triggered.
- No queue/worker-pool for the batch job — <150 users × 5 videos is a small
  enough loop to run sequentially inside one Worker invocation. If you outgrow
  Workers' request duration limits, that's the first thing to split out (e.g.
  via Cloudflare Queues), not before — and it's exactly the scenario
  `MAX_ACTIVE_JOBS` exists to prevent you from hitting unannounced.
- No admin auth beyond the shared secret — add real auth only if the admin
  surface needs to be shared with someone else.

## 15. Advanced: local CLI setup (optional, not required)

If you ever do want a local dev loop: `npm install -g wrangler`, `wrangler
login`, `npm install`, copy `.dev.vars.example` → `.dev.vars` and fill it in,
`npm run dev`. Entirely optional — every step above works without it.

## 16. Open items to watch (carried from the brief, section 11)

- Track connect-attempt vs. connect-completed conversion given the unverified-app warning.
- The `videos.update`-overwrites-the-whole-snippet risk is handled by
  fetch-then-merge in `src/lib/youtube.ts::updateVideoTitle` — if you touch
  that function, keep the merge, don't hand-build the snippet object.
- Re-verify Groq/Gemini/Resend free-tier terms before onboarding real users —
  they're abstracted behind `lib/llm.ts` and `lib/email.ts` specifically so a
  provider swap is a one-file change.
