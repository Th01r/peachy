// Unofficial public transcript method (timedtext feed) - no OAuth scope, no quota
// cost. Works for both the paid weekly flow and the no-auth lead-gen flow.

const WORD_BUDGET = 2500; // conservative vs. Groq free-tier context/rate limits - documented per spec 8.5.2

export type TranscriptStatus = "ok" | "failed" | "truncated";

export interface TranscriptResult {
  text: string;
  status: TranscriptStatus;
}

async function fetchRawTranscript(videoId: string): Promise<string | null> {
  try {
    // Discover available caption tracks, then pull the first (usually the
    // original-language) one as plain timedtext XML.
    const listRes = await fetch(
      `https://video.google.com/timedtext?type=list&v=${videoId}`
    );
    if (!listRes.ok) return null;
    const listXml = await listRes.text();
    const langMatch = listXml.match(/lang_code="([^"]+)"/);
    const lang = langMatch ? langMatch[1] : "en";

    const ttRes = await fetch(
      `https://video.google.com/timedtext?lang=${lang}&v=${videoId}`
    );
    if (!ttRes.ok) return null;
    const xml = await ttRes.text();
    if (!xml.includes("<text")) return null;

    const chunks = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
      m[1]
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
    );
    return chunks.join(" ").trim();
  } catch (err) {
    console.error(`Transcript fetch failed for ${videoId}:`, err);
    return null;
  }
}

export async function getTranscript(videoId: string): Promise<TranscriptResult> {
  const raw = await fetchRawTranscript(videoId);
  if (!raw) return { text: "", status: "failed" };

  const words = raw.split(/\s+/);
  if (words.length <= WORD_BUDGET) return { text: raw, status: "ok" };

  // Deterministic sample, don't summarize via a second LLM call (spec 8.5.3):
  // first ~40% + last ~20%, skip the middle - intros/outros carry topic signal.
  const first = words.slice(0, Math.floor(WORD_BUDGET * 0.67)); // 40% of total budget's worth
  const last = words.slice(-Math.floor(WORD_BUDGET * 0.33));
  return { text: `${first.join(" ")} ... ${last.join(" ")}`, status: "truncated" };
}
