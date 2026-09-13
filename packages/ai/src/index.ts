import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// ─── Types ───

export interface TTSOpts {
  text: string;
  voice?: string;
  outputPath: string;
}

export interface STTOpts {
  inputPath: string;
  language?: string;
}

export interface Caption {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface ImageGenOpts {
  prompt: string;
  outputPath: string;
  width?: number;
  height?: number;
}

export interface VoiceInfo {
  id: string;
  name: string;
  gender: "Male" | "Female";
  style: string;
}

// ─── Script Generation Types ───

export type ScriptStyle =
  | "church"
  | "motivational"
  | "story"
  | "educational"
  | "entertainment"
  | "news";

export interface GenerateScriptOpts {
  topic: string;
  style?: ScriptStyle;
  duration?: number; // target duration in seconds (default: 30)
  platform?: "tiktok" | "reels" | "shorts" | "all";
  apiKey?: string;
  apiBase?: string;
}

export interface GeneratedScript {
  hook: string;
  script: string;
  callToAction: string;
  hashtags: string[];
  estimatedDuration: number; // seconds
}

// ─── Hook Scorer ───

export interface HookScore {
  score: number; // 0-100
  grade: "S" | "A" | "B" | "C" | "D" | "F";
  breakdown: {
    length: number;
    powerWords: number;
    curiosity: number;
    specificity: number;
    urgency: number;
    emotion: number;
  };
  suggestions: string[];
}

const POWER_WORDS = new Set([
  "never",
  "always",
  "secret",
  "truth",
  "lie",
  "shocking",
  "insane",
  "incredible",
  "impossible",
  "crazy",
  "amazing",
  "destroy",
  "kill",
  "die",
  "death",
  "hell",
  "heaven",
  "god",
  "jesus",
  "miracle",
  "proof",
  "evidence",
  "science",
  "study",
  "research",
  "doctor",
  "warning",
  "danger",
  "risk",
  "fear",
  "scared",
  "terrified",
  "urgent",
  "breaking",
  "exclusive",
  "confession",
  "admit",
  "nobody",
  "everyone",
  "always",
  "never",
  "stop",
  "watch",
  "listen",
  "remember",
  "forget",
  "mistake",
  "wrong",
  "right",
  "million",
  "billion",
  "percent",
  "zero",
  "one",
  "first",
  "last",
  "best",
  "worst",
  "biggest",
  "smallest",
  "fastest",
  "strongest",
]);

const CURIOSITY_TRIGGERS = [
  /\b(why|how|what if|what happens|the reason|the truth|nobody tells|secret|hidden)\b/i,
  /\?/, // questions create curiosity
  /\.\.\./, // ellipsis creates suspense
  /\bbut\b/i, // "but" creates tension
  /\bbefore it's too late\b/i,
  /\byou won't believe\b/i,
  /\bthis will change\b/i,
];

const URGENCY_TRIGGERS = [
  /\bright now\b/i,
  /\btoday\b/i,
  /\bbefore\b/i,
  /\bstop\b/i,
  /\bbreaking\b/i,
  /\bbefore it's too late\b/i,
  /\bfinal\b/i,
  /\blast chance\b/i,
];

const EMOTION_TRIGGERS = [
  /\b(love|hate|fear|hope|dream|nightmare|pain|suffer|joy|tears)\b/i,
  /\b(angry|furious|devastated|heartbroken|terrified|ecstatic)\b/i,
  /\b(family|mother|father|child|baby|home)\b/i,
];

export function scoreHook(hook: string): HookScore {
  const words = hook.trim().split(/\s+/);
  const wordCount = words.length;
  const lower = hook.toLowerCase();
  const suggestions: string[] = [];

  // 1. Length score (0-20): shorter hooks are better
  // Sweet spot: 3-8 words
  let lengthScore: number;
  if (wordCount <= 3) lengthScore = 20;
  else if (wordCount <= 8) lengthScore = 18;
  else if (wordCount <= 12) lengthScore = 14;
  else if (wordCount <= 18) lengthScore = 8;
  else lengthScore = 3;

  if (wordCount > 10)
    suggestions.push("Shorten to under 10 words for maximum impact");

  // 2. Power words (0-20)
  const powerCount = words.filter((w) =>
    POWER_WORDS.has(w.toLowerCase()),
  ).length;
  const powerScore = Math.min(20, powerCount * 7);

  if (powerCount === 0)
    suggestions.push(
      "Add 1-2 power words (secret, never, truth, insane, proof)",
    );

  // 3. Curiosity (0-20)
  const hasCuriosity = CURIOSITY_TRIGGERS.some((re) => re.test(hook));
  const curiosityScore = hasCuriosity ? 20 : 5;

  if (!hasCuriosity)
    suggestions.push(
      "Add a curiosity trigger (question, ellipsis, 'the truth about')",
    );

  // 4. Specificity (0-15): numbers and concrete details
  const hasNumber = /\d+/.test(hook);
  const hasSpecificNoun =
    /\b(study|research|doctor|scientist|expert|billion|million)\b/i.test(hook);
  let specificityScore = 0;
  if (hasNumber) specificityScore += 8;
  if (hasSpecificNoun) specificityScore += 7;
  if (specificityScore === 0) specificityScore = 3;

  if (!hasNumber && !hasSpecificNoun)
    suggestions.push(
      "Add a specific detail (number, study, expert) for credibility",
    );

  // 5. Urgency (0-15)
  const hasUrgency = URGENCY_TRIGGERS.some((re) => re.test(hook));
  const urgencyScore = hasUrgency ? 15 : 4;

  if (!hasUrgency)
    suggestions.push("Add urgency (right now, stop, before, breaking)");

  // 6. Emotion (0-15)
  const hasEmotion = EMOTION_TRIGGERS.some((re) => re.test(hook));
  const emotionScore = hasEmotion ? 15 : 5;

  if (!hasEmotion)
    suggestions.push("Add emotional trigger (fear, hope, love, pain)");

  // Calculate total
  const total =
    lengthScore +
    powerScore +
    curiosityScore +
    specificityScore +
    urgencyScore +
    emotionScore;
  const score = Math.min(100, total);

  // Grade
  let grade: HookScore["grade"];
  if (score >= 90) grade = "S";
  else if (score >= 80) grade = "A";
  else if (score >= 65) grade = "B";
  else if (score >= 50) grade = "C";
  else if (score >= 35) grade = "D";
  else grade = "F";

  return {
    score,
    grade,
    breakdown: {
      length: lengthScore,
      powerWords: powerScore,
      curiosity: curiosityScore,
      specificity: specificityScore,
      urgency: urgencyScore,
      emotion: emotionScore,
    },
    suggestions: suggestions.slice(0, 3), // top 3 suggestions
  };
}

// ─── Script Variation Generator ───

export interface GenerateVariationsOpts {
  topic: string;
  style?: ScriptStyle;
  count?: number; // 3-5 variations
  angle?: string; // optional angle hint
  apiKey?: string;
  apiBase?: string;
}

export interface ScriptVariation {
  hook: string;
  script: string;
  callToAction: string;
  hashtags: string[];
  angle: string;
  hookScore: HookScore;
}

export async function generateVariations(
  opts: GenerateVariationsOpts,
): Promise<ScriptVariation[]> {
  const apiKey = opts.apiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DeepSeek API key required");
  }

