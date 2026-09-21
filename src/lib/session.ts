// Minimal signed session cookie: base64(userId).base64(hmac). No expiry logic
// beyond the cookie's own Max-Age - sessions are cheap to re-issue via sign-in.

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function createSessionCookie(userId: string, secret: string): Promise<string> {
  const sig = await hmac(userId, secret);
  const value = `${userId}.${sig}`;
  return `peachy_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export async function verifySession(cookieHeader: string | null, secret: string): Promise<string | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/peachy_session=([^;]+)/);
  if (!match) return null;
  const [userId, sig] = decodeURIComponent(match[1]).split(".");
  if (!userId || !sig) return null;
  const expected = await hmac(userId, secret);
  return expected === sig ? userId : null;
}
