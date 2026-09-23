async function initNav() {
  const priceEl = document.getElementById("nav-price-popover");
  if (priceEl) {
    fetch("/api/pricing")
      .then((r) => r.json())
      .then((p) => {
        priceEl.innerHTML = p.launchActive
          ? `<strong>$${p.launchPrice} / job</strong> <span style="text-decoration:line-through;opacity:.6;">$${p.regularPrice}</span><br>5 videos, 12 weekly updates.`
          : `<strong>$${p.regularPrice} / job</strong><br>5 videos, 12 weekly updates.`;
      })
      .catch(() => {});
  }

  const el = document.getElementById("nav-account-target");
  if (!el) return;
  try {
    const res = await fetch("/api/account/me", { credentials: "include" });
    if (!res.ok) throw new Error("not signed in");
    const { user, jobs } = await res.json();
    el.href = jobs.length ? "/account.html" : "/#start";
    el.querySelector(".popover").innerHTML = jobs.length
      ? `<strong>${user.name ?? user.email}</strong><br>${jobs.length} job${jobs.length === 1 ? "" : "s"}`
      : `Not signed in yet`;
  } catch {
    el.href = "/#start";
  }
}
document.addEventListener("DOMContentLoaded", initNav);
