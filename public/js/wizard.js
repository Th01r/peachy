const params = new URLSearchParams(location.search);
const sessionId = params.get("session");
const startStep = Number(params.get("step") || 1);

let selectedVideos = []; // {videoId, title, description}
let currentJobId = null;

function showStep(n) {
  for (let i = 1; i <= 4; i++) document.getElementById(`step-${i}`).hidden = i !== n;
  document.querySelectorAll(".progress-dot").forEach((d) => {
    const s = Number(d.dataset.step);
    d.classList.toggle("done", s < n);
    d.classList.toggle("active", s === n);
  });
}

let allVideos = [];

async function loadVideos() {
  const res = await fetch("/api/wizard/videos", { credentials: "include" });
  if (!res.ok) return;
  const { videos } = await res.json();
  allVideos = videos;
  renderVideos(sortVideos(videos, document.getElementById("sort-by").value));
}

function sortVideos(videos, by) {
  const copy = [...videos];
  if (by === "performance") copy.sort((a, b) => b.viewCount - a.viewCount);
  else copy.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return copy;
}

document.getElementById("sort-by")?.addEventListener("change", (e) => {
  renderVideos(sortVideos(allVideos, e.target.value));
});

function renderVideos(videos) {
  const prefillIds = new Set(JSON.parse(sessionStorage.getItem("peachy_prefill") || "[]"));
  sessionStorage.removeItem("peachy_prefill");

  const list = document.getElementById("video-list");
  list.innerHTML = "";
  videos.forEach((v) => {
    const el = document.createElement("div");
    el.className = "video-tile" + (v.locked ? " locked" : "");
    el.innerHTML = `<img src="${v.thumbnail || ""}" alt=""><div><strong>${v.title}</strong>${v.locked ? "<br><small>Already in another job</small>" : ""}</div>`;
    if (!v.locked) {
      el.addEventListener("click", () => toggleSelect(v, el));
      if (prefillIds.has(v.videoId) && selectedVideos.length < 5) toggleSelect(v, el);
    }
    list.appendChild(el);
  });
}

function toggleSelect(video, el) {
  const idx = selectedVideos.findIndex((v) => v.videoId === video.videoId);
  if (idx >= 0) {
    selectedVideos.splice(idx, 1);
    el.classList.remove("selected");
  } else if (selectedVideos.length < 5) {
    selectedVideos.push(video);
    el.classList.add("selected");
  }
  document.getElementById("select-count").textContent = `${selectedVideos.length} / 5 selected`;
  document.getElementById("to-step-3").disabled = selectedVideos.length !== 5;
}

function renderSummaryFields() {
  const wrap = document.getElementById("summary-fields");
  wrap.innerHTML = selectedVideos
    .map(
      (v, i) => `<label style="display:block;margin-top:12px;">${v.title}
      <textarea data-idx="${i}" rows="2" style="width:100%;border-radius:10px;border:1.5px solid var(--accent-dim);padding:8px;font-family:inherit;" placeholder="Optional short summary"></textarea></label>`
    )
    .join("");
}

document.getElementById("to-step-3")?.addEventListener("click", () => {
  renderSummaryFields();
  showStep(3);
});

document.getElementById("to-step-4")?.addEventListener("click", async () => {
  const style = document.getElementById("title-style").value;
  const angle = document.getElementById("title-angle").value;
  document.querySelectorAll("#summary-fields textarea").forEach((t) => {
    selectedVideos[Number(t.dataset.idx)].userSummary = t.value;
  });
  document.getElementById("review-summary").textContent =
    `${selectedVideos.length} videos · style: ${style} · angle: ${angle} · 12 weekly runs`;

  const res = await fetch("/api/wizard/select", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, videos: selectedVideos, titleStyle: style, titleAngle: angle }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error === "full" && typeof showFullyBookedModal === "function") showFullyBookedModal();
    else alert(data.error);
    return;
  }
  currentJobId = data.jobId;
  showStep(4);
  renderPricingScreen();
});

async function renderPricingScreen() {
  const res = await fetch("/api/pricing");
  const p = await res.json();

  const summary = document.getElementById("price-summary");
  const perVideo = `$${p.perVideoPrice.toFixed(0)}/video`;
  summary.innerHTML = p.launchActive
    ? `<div class="price-summary">
        <span class="was">$${p.regularPrice}</span><span class="now">$${p.launchPrice}</span>
        <div class="per-video">That's ${perVideo} — 5 videos, one payment.</div>
        <div class="launch-note">Launch price, good through ${new Date(p.endsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}. $${p.regularPrice} after.</div>
      </div>`
    : `<div class="price-summary">
        <span class="now">$${p.regularPrice}</span>
        <div class="per-video">That's ${perVideo} — 5 videos, one payment.</div>
      </div>`;

  const rows = p.comparisons
    .map((c) => {
      const amount = c.low === c.high ? `$${c.low}` : `$${c.low}–${c.high}`;
      return `<tr><td>${c.label}</td><td>${amount} <span style="font-weight:400;color:var(--ink-dim);">${c.unit}</span></td></tr>`;
    })
    .join("");

  document.getElementById("value-comparison").innerHTML = `
    <table class="compare-table">
      ${rows}
      <tr class="peachy-row"><td>Peachy — 5 videos, 12 weekly title refreshes</td><td>${perVideo}</td></tr>
    </table>`;
}

document.getElementById("checkout-btn")?.addEventListener("click", async () => {
  const res = await fetch("/api/checkout/create", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId: currentJobId }),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  location.href = data.checkoutUrl;
});

// Entry: if a session+step already exist (post-OAuth redirect), jump there.
if (sessionId && startStep >= 2) {
  showStep(2);
  loadVideos();
} else {
  showStep(1);
}
