function showFullyBookedModal() {
  if (document.getElementById("full-modal")) return;
  const el = document.createElement("div");
  el.id = "full-modal";
  el.style.cssText = "position:fixed;inset:0;background:rgba(58,42,31,.45);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px;";
  el.innerHTML = `<div class="card" style="max-width:420px;text-align:center;">
    <h2>Temporarily fully booked</h2>
    <p style="color:var(--ink-dim);">Peachy caps how many jobs run at once to stay within YouTube's API limits.
    We're at capacity right now — please check back soon.</p>
    <button class="btn" id="full-modal-close">Got it</button>
  </div>`;
  document.body.appendChild(el);
  document.getElementById("full-modal-close").addEventListener("click", () => el.remove());
}

// Returns true if booked out; also shows the modal as a side effect when called directly.
async function checkCapacityAndBlock() {
  try {
    const res = await fetch("/api/capacity");
    const data = await res.json();
    if (data.full) {
      showFullyBookedModal();
      return true;
    }
    return false;
  } catch {
    return false; // fail open - never block the funnel over a network hiccup
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Landing page CTA: check before letting the click navigate to the wizard.
  document.getElementById("start")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const full = await checkCapacityAndBlock();
    if (!full) location.href = "/wizard.html";
  });

  // Wizard entry: either arrived with ?full=1 (server-side redirect after OAuth
  // found no capacity) or loading step 1 fresh - check either way.
  if (document.getElementById("step-1")) {
    if (new URLSearchParams(location.search).get("full") === "1") {
      showFullyBookedModal();
    } else {
      checkCapacityAndBlock();
    }
  }
});