  const apiBase =
    opts.apiBase || process.env.DEEPSEEK_API_BASE || DEFAULT_API_BASE;
  const count = Math.min(5, Math.max(3, opts.count ?? 5));

  const systemPrompt = `You are a viral short-form video content strategist. Generate ${count} unique script variations for the same topic, each with a different angle/hook approach. Each must feel like a completely different video.

Angles to use (vary these):
- Contrarian take ("Everyone thinks X, but actually Y")
- Personal story ("I tried X and here's what happened")
- Expert authority ("Doctors/scientists confirm X")
- Emotional appeal ("This made me cry / change my life")
- Shock value ("This is insane / nobody talks about this")

Return valid JSON only, no markdown.`;

  const userPrompt = `Generate ${count} unique script variations about: "${opts.topic}"

Style: ${opts.style ?? "motivational"}

Return JSON with this exact structure:
{
  "variations": [
    {
      "hook": "Attention-grabbing first line (1-2 sentences)",
      "script": "Main content (20-25 seconds of speech)",
      "callToAction": "Closing CTA (1 sentence)",
      "hashtags": ["5-7 hashtags without #"],
      "angle": "Brief description of the angle used"
    }
  ]
}`;

  const response = await fetch(`${apiBase}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `DeepSeek API error (${response.status}): ${err.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in API response");

  const parsed = JSON.parse(content) as {
    variations: {
      hook: string;
      script: string;
      callToAction: string;
      hashtags: string[];
      angle: string;
    }[];
  };

  // Score each hook
  return (parsed.variations ?? []).map((v) => ({
    ...v,
    hookScore: scoreHook(v.hook),
  }));
}

// ─── Voice Registry ───

const VOICES: VoiceInfo[] = [
  { id: "en-US-GuyNeural", name: "Guy", gender: "Male", style: "Warm, casual" },
  {
    id: "en-US-AndrewNeural",
    name: "Andrew",
    gender: "Male",
    style: "Confident, authentic",
  },
  {
    id: "en-US-BrianNeural",
    name: "Brian",
    gender: "Male",
    style: "Approachable, casual",
  },
  {
    id: "en-US-ChristopherNeural",
    name: "Christopher",
    gender: "Male",
    style: "Reliable, authority",
  },
  {
    id: "en-US-AriaNeural",
    name: "Aria",
    gender: "Female",
    style: "Positive, confident",
  },
  {
    id: "en-US-AvaNeural",
    name: "Ava",
    gender: "Female",
    style: "Expressive, friendly",
  },
  {
    id: "en-US-EmmaNeural",
    name: "Emma",
    gender: "Female",
    style: "Cheerful, clear",
  },
  {
    id: "en-US-AnaNeural",
    name: "Ana",
    gender: "Female",
    style: "Cute, conversational",
  },
];

export function listVoices(): VoiceInfo[] {
  return VOICES;
}

// ─── Script Generation (DeepSeek API) ───

const DEFAULT_API_BASE = "https://api.deepseek.com";
// The legacy "deepseek-chat" / "deepseek-reasoner" aliases were retired
// on 2026-07-24 and no longer resolve. Override with DEEPSEEK_MODEL.
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

export async function generateScript(
  opts: GenerateScriptOpts,
): Promise<GeneratedScript> {
  const apiKey = opts.apiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DeepSeek API key required. Set DEEPSEEK_API_KEY env var or pass apiKey in options.",
    );
  }

