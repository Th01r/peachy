import { Hono } from "hono";
import { leadgen } from "./routes/leadgen";
import { auth } from "./routes/auth";
import { wizard } from "./routes/wizard";
import { checkout } from "./routes/checkout";
import { account } from "./routes/account";
import { batch } from "./routes/batch";
import { revert } from "./routes/revert";
import { admin } from "./routes/admin";
import { capacity } from "./routes/capacity";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_URL: string;
  MAX_ACTIVE_JOBS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GROQ_API_KEY: string;
  GEMINI_API_KEY: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  YT_API_KEY: string;
  POLAR_ACCESS_TOKEN: string;
  POLAR_WEBHOOK_SECRET: string;
  POLAR_PRODUCT_ID: string;
  POLAR_SERVER: string;
  ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  BATCH_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.route("/api/leadgen", leadgen);
app.route("/api/auth", auth);
app.route("/api/wizard", wizard);
app.route("/api/checkout", checkout);
app.route("/api/account", account);
app.route("/api", batch); // exposes /api/run-weekly-batch
app.route("/api/revert", revert);
app.route("/api/admin", admin);
app.route("/api/capacity", capacity);

// Anything not matched above and not a static asset (assets are served
// automatically before the Worker runs) falls through here.
app.notFound((c) => c.text("Not found", 404));

export default app;
