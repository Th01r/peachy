async function load() {
  const res = await fetch("/api/account/me", { credentials: "include" });
  const list = document.getElementById("jobs-list");
  if (!res.ok) {
    list.innerHTML = `<p>Sign in first. <a class="btn" href="/api/auth/google/start">Sign in with Google</a></p>`;
    return;
  }
  const { jobs } = await res.json();
  if (!jobs.length) {
    list.innerHTML = `<p style="color:var(--ink-dim);">No jobs yet.</p>`;
    return;
  }
  list.innerHTML = jobs
    .map((j) => {
      const actions =
        j.status === "active"
          ? `<button class="btn-ghost btn" data-cancel="${j.id}">Cancel</button>`
          : ["expired", "cancelled"].includes(j.status)
          ? `<button class="btn" data-renew="${j.id}">Renew</button>`
          : "";
      return `<div class="card" style="margin-bottom:12px;background:#fff5ee;">
        <strong>Job ${j.id.slice(0, 8)}</strong> — ${j.status}
        <br><small>${j.title_style} / ${j.title_angle} · ${j.runs_completed}/12 runs</small>
        <div style="margin-top:10px;">${actions}</div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-cancel]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("This is a one-time payment with no refund — cancelling only stops future weekly runs. Continue?")) return;
      await fetch(`/api/account/jobs/${btn.dataset.cancel}/cancel`, { method: "POST", credentials: "include" });
      load();
    })
  );
  list.querySelectorAll("[data-renew]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const res = await fetch(`/api/account/jobs/${btn.dataset.renew}/renew`, { method: "POST", credentials: "include" });
      const data = await res.json();
      sessionStorage.setItem("peachy_prefill", JSON.stringify(data.prefillVideos.map((v) => v.youtube_video_id)));
      location.href = `/wizard.html?session=${data.sessionId}&step=2`;
    })
  );
}
load();