  const apiBase =
    opts.apiBase || process.env.DEEPSEEK_API_BASE || DEFAULT_API_BASE;
  const duration = opts.duration ?? 30;
  const platform = opts.platform ?? "all";

  const systemPrompt = `You are a viral short-form video scriptwriter. Generate engaging scripts optimized for ${platform} that maximize watch time and engagement.

Rules:
- Hook must grab attention in first 1-2 seconds
- Keep language conversational and punchy
- Use short sentences for better pacing
- Include a clear call-to-action at the end
- Estimate word count based on target duration (avg 2.5 words/sec for natural speech)
- Return valid JSON only, no markdown`;

  const userPrompt = `Write a ${duration}-second short-form video script about: "${opts.topic}"

Style: ${opts.style ?? "motivational"}

Return JSON with this exact structure:
{
  "hook": "First 1-2 second attention grabber (1 sentence)",
  "script": "Main content body (keep under ${Math.round(duration * 2.5)} words)",
  "callToAction": "Closing CTA (1 sentence)",
  "hashtags": ["5-7 relevant hashtags without #"],
  "estimatedDuration": ${duration}
}`;

  const response = await fetch(`${apiBase}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 500,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `DeepSeek API error (${response.status}): ${err.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No content in API response");
  }

  const parsed = JSON.parse(content) as GeneratedScript;

  // Validate required fields
  if (!parsed.hook || !parsed.script) {
    throw new Error("Invalid script format: missing hook or script");
  }

  return {
    hook: parsed.hook,
    script: parsed.script,
    callToAction: parsed.callToAction ?? "",
    hashtags: parsed.hashtags ?? [],
    estimatedDuration: parsed.estimatedDuration ?? duration,
  };
}

// ─── TTS (Text-to-Speech) ───

export async function textToSpeech(opts: TTSOpts): Promise<string> {
  const voice = opts.voice ?? "en-US-GuyNeural";

  // Try Piper first (local), fall back to edge-tts
  if (isPiperAvailable()) {
    return piperTTS({ ...opts, voice });
  }
  return edgeTTS({ ...opts, voice });
}

function isPiperAvailable(): boolean {
  try {
    const proc = Bun.spawnSync(["which", "piper"]);
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

const PIPER_VOICE_MAP: Record<string, string> = {
  "en-US-GuyNeural": "en_US-lessac-medium",
  "en-US-AndrewNeural": "en_US-lessac-medium",
  "en-US-BrianNeural": "en_US-lessac-medium",
  "en-US-ChristopherNeural": "en_US-lessac-medium",
  "en-US-AriaNeural": "en_US-amy-medium",
  "en-US-AvaNeural": "en_US-amy-medium",
  "en-US-EmmaNeural": "en_US-amy-medium",
};

function edgeToPiperModel(edgeVoice: string): string {
  return PIPER_VOICE_MAP[edgeVoice] ?? "en_US-lessac-medium";
}

async function piperTTS(opts: TTSOpts): Promise<string> {
  const voiceModel = edgeToPiperModel(opts.voice ?? "en-US-GuyNeural");
  const proc = Bun.spawn(
    ["piper", "--model", voiceModel, "--output_file", opts.outputPath],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  proc.stdin.write(opts.text);
  proc.stdin.end();

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Piper exited ${exitCode}: ${stderr.slice(-500)}`);
  }
  return opts.outputPath;
}

async function edgeTTS(opts: TTSOpts): Promise<string> {
  ensureDir(dirname(opts.outputPath));
  const proc = Bun.spawn(
    [
      "edge-tts",
      "--text",
      opts.text,
      "--voice",
      opts.voice ?? "en-US-GuyNeural",
      "--write-media",
      opts.outputPath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`edge-tts exited ${exitCode}: ${stderr.slice(-500)}`);
  }
  return opts.outputPath;
}

// ─── STT (Speech-to-Text) ───

/**
 * Resolve which Whisper model to use.
 *
 * medium is a large accuracy gain over "base" on sermon audio:
 * theological vocabulary, scripture references and proper nouns.
 * Highlight selection reads this transcript, so errors here propagate
 * into which clips get chosen. The .en variant is more accurate but
 * English-only, so fall back to multilingual "medium" for other
 * languages. Override with WHISPER_MODEL ("large-v3" for best accuracy,
 * "base" or "small.en" for speed).
 */
function resolveWhisperModel(language?: string): string {
  const override = process.env.WHISPER_MODEL;
  if (override) return override;
  return (language ?? "en") === "en" ? "medium.en" : "medium";
}

export async function speechToText(opts: STTOpts): Promise<Caption[]> {
  if (!existsSync(opts.inputPath)) {
    throw new Error(`Audio file not found: ${opts.inputPath}`);
  }

  const tmpDir = join(dirname(opts.inputPath), `.whisper-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    const model = resolveWhisperModel(opts.language);

    // Prefer faster-whisper: same weights via CTranslate2 int8, roughly
    // 4x faster on ~60% of the RAM, which is what makes `medium` viable
    // on a laptop. Falls back to the reference `whisper` CLI when
    // faster-whisper is not installed, so transcription never hard-fails
    // on a machine that only has the original package.
    const fastResult = await transcribeWithFasterWhisper(
      opts,
      tmpDir,
      model,
    );
    if (fastResult) return fastResult;

    const proc = Bun.spawn(
      [
        "whisper",
        opts.inputPath,
        "--model",
        model,
        "--output_format",
        "json",
        "--output_dir",
        tmpDir,
        "--word_timestamps",
        "True",
        "--language",
        opts.language ?? "en",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`whisper exited ${exitCode}: ${stderr.slice(-500)}`);
    }

    // Parse whisper JSON output
    const baseName =
      opts.inputPath
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "output";
    const jsonPath = join(tmpDir, `${baseName}.json`);

    if (!existsSync(jsonPath)) {
      throw new Error("whisper did not produce output");
    }

    const raw = readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(raw);
    return parseWhisperOutput(data);
  } finally {
    // Cleanup temp dir
    try {
      const files = readdirSync(tmpDir);
      for (const f of files) unlinkSync(join(tmpDir, f));
      rmSync(tmpDir);
    } catch {}
  }
}

/**
 * Try transcribing via faster-whisper (CTranslate2, int8).
 *
 * Returns null — rather than throwing — when faster-whisper is simply not
 * installed, so the caller can fall back to the reference whisper CLI.
 * A genuine transcription failure (bad audio, corrupt model) does throw,
 * because silently falling back would hide a real problem behind a much
 * slower second attempt that fails the same way.
 *
 * Exit codes from transcribe_fast.py:
 *   0 = success, 2 = bad args, 3 = faster-whisper not installed
 */
async function transcribeWithFasterWhisper(
  opts: STTOpts,
  tmpDir: string,
  model: string,
): Promise<Caption[] | null> {
  if (process.env.WHISPER_BACKEND === "openai") return null;

  const scriptPath = join(__dirname, "transcribe_fast.py");
  if (!existsSync(scriptPath)) return null;

  const jsonPath = join(tmpDir, "faster-whisper.json");

  const proc = Bun.spawn(
    [
      "python3",
      scriptPath,
      opts.inputPath,
      jsonPath,
      model,
      opts.language ?? "en",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // 3 = faster-whisper not installed. Not an error; use the fallback.
  if (exitCode === 3) {
    console.warn(
      "faster-whisper not installed, falling back to whisper CLI. " +
        "Install with: pip install faster-whisper",
    );
    return null;
  }

  // python3 itself missing, or the script could not start at all.
  if (exitCode !== 0 && !existsSync(jsonPath)) {
    console.warn(
      `faster-whisper unavailable (exit ${exitCode}), ` +
        `falling back to whisper CLI: ${stderr.slice(-300)}`,
    );
    return null;
  }

  if (exitCode !== 0) {
    throw new Error(
      `faster-whisper failed (exit ${exitCode}): ${stderr.slice(-500)}`,
    );
  }

  if (!existsSync(jsonPath)) {
    throw new Error("faster-whisper did not produce output");
  }

  const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
  return parseWhisperOutput(data);
}

function parseWhisperOutput(data: any): Caption[] {
  const captions: Caption[] = [];

  if (!data.segments || !Array.isArray(data.segments)) {
    return captions;
  }

  for (const seg of data.segments) {
    // If word-level timestamps exist, split into per-word captions
    if (seg.words && Array.isArray(seg.words)) {
      for (const w of seg.words) {
        const word = (w.word ?? "").trim();
        if (!word) continue;
        captions.push({
          text: word,
          startMs: Math.round((w.start ?? 0) * 1000),
          endMs: Math.round((w.end ?? 0) * 1000),
          confidence: w.probability,
        });
      }
    } else {
      // Fallback: use segment-level timestamps
      const text = (seg.text ?? "").trim();
      if (!text) continue;
      captions.push({
        text,
        startMs: Math.round((seg.start ?? 0) * 1000),
        endMs: Math.round((seg.end ?? 0) * 1000),
      });
    }
  }

  return captions;
}

// ─── Helpers ───

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── Phase 4: Background removal ───

export interface BgRemovalOpts {
  inputPath: string;
  outputPath: string;
}

export async function removeBackground(opts: BgRemovalOpts): Promise<string> {
  if (!existsSync(opts.inputPath)) {
    throw new Error(`Input file not found: ${opts.inputPath}`);
  }
  ensureDir(dirname(opts.outputPath));

  const proc = Bun.spawn(
    ["python3", "-m", "rembg", "i", opts.inputPath, opts.outputPath],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`rembg exited ${exitCode}: ${stderr.slice(-500)}`);
  }
  return opts.outputPath;
}

// ─── Phase 4: Audio tools ───

export interface AudioOpts {
  inputPath: string;
  outputPath: string;
}

export async function removeVocals(opts: AudioOpts): Promise<string> {
  if (!existsSync(opts.inputPath)) {
    throw new Error(`Input file not found: ${opts.inputPath}`);
  }
  ensureDir(dirname(opts.outputPath));

  // Use ffmpeg'spanremoval to extract center channel (vocals) and subtract
  // This is a simple stereo vocal removal: invert one channel and mix
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      opts.inputPath,
      "-af",
      "pan=stereo|c0=c0-c1|c1=c1-c0",
      opts.outputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`vocal removal failed: ${stderr.slice(-500)}`);
  }
  return opts.outputPath;
}

export async function enhanceAudio(opts: AudioOpts): Promise<string> {
  if (!existsSync(opts.inputPath)) {
    throw new Error(`Input file not found: ${opts.inputPath}`);
  }
  ensureDir(dirname(opts.outputPath));

  // Apply noise gate, compression, and normalization
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      opts.inputPath,
      "-af",
      "highpass=f=80,lowpass=f=12000,acompressor=threshold=-20dB:ratio=4:attack=5:release=50,volume=2.0,loudnorm=I=-16:TP=-1.5:LRA=11",
      opts.outputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`audio enhancement failed: ${stderr.slice(-500)}`);
  }
  return opts.outputPath;
}

