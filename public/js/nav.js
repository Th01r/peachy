async function initNav() {
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
