import type { TitleGenInput } from "../lib/llm";

// Verbatim definitions from master-build-prompt.md section 8.1, so the model
// gets a consistent reading of style/angle rather than inferring from the label.
export const STYLE_DEFS: Record<string, string> = {
  veritasium: "curiosity-driven, understated framing built around an intriguing question or surprising claim",
  mr_beast: "high-stakes, superlative- and scale-forward, urgency-driven",
  how_to: "direct, instructional, keyword-forward, states the outcome plainly",
  listicle: "numbered, promises a countable set of items",
  direct_seo: "plain, keyword-first, minimal embellishment",
};

export const ANGLE_DEFS: Record<string, string> = {
  problem_unaware: "surfaces a problem the viewer may not know they have",
  curiosity_gap: "withholds a key detail to create an open loop",
  benefit_driven: "leads with the concrete outcome/result",
  social_proof: "leans on scale, credibility, or authority signals",
};

export function buildMessages(input: TitleGenInput) {
  const system = `You write YouTube titles. Output exactly one title, under 100 characters, and it must not misrepresent the video's actual content (no clickbait that lies).

Apply this STYLE as the primary structural pattern: "${input.style}" — ${STYLE_DEFS[input.style] ?? input.style}
Apply this ANGLE as the primary psychological hook: "${input.angle}" — ${ANGLE_DEFS[input.angle] ?? input.angle}

Weight the competitor titles and trending keywords provided, but prioritize accuracy to the actual video content over keyword-stuffing.

Return strict JSON only, no markdown: {"title": "..."}`;

  const user = `Current title: ${input.currentTitle}
Description: ${input.description || "(none)"}
Creator's own summary: ${input.userSummary || "(none provided)"}
Transcript excerpt: ${input.transcriptExcerpt || "(unavailable - rely on title/description/summary)"}

Currently-ranking competitor titles for this topic:
${input.competitorTitles.map((t) => `- ${t}`).join("\n") || "(none found)"}

Trending keywords / autocomplete phrases for this topic:
${input.trendingKeywords.join(", ") || "(none found)"}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}