// ─── Phase 4 stubs ───

export async function generateImage(_opts: ImageGenOpts): Promise<string> {
  throw new Error("Image gen not implemented yet — requires SD/ComfyUI setup");
}

// ─── Auto Clip: YouTube → highlight clips ───

export interface HighlightSegment {
  startMs: number;
  endMs: number;
  text: string;
  score: number;
}

export interface AutoClipOpts {
  url: string;
  clipCount?: number;
  minDuration?: number;
  maxDuration?: number;
  language?: string;
}

export interface AutoClipResult {
  sourcePath: string;
  clips: {
    path: string;
    startMs: number;
    endMs: number;
    text: string;
    score: number;
    suggestedTitle?: string;
  }[];
  allCaptions?: Caption[];
}

const HOOK_WORDS = new Set([
  "amazing",
  "incredible",
  "unbelievable",
  "insane",
  "crazy",
  "shocking",
  "mind-blowing",
  "impossible",
  "never",
  "always",
  "secret",
  "truth",
  "lie",
  "why",
  "how",
  "what if",
  "god",
  "jesus",
  "miracle",
  "powerful",
  "destroy",
  "hell",
  "heaven",
  "sin",
  "repent",
  "faith",
  "prayer",
  "blessed",
  "today",
  "listen",
  "watch",
  "remember",
  "forget",
  "worst",
  "best",
  "biggest",
  "smallest",
  "first",
  "last",
  "love",
  "hate",
  "fear",
  "hope",
  "dream",
  "nightmare",
  "money",
  "rich",
  "poor",
  "free",
  "danger",
  "safe",
]);

