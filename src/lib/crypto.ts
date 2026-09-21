// Encrypts oauth_refresh_token at rest. Key comes from the ENCRYPTION_KEY secret
// (32 raw bytes, base64). Format stored in D1: "<base64 iv>.<base64 ciphertext>".

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(ct)))}`;
}

export async function decrypt(stored: string, base64Key: string): Promise<string> {
  const [ivB64, ctB64] = stored.split(".");
  const key = await importKey(base64Key);
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
