// AI-generated clickbait hooks for viral clips
// Takes a transcript snippet and generates a curiosity-driven TikTok-style hook

export interface GenerateHookOpts {
  transcript: string; // the clip's transcript text
  maxWords?: number; // default 7
  style?: "curiosity" | "bold" | "question" | "story";
}

/**
 * Generate a viral TikTok hook from a transcript snippet.
 * Uses an LLM (OpenAI-compatible API) to rewrite the content as a short hook.
 * 
 * Requires OPENAI_API_KEY or OPENAI_BASE_URL env vars to be set.
 */
export async function generateHook(opts: GenerateHookOpts): Promise<string> {
  const maxWords = opts.maxWords ?? 7;
  const style = opts.style ?? "curiosity";

  const stylePrompts = {
    curiosity: "Make it curiosity-driven. No clickbait words like 'shocking' or 'you won't believe'.",
    bold: "Make it bold and declarative. Strong statement.",
    question: "Turn it into a question that makes people want to know the answer.",
    story: "Frame it as the beginning of a story. 'This is how...' or 'The day I...'",
  };

  const systemPrompt = `You are a viral TikTok copywriter. Rewrite transcripts as ultra-short hooks (${maxWords} words max) that stop scrollers. ${stylePrompts[style]}

Examples of GOOD hooks:
- "This Changed Everything For Me"
- "The Truth About Morning Routines"
- "Why I Quit My 6-Figure Job"
- "Nobody Talks About This"
- "The One Thing That Fixed It"

BAD hooks (avoid these):
- "You Won't Believe What Happened"
- "This Is Shocking"
- "Wait Until You See This"

Return ONLY the hook text, no quotes, no explanation.`;

  const userPrompt = `Transcript:\n${opts.transcript.slice(0, 500)}\n\nHook (${maxWords} words max):`;

  // Check for OpenAI API configuration
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set — returning fallback hook");
    // Fallback: use first sentence of transcript
    const firstSentence = opts.transcript.split(/[.!?]/)[0]?.trim() || opts.transcript.slice(0, 50);
    return firstSentence.split(" ").slice(0, maxWords).join(" ");
  }

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 30,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const hook = data.choices?.[0]?.message?.content?.trim() || "";
    
    if (!hook) {
      throw new Error("Empty response from LLM");
    }

    return hook;
  } catch (err: any) {
    console.warn(`Hook generation failed: ${err.message} — using fallback`);
    const firstSentence = opts.transcript.split(/[.!?]/)[0]?.trim() || opts.transcript.slice(0, 50);
    return firstSentence.split(" ").slice(0, maxWords).join(" ");
  }
}