const EXCLAMATION_BOOST = 1.5;
const SHORT_SENTENCE_BOOST = 1.3;
const HOOK_WORD_BOOST = 1.2;
const QUIET_AFTER_BOOST = 1.4;
const POSITION_BEGINNING_BOOST = 1.1;

export function detectHighlights(
  captions: Caption[],
  opts?: { clipCount?: number; minDuration?: number; maxDuration?: number },
): HighlightSegment[] {
  const clipCount = opts?.clipCount ?? 5;
  const minDur = (opts?.minDuration ?? 15) * 1000;
  const maxDur = (opts?.maxDuration ?? 60) * 1000;
  const totalDur =
    captions.length > 0 ? captions[captions.length - 1].endMs : 0;

  // Group captions into sentences (split on punctuation gaps > 500ms)
  const sentences: {
    startMs: number;
    endMs: number;
    text: string;
    words: Caption[];
  }[] = [];
  let current = { startMs: 0, endMs: 0, text: "", words: [] as Caption[] };

  for (const cap of captions) {
    if (current.words.length > 0 && cap.startMs - current.endMs > 500) {
      if (current.text.trim()) sentences.push({ ...current });
      current = {
        startMs: cap.startMs,
        endMs: cap.endMs,
        text: cap.text,
        words: [cap],
      };
    } else {
      if (current.words.length === 0) current.startMs = cap.startMs;
      current.endMs = cap.endMs;
      current.text += (current.words.length > 0 ? " " : "") + cap.text;
      current.words.push(cap);
    }
  }
  if (current.text.trim()) sentences.push({ ...current });

  if (sentences.length === 0) return [];

  // Score each sentence
  const scored = sentences.map((s, i) => {
    let score = 1.0;
    const lower = s.text.toLowerCase();

    // Hook words
    const hookCount = [...HOOK_WORDS].filter((w) => lower.includes(w)).length;
    score *= 1 + hookCount * (HOOK_WORD_BOOST - 1);

    // Exclamation marks
    if (s.text.includes("!")) score *= EXCLAMATION_BOOST;

    // Short punchy sentences
    const wordCount = s.text.split(/\s+/).length;
    if (wordCount <= 8) score *= SHORT_SENTENCE_BOOST;

    // Quiet gap after (people pause after important statements)
    const nextIdx = i + 1;
    if (nextIdx < sentences.length) {
      const gap = sentences[nextIdx].startMs - s.endMs;
      if (gap > 800) score *= QUIET_AFTER_BOOST;
    }

    // Position: beginning and end of video score higher
    const posRatio = s.startMs / totalDur;
    if (posRatio < 0.15) score *= POSITION_BEGINNING_BOOST;
    if (posRatio > 0.85) score *= POSITION_BEGINNING_BOOST;

    return { ...s, score, wordCount };
  });

  // Sort by score descending, pick top N, ensure min duration
  scored.sort((a, b) => b.score - a.score);

  const selected: HighlightSegment[] = [];
  for (const s of scored) {
    if (selected.length >= clipCount) break;

    // Extend to min duration by grabbing surrounding sentences
    let startMs = s.startMs;
    let endMs = s.endMs;
    let text = s.text;

    while (endMs - startMs < minDur) {
      // Try extending forward
      const nextSentence = sentences.find(
        (sent) => sent.startMs >= endMs - 100 && sent.startMs <= endMs + 500,
      );
      if (nextSentence && endMs - startMs < maxDur) {
        endMs = nextSentence.endMs;
        text += " " + nextSentence.text;
      } else break;
    }

    // Cap at max duration
    if (endMs - startMs > maxDur) endMs = startMs + maxDur;

    // Skip if too short
    if (endMs - startMs < minDur * 0.5) continue;

    selected.push({ startMs, endMs, text: text.trim(), score: s.score });
  }

  return selected;
}

