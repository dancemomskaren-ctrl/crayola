// Word-by-word animated captions (MrBeast / Hormozi / viral TikTok style)
// Uses ffmpeg drawtext with per-word enable expressions and scale animations

export interface WordCaption {
  text: string;
  startMs: number;
  endMs: number;
}

export type WordCaptionStyle =
  | "mrbeast" // Bold yellow pop, centered, all-caps
  | "hormozi" // White with black outline, bounce effect, all-caps
  | "subway" // Neon glow, lowercase, smooth fade
  | "minimal"; // Clean white fade, sentence case

interface StyleConfig {
  fontFamily: string;
  fontSize: number; // base size (will scale up when active)
  fontColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadowColor?: string;
  shadowX?: number;
  shadowY?: number;
  scaleActive: number; // scale multiplier when word is active
  yPosition: string; // ffmpeg y expression (e.g. "h*0.75" for lower third)
  uppercase: boolean;
  animation: "pop" | "bounce" | "glow" | "fade";
}

const STYLES: Record<WordCaptionStyle, StyleConfig> = {
  mrbeast: {
    fontFamily: "Arial Black",
    fontSize: 80,
    fontColor: "yellow",
    outlineColor: "black",
    outlineWidth: 6,
    shadowColor: "0x00000080",
    shadowX: 4,
    shadowY: 4,
    scaleActive: 1.15,
    yPosition: "h*0.72",
    uppercase: true,
    animation: "pop",
  },
  hormozi: {
    fontFamily: "Impact",
    fontSize: 75,
    fontColor: "white",
    outlineColor: "black",
    outlineWidth: 5,
    scaleActive: 1.2,
    yPosition: "h*0.7",
    uppercase: true,
    animation: "bounce",
  },
  subway: {
    fontFamily: "Arial",
    fontSize: 65,
    fontColor: "#00FFFF", // cyan neon
    outlineColor: "#FF00FF", // magenta outline
    outlineWidth: 3,
    shadowColor: "0x00FFFF80",
    shadowX: 0,
    shadowY: 0,
    scaleActive: 1.1,
    yPosition: "h*0.75",
    uppercase: false,
    animation: "glow",
  },
  minimal: {
    fontFamily: "Helvetica",
    fontSize: 70,
    fontColor: "white",
    outlineColor: "0x00000080",
    outlineWidth: 2,
    scaleActive: 1.05,
    yPosition: "h*0.8",
    uppercase: false,
    animation: "fade",
  },
};

/**
 * Build ffmpeg drawtext filter chain for word-by-word animated captions.
 * Each word gets its own drawtext filter with enable expression for timing.
 * 
 * Returns a filter_complex string ready for ffmpeg -filter_complex
 */
export function buildWordCaptionFilter(
  words: WordCaption[],
  style: WordCaptionStyle,
  videoWidth: number,
  videoHeight: number,
): string {
  const cfg = STYLES[style];
  const filters: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const startSec = word.startMs / 1000;
    const endSec = word.endMs / 1000;
    const displayText = cfg.uppercase
      ? word.text.toUpperCase()
      : word.text;

    // Escape single quotes for ffmpeg
    const escaped = displayText.replace(/'/g, "'\\''");

    // Build the drawtext expression
    let dt = `drawtext=text='${escaped}'`;
    dt += `:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`; // fallback font
    dt += `:fontsize=${cfg.fontSize}`;
    dt += `:fontcolor=${cfg.fontColor}`;
    dt += `:borderw=${cfg.outlineWidth}`;
    dt += `:bordercolor=${cfg.outlineColor}`;
    dt += `:x=(w-text_w)/2`; // centered horizontally
    dt += `:y=${cfg.yPosition}`;

    // Add shadow if configured
    if (cfg.shadowColor) {
      dt += `:shadowcolor=${cfg.shadowColor}`;
      dt += `:shadowx=${cfg.shadowX ?? 0}`;
      dt += `:shadowy=${cfg.shadowY ?? 0}`;
    }

    // Animation: scale up when active
    // Use enable expression to show word only during its time window
    // For "pop" effect, we scale from 1.0 -> scaleActive over first 100ms,
    // then back to 1.0 over last 100ms
    const duration = endSec - startSec;
    if (cfg.animation === "pop" && duration > 0.2) {
      // Simple approach: show at scaleActive size the whole time (no gradual scale yet)
      // TODO: implement gradual scale with zoompan filter or expression
      dt += `:fontsize=${Math.round(cfg.fontSize * cfg.scaleActive)}`;
    }

    // Enable this drawtext only during the word's time window
    dt += `:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'`;

    filters.push(dt);
  }

  // Chain all drawtext filters together
  return filters.join(",");
}

/**
 * Simpler approach for initial implementation: group words into lines
 * (3-5 words per line for readability) and animate each line.
 * This avoids overwhelming ffmpeg with 100+ drawtext filters for long clips.
 */
export function buildLineBasedWordCaptions(
  words: WordCaption[],
  style: WordCaptionStyle,
  videoWidth: number,
  videoHeight: number,
  wordsPerLine: number = 4,
): string {
  const cfg = STYLES[style];
  const filters: string[] = [];

  // Group words into lines
  const lines: { text: string; startMs: number; endMs: number; words: WordCaption[] }[] = [];
  for (let i = 0; i < words.length; i += wordsPerLine) {
    const lineWords = words.slice(i, i + wordsPerLine);
    if (lineWords.length === 0) continue;
    const text = lineWords.map(w => w.text).join(" ");
    const startMs = lineWords[0].startMs;
    const endMs = lineWords[lineWords.length - 1].endMs;
    lines.push({ text, startMs, endMs, words: lineWords });
  }

  // Render each line
  for (const line of lines) {
    const startSec = line.startMs / 1000;
    const endSec = line.endMs / 1000;
    const displayText = cfg.uppercase ? line.text.toUpperCase() : line.text;
    const escaped = displayText.replace(/'/g, "'\\''");

    let dt = `drawtext=text='${escaped}'`;
    dt += `:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`;
    dt += `:fontsize=${cfg.fontSize}`;
    dt += `:fontcolor=${cfg.fontColor}`;
    dt += `:borderw=${cfg.outlineWidth}`;
    dt += `:bordercolor=${cfg.outlineColor}`;
    dt += `:x=(w-text_w)/2`;
    dt += `:y=${cfg.yPosition}`;

    if (cfg.shadowColor) {
      dt += `:shadowcolor=${cfg.shadowColor}`;
      dt += `:shadowx=${cfg.shadowX ?? 0}`;
      dt += `:shadowy=${cfg.shadowY ?? 0}`;
    }

    dt += `:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'`;
    filters.push(dt);
  }

  return filters.join(",");
}
