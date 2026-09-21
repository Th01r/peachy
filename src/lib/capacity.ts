// Hard cap on simultaneously booked jobs, so the weekly batch never tries to
// process more videos.update calls than the YouTube API quota safely allows.
// "Booked" = active (already paying, running) + pending_payment (mid-checkout,
// counted too so a wave of concurrent checkouts can't oversell past the cap).

export async function bookedJobCount(env: { DB: D1Database }): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM jobs WHERE status IN ('active','pending_payment')"
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function isFull(env: { DB: D1Database; MAX_ACTIVE_JOBS: string }): Promise<boolean> {
  const count = await bookedJobCount(env);
  return count >= Number(env.MAX_ACTIVE_JOBS);
}