export async function autoClip(opts: AutoClipOpts): Promise<AutoClipResult> {
  const { randomUUID } = await import("crypto");
  const { existsSync, mkdirSync } = await import("fs");
  const { join, dirname } = await import("path");

  const tmpDir = join(
    process.cwd(),
    "data",
    "renders",
    `.autoclip-${randomUUID()}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  // Step 1: Download video
  const sourcePath = join(tmpDir, "source.mp4");
  const dlProc = Bun.spawn(
    [
      "yt-dlp",
      "-f",
      "best[ext=mp4]/best",
      "--no-playlist",
      "-o",
      sourcePath,
      opts.url,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const dlErr = await new Response(dlProc.stderr).text();
  if ((await dlProc.exited) !== 0) {
    throw new Error(`Download failed: ${dlErr.slice(-500)}`);
  }

  // Step 2: Extract audio for transcription
  const audioPath = join(tmpDir, "audio.mp3");
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  const audioProc = Bun.spawn(
    [
      ffmpegPath,
      "-y",
      "-i",
      sourcePath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "4",
      audioPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if ((await audioProc.exited) !== 0) {
    throw new Error("Failed to extract audio");
  }

  // Step 3: Transcribe with whisper
  const captions = await speechToText({
    inputPath: audioPath,
    language: opts.language,
  });

  // Step 4: Detect highlights
  const highlights = detectHighlights(captions, {
    clipCount: opts.clipCount,
    minDuration: opts.minDuration,
    maxDuration: opts.maxDuration,
  });

  if (highlights.length === 0) {
    throw new Error(
      "No highlights detected — video may be too short or lack speech",
    );
  }

  // Step 5: Extract clips
  const clips: AutoClipResult["clips"] = [];
  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];
    const clipPath = join(tmpDir, `clip-${i}.mp4`);
    const startSec = h.startMs / 1000;
    const durSec = (h.endMs - h.startMs) / 1000;

    const clipProc = Bun.spawn([
      ffmpegPath, "-y", "-ss", String(startSec), "-i",
      sourcePath, "-t", String(durSec), "-c", "copy", clipPath,
    ], { stdout: "pipe", stderr: "pipe" });

    if ((await clipProc.exited) === 0 && existsSync(clipPath)) {
      clips.push({
        path: clipPath,
        startMs: h.startMs,
        endMs: h.endMs,
        text: h.text,
        score: h.score,
        suggestedTitle: "",
      });
    }
  }

  return { sourcePath, clips, allCaptions: captions };
}

export interface FaceKeyframe {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceData {
  width: number;
  height: number;
  duration: number;
  keyframes: FaceKeyframe[];
}

export interface DetectFacesOpts {
  inputPath: string;
  outputPath: string;
  sampleFps?: number;
}

export async function detectFaces(opts: DetectFacesOpts): Promise<FaceData> {
  if (!existsSync(opts.inputPath)) {
    throw new Error(`Video file not found: ${opts.inputPath}`);
  }
  ensureDir(dirname(opts.outputPath));

  const scriptPath = join(__dirname, "detect_faces.py");
  const proc = Bun.spawn(
    [
      "python3",
      scriptPath,
      opts.inputPath,
      opts.outputPath,
      String(opts.sampleFps ?? 2),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`face detection failed: ${stderr.slice(-500)}`);
  }

  if (!existsSync(opts.outputPath)) {
    throw new Error("face detection did not produce output");
  }

  const raw = readFileSync(opts.outputPath, "utf-8");
  return JSON.parse(raw) as FaceData;
}

// ─── Silence Detection & Removal ───

export interface SilenceSegment {
  startMs: number;
  endMs: number;
}

export interface DetectSilenceOpts {
  inputPath: string;
  threshold?: number; // dB, default -30
  minDuration?: number; // seconds, default 0.5
}

export async function detectSilence(
  opts: DetectSilenceOpts,
): Promise<SilenceSegment[]> {
  if (!existsSync(opts.inputPath)) {
    throw new Error(`File not found: ${opts.inputPath}`);
  }

  const threshold = opts.threshold ?? -30;
  const minDur = opts.minDuration ?? 0.5;

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      opts.inputPath,
      "-af",
      `silencedetect=noise=${threshold}dB:d=${minDur}`,
      "-f",
      "null",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  const segments: SilenceSegment[] = [];
  const lines = stderr.split("\n");
  let startMs = 0;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);

    if (startMatch) {
      startMs = Math.round(parseFloat(startMatch[1]) * 1000);
    }
    if (endMatch) {
      const endMs = Math.round(parseFloat(endMatch[1]) * 1000);
      segments.push({ startMs, endMs });
    }
  }

  return segments;
}

export interface RemoveSilenceOpts {
  inputPath: string;
  outputPath: string;
  threshold?: number; // dB, default -30
  minDuration?: number; // seconds, default 0.5
  fillMode?: "crossfade" | "stock"; // how to bridge gaps
  stockClips?: string[]; // stock footage paths for fillMode=stock
}

export async function removeSilence(
  opts: RemoveSilenceOpts,
): Promise<{ outputPath: string; removedMs: number; segments: number }> {
  if (!existsSync(opts.inputPath)) {
    throw new Error(`File not found: ${opts.inputPath}`);
  }
  ensureDir(dirname(opts.outputPath));

  const silence = await detectSilence({
    inputPath: opts.inputPath,
    threshold: opts.threshold,
    minDuration: opts.minDuration,
  });

  if (silence.length === 0) {
    // No silence — just copy
    const proc = Bun.spawn(
      ["ffmpeg", "-y", "-i", opts.inputPath, "-c", "copy", opts.outputPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    return { outputPath: opts.outputPath, removedMs: 0, segments: 0 };
  }

  // Get total duration
  const durProc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      opts.inputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const durStr = await new Response(durProc.stdout).text();
  await durProc.exited;
  const totalMs = Math.round(parseFloat(durStr.trim()) * 1000);

  // Build speaking segments (inverse of silence)
  const speaking: SilenceSegment[] = [];
  let prevEnd = 0;
  for (const seg of silence) {
    if (seg.startMs > prevEnd) {
      speaking.push({ startMs: prevEnd, endMs: seg.startMs });
    }
    prevEnd = seg.endMs;
  }
  if (prevEnd < totalMs) {
    speaking.push({ startMs: prevEnd, endMs: totalMs });
  }

  if (speaking.length === 0) {
    throw new Error("Video is entirely silent");
  }

  const removedMs =
    totalMs - speaking.reduce((s, seg) => s + (seg.endMs - seg.startMs), 0);

  // Use ffmpeg complex filter to cut and concatenate speaking segments
  // with crossfade between them
  const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
  const filterInputs: string[] = [];
  const filterParts: string[] = [];

  for (let i = 0; i < speaking.length; i++) {
    const seg = speaking[i];
    const startSec = seg.startMs / 1000;
    const durSec = (seg.endMs - seg.startMs) / 1000;
    filterInputs.push(`-ss ${startSec} -t ${durSec} -i ${opts.inputPath}`);
    filterParts.push(`[${i}:v][${i}:a]`);
  }

  // Concat all segments
  const concatLabel = speaking.length > 1 ? `[vconcat]` : `[vout]`;
  if (speaking.length > 1) {
    filterParts.push(`concat=n=${speaking.length}:v=1:a=1${concatLabel}`);
  }

  const filterComplex = filterParts.join(" ");
  const outputLabel = speaking.length > 1 ? "[vconcat]" : "[vout]";

  const args = [
    "-y",
    ...filterInputs.join(" ").split(" "),
    "-filter_complex",
    filterComplex,
    "-map",
    outputLabel,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    opts.outputPath,
  ];

  const proc = Bun.spawn([ffmpegBin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Silence removal failed: ${stderr.slice(-500)}`);
  }

  return {
    outputPath: opts.outputPath,
    removedMs,
    segments: speaking.length,
  };
}

// ─── Multimodal AI Clipping ───
export {
  autoClipPro,
  detectChapters,
  generateClipTitles,
  analyzeSentiment,
  extractKeywords,
  detectTopic,
} from "./multimodal-clip";
export type {
  VideoChapter,
  ChapterAnalysis,
  MultimodalHighlight,
  MultimodalClipResult,
} from "./multimodal-clip";
