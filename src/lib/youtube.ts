// Google OAuth (identity + YouTube data, kept as two separate consent steps
// per spec 5.1) and the YouTube Data API calls Peachy needs.

export function googleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scope,
    access_type: "offline",
    prompt: "consent", // ensures a refresh_token is returned every time
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; id_token: string; expires_in: number }>;
}

export async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export function decodeIdToken(idToken: string): { sub: string; email: string; name?: string } {
  const payload = idToken.split(".")[1];
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

export async function getUploadsPlaylistId(accessToken: string): Promise<string> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  const data = (await res.json()) as any;
  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

export async function listUploads(accessToken: string, playlistId: string, pageToken?: string) {
  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    playlistId,
    maxResults: "50",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return res.json() as Promise<{ items: any[]; nextPageToken?: string }>;
}

export async function getVideoStats(accessToken: string, videoIds: string[]) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(",")}`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  const data = (await res.json()) as any;
  return data.items as any[];
}

// videos.update overwrites the WHOLE snippet object, not just title - a bug
// dropping categoryId etc. silently corrupts metadata (spec 11 open risk).
// Always fetch-then-merge, only mutating `title`.
export async function updateVideoTitle(accessToken: string, videoId: string, newTitle: string) {
  const [existing] = await getVideoStats(accessToken, [videoId]);
  const snippet = { ...existing.snippet, title: newTitle };
  const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: videoId, snippet }),
  });
  if (!res.ok) throw new Error(`videos.update failed for ${videoId}: ${await res.text()}`);
  return res.json();
}

// No-auth path: public video lookup via API key (no OAuth) for the lead-gen flow.
export async function getPublicVideo(videoId: string, apiKey: string) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`
  );
  const data = (await res.json()) as any;
  return data.items?.[0];
}
