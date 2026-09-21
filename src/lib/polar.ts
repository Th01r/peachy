// Polar REST API directly (no SDK dependency - keeps this swappable/lean).
// Docs: https://polar.sh/docs/api-reference

const POLAR_BASE = (server: "sandbox" | "production") =>
  server === "sandbox" ? "https://sandbox-api.polar.sh/v1" : "https://api.polar.sh/v1";

export async function createCheckout(opts: {
  accessToken: string;
  server: "sandbox" | "production";
  productId: string;
  successUrl: string;
  customerEmail: string;
  metadata: Record<string, string>;
}) {
  const res = await fetch(`${POLAR_BASE(opts.server)}/checkouts/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      products: [opts.productId],
      success_url: opts.successUrl,
      customer_email: opts.customerEmail,
      metadata: opts.metadata,
    }),
  });
  if (!res.ok) throw new Error(`Polar checkout create failed: ${await res.text()}`);
  return res.json() as Promise<{ id: string; url: string }>;
}

// Polar signs webhooks using the standard-webhooks spec (svix-compatible):
// headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (base64 HMAC-SHA256
// over `${id}.${timestamp}.${body}`, keyed by the base64 portion of the secret).
export async function verifyWebhook(req: Request, rawBody: string, secret: string): Promise<boolean> {
  const id = req.headers.get("webhook-id");
  const timestamp = req.headers.get("webhook-timestamp");
  const signatureHeader = req.headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const secretKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(secretKey), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  return signatureHeader
    .split(" ")
    .some((sig) => sig.split(",")[1] === expected);
}
