// Swappable email interface. Resend free tier: 3,000/mo, 100/day, no CC at
// signup (verified 2026) - plenty for <100 users x 5 videos weekly.

export interface Mailer {
  send(to: string, subject: string, html: string): Promise<void>;
}

export function createMailer(env: { RESEND_API_KEY: string; FROM_EMAIL: string }): Mailer {
  return {
    async send(to, subject, html) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html }),
      });
      if (!res.ok) console.error(`Resend send failed: ${await res.text()}`);
    },
  };
}

export function digestEmailHtml(opts: {
  jobId: string;
  runNumber: number;
  changes: { oldTitle: string; newTitle: string; revertUrl: string }[];
  isFinalRun: boolean;
  appUrl: string;
}): string {
  const rows = opts.changes
    .map(
      (c) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f0d9c9;">
        <div style="color:#4a4a4a;text-decoration:line-through;opacity:.6;">${c.oldTitle}</div>
        <div style="color:#4a4a4a;font-weight:600;margin-top:4px;">${c.newTitle}</div>
        <a href="${c.revertUrl}" style="color:#d35521;font-size:13px;">Revert this title</a>
      </td>
    </tr>`
    )
    .join("");

  const restartCta = opts.isFinalRun
    ? `<p style="margin-top:24px;"><a href="${opts.appUrl}/account" style="background:#d35521;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">Restart this job</a></p><p>This was week 12 - your job has ended.</p>`
    : "";

  return `<div style="background:#ffe5d9;padding:32px;font-family:sans-serif;">
    <div style="background:#fff;border-radius:16px;padding:24px;max-width:520px;margin:0 auto;">
      <h2 style="color:#4a4a4a;">Week ${opts.runNumber} title updates</h2>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      ${restartCta}
    </div>
  </div>`;
}
