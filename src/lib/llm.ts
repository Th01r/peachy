// Swappable LLM interface (constraint: no-CC free tier, must stay swappable).
// Primary: Groq (openai/gpt-oss-120b) - fastest free tier, no CC. Verified 2026.
// Fallback: Gemini 2.5 Flash - also no CC, used only if Groq errors/rate-limits.

export interface TitleGenInput {
  currentTitle: string;
  description: string;
  transcriptExcerpt: string; // may be "" if transcript_status = 'failed'
  userSummary?: string;
  style: string; // verbatim definition, not just the enum key - see prompts/title.ts
  angle: string;
  competitorTitles: string[];
  trendingKeywords: string[];
}

export interface LLM {
  generateTitle(input: TitleGenInput): Promise<string>;
}

async function callGroq(input: TitleGenInput, apiKey: string): Promise<string> {
  const { buildMessages } = await import("../prompts/title");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: buildMessages(input),
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  const parsed = JSON.parse(data.choices[0].message.content);
  return parsed.title;
}

async function callGemini(input: TitleGenInput, apiKey: string): Promise<string> {
  const { buildMessages } = await import("../prompts/title");
  const msgs = buildMessages(input);
  const system = msgs.find((m) => m.role === "system")!.content;
  const user = msgs.find((m) => m.role === "user")!.content;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
  return parsed.title;
}

export function createLLM(env: { GROQ_API_KEY: string; GEMINI_API_KEY: string }): LLM {
  return {
    async generateTitle(input) {
      try {
        return await callGroq(input, env.GROQ_API_KEY);
      } catch (err) {
        console.error("Groq failed, falling back to Gemini:", err);
        return await callGemini(input, env.GEMINI_API_KEY);
      }
    },
  };
}
