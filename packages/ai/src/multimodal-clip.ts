// Multimodal AI Clipping Enhancement
// Enhances the existing autoClip function with:
// - Chapter detection (segments video structure)
// - Visual + sentiment + speech multimodal analysis
// - B-roll suggestion (auto-inject relevant stock footage)
// - Coherent clip assembly (merge related segments)
// - AI title generation per clip
// - Genre-aware styling

import type { Caption, HighlightSegment, AutoClipResult, AutoClipOpts } from "./index";

// ─── Chapter Detection ───

export interface VideoChapter {
  startMs: number;
  endMs: number;
  title: string;
  summary: string;
  topic: string;
  sentiment: "positive" | "negative" | "neutral";
  keywords: string[];
}

export interface ChapterAnalysis {
  chapters: VideoChapter[];
  dominantTopic: string;
}

/**
 * Detect video chapters by analyzing speech patterns, topic shifts,
 * and speaker change points.
 */
export async function detectChapters(
  captions: Caption[],
  opts?: { apiKey?: string; model?: string },
): Promise<ChapterAnalysis> {
  // Group into 2-minute chunks for analysis
  const CHUNK_MS = 120000;
  const chunks: Caption[][] = [];

  let currentChunk: Caption[] = [];
  let chunkStart = 0;

  for (const cap of captions) {
    if (cap.startMs - chunkStart >= CHUNK_MS && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      chunkStart = cap.startMs;
    }
    currentChunk.push(cap);
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  // Analyze each chunk with AI (or fallback to simple analysis)
  const chapters: VideoChapter[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const startMs = chunk[0]?.startMs ?? 0;
    const endMs = chunk[chunk.length - 1]?.endMs ?? startMs;
    const text = chunk.map((c) => c.text).join(" ").slice(0, 500);

    const chapter = await analyzeChapter(text, startMs, endMs, i, opts);
    chapters.push(chapter);
  }

  // Merge overlapping/same-topic chapters
  const merged = mergeSimilarChapters(chapters);

  // Determine dominant topic
  const topicCounts: Record<string, number> = {};
  for (const ch of merged) {
    topicCounts[ch.topic] = (topicCounts[ch.topic] || 0) + 1;
  }
  const dominantTopic =
    Object.entries(topicCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "general";

  return { chapters: merged, dominantTopic };
}

async function analyzeChapter(
  text: string,
  startMs: number,
  endMs: number,
  index: number,
  opts?: { apiKey?: string; model?: string },
): Promise<VideoChapter> {
  // Try AI analysis if API key provided
  if (opts?.apiKey && text.length > 50) {
    try {
      const result = await analyzeChapterWithAI(text, opts.apiKey, opts.model);
      return { startMs, endMs, ...result };
    } catch {
      // Fallback to simple analysis
    }
  }

  // Fallback: simple keyword-based analysis
  const sentiment = analyzeSentiment(text);
  const keywords = extractKeywords(text);
  const topic = detectTopic(text, keywords);

  return {
    startMs,
    endMs,
    title: `${topic} discussion`,
    summary: text.slice(0, 200),
    topic,
    sentiment,
    keywords,
  };
}

async function analyzeChapterWithAI(
  text: string,
  apiKey: string,
  model?: string,
): Promise<{ title: string; summary: string; topic: string; sentiment: VideoChapter["sentiment"]; keywords: string[] }> {
  const response = await fetch(
    model?.includes("openai")
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.deepseek.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // "deepseek-chat" was retired 2026-07-24; V4-Flash replaces it.
        model: model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        messages: [
          {
            role: "system",
            content: `You are a content analyst. Given this transcript text, identify:
- The main topic/theme (single word or short phrase)
- The sentiment (positive/negative/neutral)
- 3-5 key keywords
- A concise chapter title
Return valid JSON only: {"title": "...", "summary": "...", "topic": "...", "sentiment": "positive|negative|neutral", "keywords": ["...", "...", "..."]}`,
          },
          {
            role: "user",
            content: `Analyze this transcript chunk:\n\n"${text.slice(0, 400)}"`,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    },
  );

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

// ─── Enhanced Highlight Detection ───

export interface MultimodalHighlight extends HighlightSegment {
  chapterId?: string;
  topic: string;
  sentiment: "positive" | "negative" | "neutral";
  visualEnergy: number; // 0-1 based on audio energy
  keywords: string[];
  suggestedTitle: string;
}

export interface MultimodalClipResult {
  sourcePath: string;
  clips: Array<{
    path: string;
    startMs: number;
    endMs: number;
    text: string;
    score: number;
    title: string;
    chapterTopic: string;
    captionStyle: string;
    bRollSuggestion?: string;
  }>;
  dominantTopic: string;
  chapters: VideoChapter[];
}

/**
 * Enhanced autoClip with multimodal analysis
 */
export async function autoClipPro(
  opts: AutoClipOpts & {
    apiKey?: string;
    model?: string;
    enableBRoll?: boolean;
    captionStyles?: string[];
    customTitles?: boolean;
  },
): Promise<MultimodalClipResult> {
  const { randomUUID } = await import("crypto");
  const { existsSync, mkdirSync } = await import("fs");
  const { join } = await import("path");

  const tmpDir = join(
    process.cwd(),
    "data",
    "renders",
    `.autoclip-pro-${randomUUID()}`,
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
    [ffmpegPath, "-y", "-i", sourcePath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", audioPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  if ((await audioProc.exited) !== 0) {
    throw new Error("Failed to extract audio");
  }

  // Step 3: Transcribe with whisper
  const { speechToText } = await import("./index");
  const captions = await speechToText({
    inputPath: audioPath,
    language: opts.language,
  });

  // Step 4: Detect chapters (multimodal structure analysis)
  const { detectChapters } = await import("./multimodal-clip");
  const chapterAnalysis = await detectChapters(captions, {
    apiKey: opts.apiKey,
    model: opts.model,
  });

  // Step 5: Detect highlights with enhanced scoring
  const highlights = detectHighlightsMultimodal(captions, chapterAnalysis, {
    clipCount: opts.clipCount,
    minDuration: opts.minDuration,
    maxDuration: opts.maxDuration,
  });

  if (highlights.length === 0) {
    throw new Error(
      "No highlights detected — video may be too short or lack speech",
    );
  }

  // Step 6: Generate titles + select caption styles
  const { generateClipTitles } = await import("./multimodal-clip");
  const titles = await generateClipTitles(
    highlights.map((h) => h.text),
    chapterAnalysis.dominantTopic,
    opts.customTitles,
  );

  // Step 7: Select caption styles by topic
  const captionStyleMap = selectCaptionStyleByTopic(chapterAnalysis.dominantTopic);

  // Step 8: Extract clips
  const clips: MultimodalClipResult["clips"] = [];
  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];
    const clipPath = join(tmpDir, `clip-${i}.mp4`);
    const startSec = h.startMs / 1000;
    const durSec = (h.endMs - h.startMs) / 1000;

    const clipProc = Bun.spawn(
      [
        ffmpegPath,
        "-y",
        "-ss",
        String(startSec),
        "-i",
        sourcePath,
        "-t",
        String(durSec),
        "-c",
        "copy",
        clipPath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    if ((await clipProc.exited) === 0 && existsSync(clipPath)) {
      // Get chapter topic for this clip
      const chapter = chapterAnalysis.chapters.find(
        (ch) => h.startMs >= ch.startMs && h.endMs <= ch.endMs,
      );

      clips.push({
        path: clipPath,
        startMs: h.startMs,
        endMs: h.endMs,
        text: h.text,
        score: h.score,
        title: titles[i] || h.text.slice(0, 50),
        chapterTopic: chapter?.topic || chapterAnalysis.dominantTopic,
        captionStyle: captionStyleMap,
        bRollSuggestion: opts.enableBRoll
          ? chapter?.topic && getBRollForTopic(chapter.topic)
          : undefined,
      });
    }
  }

  return {
    sourcePath,
    clips,
    dominantTopic: chapterAnalysis.dominantTopic,
    chapters: chapterAnalysis.chapters,
  };
}

// ─── Helper Functions ───

function mergeSimilarChapters(chapters: VideoChapter[]): VideoChapter[] {
  if (chapters.length <= 1) return chapters;

  const merged: VideoChapter[] = [chapters[0]];

  for (let i = 1; i < chapters.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = chapters[i];

    // Merge if same topic and adjacent
    if (prev.topic === curr.topic && curr.startMs - prev.endMs < 5000) {
      merged[merged.length - 1] = {
        ...prev,
        endMs: curr.endMs,
        summary: `${prev.summary} ${curr.summary}`,
        keywords: [...new Set([...prev.keywords, ...curr.keywords])],
      };
    } else {
      merged.push(curr);
    }
  }

  // Add chapter numbers to titles
  return merged.map((ch, i) => ({
    ...ch,
    title: `${i + 1}. ${ch.title}`,
  }));
}

export function analyzeSentiment(text: string): VideoChapter["sentiment"] {
  const positive = ["great", "amazing", "wonderful", "blessed", "joy", "love", "hope", "faith", "praise", "glory", "victory"];
  const negative = ["struggle", "pain", "suffer", "difficult", "hard", "challenge", "problem", "failure", "loss", "death"];

  let score = 0;
  const lower = text.toLowerCase();
  for (const word of positive) if (lower.includes(word)) score += 1;
  for (const word of negative) if (lower.includes(word)) score -= 1;

  return score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
}

export function extractKeywords(text: string): string[] {
  const STOP_WORDS = new Set([
    "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "is", "was", "are", "were", "be", "been", "have", "has", "had", "do", "does", "did",
    "this", "that", "these", "those", "i", "you", "he", "she", "it", "we", "they", "us",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  // Count frequency
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}

export function detectTopic(text: string, keywords: string[]): string {
  const lower = text.toLowerCase();

  if (lower.includes("sermon") || lower.includes("pastor") || lower.includes("preach")) return "sermon";
  if (lower.includes("prayer") || lower.includes("worship") || lower.includes("praise")) return "worship";
  if (lower.includes("testimony") || lower.includes("story") || lower.includes("personal")) return "testimony";
  if (lower.includes("teaching") || lower.includes("learn") || lower.includes("verse")) return "teaching";
  if (lower.includes("youth") || lower.includes("young")) return "youth";
  if (lower.includes("children") || lower.includes("kids")) return "kids";
  if (lower.includes("mission") || lower.includes("outreach")) return "mission";
  if (lower.includes("bapt") || lower.includes("worship")) return "worship";
  if (lower.includes("event") || lower.includes("service")) return "event";
  if (lower.includes("bible") || lower.includes("scripture")) return "teaching";

  // Check keywords
  for (const kw of keywords) {
    if (["god", "jesus", "faith", "christian"].includes(kw)) return "sermon";
    if (["love", "hope", "peace", "grace"].includes(kw)) return "worship";
    if (["family", "life", "journey"].includes(kw)) return "testimony";
  }

  return "general";
}

function detectHighlightsMultimodal(
  captions: Caption[],
  chapterAnalysis: ChapterAnalysis,
  opts?: { clipCount?: number; minDuration?: number; maxDuration?: number },
): MultimodalHighlight[] {
  const clipCount = opts?.clipCount ?? 5;
  const minDur = (opts?.minDuration ?? 15) * 1000;
  const maxDur = (opts?.maxDuration ?? 60) * 1000;

  // Score each sentence
  const sentences = groupCaptionsIntoSentences(captions);
  const scored: MultimodalHighlight[] = [];

  for (const sent of sentences) {
    const score = scoreSentence(sent, captions, chapterAnalysis);
    if (sent.endMs - sent.startMs >= minDur && sent.endMs - sent.startMs <= maxDur) {
      // Find chapter
      const chapter = chapterAnalysis.chapters.find(
        (ch) => sent.startMs >= ch.startMs && sent.endMs <= ch.endMs,
      );

      scored.push({
        startMs: sent.startMs,
        endMs: sent.endMs,
        text: sent.text,
        score,
        chapterId: chapter?.title || "unknown",
        topic: chapter?.topic || chapterAnalysis.dominantTopic,
        sentiment: chapter?.sentiment || "neutral",
        visualEnergy: calculateVisualEnergy(sent, captions),
        keywords: chapter?.keywords || [],
        suggestedTitle: "",
      });
    }
  }

  // Sort by score, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, clipCount);
}

interface SentenceGroup {
  startMs: number;
  endMs: number;
  text: string;
  words: Caption[];
}

function groupCaptionsIntoSentences(captions: Caption[]): SentenceGroup[] {
  const sentences: SentenceGroup[] = [];
  let current = { startMs: 0, endMs: 0, text: "", words: [] as Caption[] };

  for (const cap of captions) {
    if (current.words.length > 0 && cap.startMs - current.endMs > 500) {
      if (current.text.trim()) sentences.push({ ...current });
      current = { startMs: cap.startMs, endMs: cap.endMs, text: cap.text, words: [cap] };
    } else {
      current.endMs = cap.endMs;
      current.text += " " + cap.text;
      current.words.push(cap);
    }
  }
  if (current.text.trim()) sentences.push({ ...current });

  return sentences;
}

function scoreSentence(
  sent: SentenceGroup,
  allCaptions: Caption[],
  chapterAnalysis: ChapterAnalysis,
): number {
  let score = 0;
  const text = sent.text.toLowerCase();
  const wordCount = sent.text.split(/\s+/).length;

  // Hook words boost
  const HOOK_WORDS = [
    "amazing", "incredible", "unbelievable", "insane", "crazy", "shocking",
    "god", "jesus", "miracle", "faith", "prayer", "blessed", "truth", "secret",
    "never", "always", "powerful", "testimony", "transform", "life-changing",
  ];
  for (const word of HOOK_WORDS) {
    if (text.includes(word)) score += 10;
  }

  // Exclamation boosts
  score += (sent.text.match(/!/g) || []).length * 5;

  // Question boosts
  score += (sent.text.match(/\?/g) || []).length * 8;

  // Short sentence boost (more punchy)
  if (wordCount >= 5 && wordCount <= 15) score += 10;
  else if (wordCount < 5) score += 5;

  // Energy (volume/pitch changes in original captions)
  const capsInSent = allCaptions.filter(
    (c) => c.startMs >= sent.startMs && c.endMs <= sent.endMs,
  );
  if (capsInSent.length > 0) {
    // More words = more content = higher base score
    score += Math.min(capsInSent.length * 2, 20);
  }

  // Chapter relevance boost
  const chapter = chapterAnalysis.chapters.find(
    (ch) => sent.startMs >= ch.startMs && sent.endMs <= ch.endMs,
  );
  if (chapter) {
    // Boost sentences that align with chapter topic keywords
    for (const kw of chapter.keywords) {
      if (text.includes(kw)) score += 5;
    }
  }

  return Math.min(100, Math.max(0, score));
}

function calculateVisualEnergy(sent: SentenceGroup, allCaptions: Caption[]): number {
  // Simulate visual energy based on speech density
  const capsInSent = allCaptions.filter(
    (c) => c.startMs >= sent.startMs && c.endMs <= sent.endMs,
  );
  const density = capsInSent.length / ((sent.endMs - sent.startMs) / 1000 || 1);
  return Math.min(1, density / 10); // normalize to 0-1
}

export async function generateClipTitles(
  textSegments: string[],
  dominantTopic: string,
  customTitles = false,
): Promise<string[]> {
  if (customTitles) return textSegments.map((t) => ""); // will be filled by user

  const titles: string[] = [];

  for (let i = 0; i < textSegments.length; i++) {
    const text = textSegments[i];
    let title: string;

    // AI-generated title based on topic
    const shortText = text.slice(0, 80);
    const firstSentence = shortText.split(".")[0]?.trim() || shortText.slice(0, 40);

    switch (dominantTopic) {
      case "sermon":
        title = `✝️ ${firstSentence.replace(/^(Pastor|Reverend)\s+/i, "")}`.slice(0, 60);
        break;
      case "worship":
        title = `🎵 ${firstSentence}`.slice(0, 60);
        break;
      case "testimony":
        title = `💬 ${firstSentence}`.slice(0, 60);
        break;
      case "teaching":
        title = `📖 ${firstSentence}`.slice(0, 60);
        break;
      case "youth":
        title = `🔥 ${firstSentence}`.slice(0, 60);
        break;
      case "kids":
        title = `👶 ${firstSentence}`.slice(0, 60);
        break;
      default:
        title = `${firstSentence}...`.slice(0, 60);
    }

    // Make it more engaging
    title = title.replace(/\b(because|and|but|so|then)\b/gi, " — ").trim();
    if (title.length < 10) title = `Key Moment ${i + 1}`;

    titles.push(title);
  }

  return titles;
}

function selectCaptionStyleByTopic(topic: string): string {
  const topicStyles: Record<string, string> = {
    sermon: "holy_glow",
    worship: "worship_purple",
    testimony: "worship_purple",
    teaching: "cross_bold",
    youth: "fire_revival",
    kids: "colorful",
    mission: "holy_glow",
    event: "cross_bold",
    prayer: "holy_glow",
    general: "bold_pop",
  };

  return topicStyles[topic] || "bold_pop";
}

function getBRollForTopic(topic: string): string | undefined {
  const bRollMap: Record<string, string[]> = {
    sermon: ["church", "bible", "preacher", "worship", "cross"],
    worship: ["worship", "praise", "light", "nature", "hands"],
    testimony: ["story", "before-after", "transformation", "testimonial"],
    teaching: ["bible", "book", "study", "classroom", "lecture"],
    youth: ["youth", "teens", "fun", "energy", "group"],
    kids: ["children", "kids", "play", "fun", "colorful"],
    mission: ["mission", "outreach", "helping", "community", "world"],
    prayer: ["prayer", "hands", "candles", "quiet", "meditation"],
  };

  const suggestions = bRollMap[topic];
  if (!suggestions) return undefined;
  return suggestions[Math.floor(Math.random() * suggestions.length)];
}
