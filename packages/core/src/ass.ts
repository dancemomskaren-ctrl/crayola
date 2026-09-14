import { writeFileSync } from "fs";
import { SERMON_CAPTION_STYLES } from "./templates";

export interface ASSEvent {
  start: string; // HH:MM:SS.cc
  end: string;
  style: string;
  text: string;
}

export interface ASSStyle {
  name: string;
  fontname: string;
  fontsize: number;
  primaryColor: string; // &HBBGGRR&
  secondaryColor: string;
  outlineColor: string;
  shadowColor: string;
  bold: number;
  italic: number;
  outline: number;
  shadow: number;
  alignment: number; // 1-9 numpad
  marginL: number;
  marginR: number;
  marginV: number;
  encoding: number;
  borderStyle?: number;
}

export interface CaptionAnim {
  text: string;
  startMs: number;
  endMs: number;
  style?: string;
  reference?: string;
}

// Color format: #RRGGBB → &HBBGGRR&
function rgbToASS(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}&`;
}

function msToASS(ms: number): string {
  const totalSec = ms / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.min(totalSec % 60, 59.99);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

const DEFAULT_STYLES: Record<string, ASSStyle> = {
  ...SERMON_CAPTION_STYLES,
  bold_pop: {
    name: "BoldPop",
    fontname: "Arial",
    fontsize: 52,
    primaryColor: rgbToASS("#FFFFFF"),
    secondaryColor: rgbToASS("#000000"),
    outlineColor: rgbToASS("#000000"),
    shadowColor: rgbToASS("#000000"),
    bold: 1,
    italic: 0,
    outline: 3,
    shadow: 0,
    alignment: 2, // bottom center
    marginL: 40,
    marginR: 40,
    marginV: 60,
    encoding: 1,
  },
  word_by_word: {
    name: "WordByWord",
    fontname: "Arial",
    fontsize: 56,
    primaryColor: rgbToASS("#FFFF00"),
    secondaryColor: rgbToASS("#000000"),
    outlineColor: rgbToASS("#000000"),
    shadowColor: rgbToASS("#000000"),
    bold: 1,
    italic: 0,
    outline: 3,
    shadow: 0,
    alignment: 5, // center
    marginL: 40,
    marginR: 40,
    marginV: 0,
    encoding: 1,
  },
  colorful: {
    name: "Colorful",
    fontname: "Arial",
    fontsize: 48,
    primaryColor: rgbToASS("#00FFFF"),
    secondaryColor: rgbToASS("#FF00FF"),
    outlineColor: rgbToASS("#000000"),
    shadowColor: rgbToASS("#000000"),
    bold: 1,
    italic: 0,
    outline: 3,
    shadow: 0,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    encoding: 1,
  },
  minimal: {
    name: "Minimal",
    fontname: "Arial",
    fontsize: 36,
    primaryColor: rgbToASS("#FFFFFF"),
    secondaryColor: rgbToASS("#000000"),
    outlineColor: rgbToASS("#FFFFFF"),
    shadowColor: rgbToASS("#000000"),
    bold: 0,
    italic: 0,
    outline: 0,
    shadow: 2,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    encoding: 1,
  },
  typewriter: {
    name: "Typewriter",
    fontname: "Courier New",
    fontsize: 48,
    primaryColor: rgbToASS("#FFFFFF"),
    secondaryColor: rgbToASS("#000000"),
    outlineColor: rgbToASS("#333333"),
    shadowColor: rgbToASS("#000000"),
    bold: 0,
    italic: 0,
    outline: 2,
    shadow: 0,
    alignment: 2,
    marginL: 60,
    marginR: 60,
    marginV: 60,
    encoding: 1,
  },
  bounce: {
    name: "Bounce",
    fontname: "Arial",
    fontsize: 52,
    primaryColor: rgbToASS("#FFD700"),
    secondaryColor: rgbToASS("#FF4500"),
    outlineColor: rgbToASS("#000000"),
    shadowColor: rgbToASS("#000000"),
    bold: 1,
    italic: 0,
    outline: 3,
    shadow: 2,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    encoding: 1,
  },
  glow: {
    name: "Glow",
    fontname: "Arial",
    fontsize: 52,
    primaryColor: rgbToASS("#FFFFFF"),
    secondaryColor: rgbToASS("#00BFFF"),
    outlineColor: rgbToASS("#00BFFF"),
    shadowColor: rgbToASS("#00BFFF"),
    bold: 1,
    italic: 0,
    outline: 4,
    shadow: 8,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    encoding: 1,
  },
  neon: {
    name: "Neon",
    fontname: "Arial",
    fontsize: 52,
    primaryColor: rgbToASS("#FF00FF"),
    secondaryColor: rgbToASS("#00FF00"),
    outlineColor: rgbToASS("#FF00FF"),
    shadowColor: rgbToASS("#FF00FF"),
    bold: 1,
    italic: 0,
    outline: 2,
    shadow: 6,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    encoding: 1,
  },
  shake: {
    name: "Shake",
    fontname: "Arial",
    fontsize: 52,
    primaryColor: rgbToASS("#FF4444"),
    secondaryColor: rgbToASS("#000000"),
    outlineColor: rgbToASS("#000000"),
    shadowColor: rgbToASS("#000000"),
    bold: 1,
    italic: 0,
    outline: 3,
    shadow: 0,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    encoding: 1,
  },
  // Christian/Ministry caption styles
  holy_glow: {
    name: "HolyGlow",
    fontname: "Arial",
    fontsize: 54,
    primaryColor: rgbToASS("#FFFFFF"),
    secondaryColor: rgbToASS("#FFD700"),
    outlineColor: rgbToASS("#FFD700"),
    shadowColor: rgbToASS("#FFD700"),
    bold: 1,
    italic: 0,
    outline: 3,
    shadow: 8,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 70,
    encoding: 1,
  },
  cross_bold: {
    name: "CrossBold",
    fontname: "Arial Black",
    fontsize: 58,
    primaryColor: rgbToASS("#000000"),
    secondaryColor: rgbToASS("#FFFFFF"),
    outlineColor: rgbToASS("#FFFFFF"),
    shadowColor: rgbToASS("#808080"),
    bold: 1,
    italic: 0,
    outline: 5,
    shadow: 3,
    alignment: 2,
    marginL: 35,
    marginR: 35,
    marginV: 65,
    encoding: 1,
  },
  worship_purple: {
    name: "WorshipPurple",
    fontname: "Georgia",
    fontsize: 52,
    primaryColor: rgbToASS("#FFFFFF"),
    secondaryColor: rgbToASS("#800080"),
    outlineColor: rgbToASS("#800080"),
    shadowColor: rgbToASS("#4B0082"),
    bold: 1,
    italic: 1,
    outline: 4,
    shadow: 4,
    alignment: 2,
    marginL: 45,
    marginR: 45,
    marginV: 75,
    encoding: 1,
  },
  scripture_serif: {
    name: "ScriptureSerif",
    fontname: "Times New Roman",
    fontsize: 48,
    primaryColor: rgbToASS("#F5F5DC"),
    secondaryColor: rgbToASS("#8B4513"),
    outlineColor: rgbToASS("#8B4513"),
    shadowColor: rgbToASS("#000000"),
    bold: 1,
    italic: 1,
    outline: 2,
    shadow: 2,
    alignment: 5,
    marginL: 60,
    marginR: 60,
    marginV: 0,
    encoding: 1,
  },
  fire_revival: {
    name: "FireRevival",
    fontname: "Impact",
    fontsize: 60,
    primaryColor: rgbToASS("#FFFFFF"),
    secondaryColor: rgbToASS("#FF0000"),
    outlineColor: rgbToASS("#FF4700"),
    shadowColor: rgbToASS("#000000"),
    bold: 1,
    italic: 0,
    outline: 4,
    shadow: 5,
    alignment: 2,
    marginL: 30,
    marginR: 30,
    marginV: 60,
    encoding: 1,
  },
  zoom: {
    name: "Zoom",
    fontname: "Arial",
    fontsize: 48,
    primaryColor: rgbToASS("#FFFFFF"),
    secondaryColor: rgbToASS("#FFD700"),
    outlineColor: rgbToASS("#000000"),
    shadowColor: rgbToASS("#000000"),
    bold: 1,
    italic: 0,
    outline: 3,
    shadow: 0,
    alignment: 2,
    marginL: 40,
    marginR: 40,
    marginV: 60,
    encoding: 1,
  },
};

// ─── Animation generators ───

function animTypewriter(
  text: string,
  startMs: number,
  endMs: number,
): ASSEvent[] {
  const events: ASSEvent[] = [];
  const chars = text.split("");
  const charDur = Math.max((endMs - startMs) / chars.length, 30);

  // Build cumulative reveal using \k tags (karaoke - centiseconds per char)
  let kTags = "";
  for (let i = 0; i < chars.length; i++) {
    const kDuration = Math.round(charDur / 10); // ASS uses centiseconds
    kTags += `\\k${kDuration}${chars[i]}`;
  }

  events.push({
    start: msToASS(startMs),
    end: msToASS(endMs),
    style: "Typewriter",
    text: `{\\fad(200,200)${kTags}}`,
  });

  return events;
}

function animBounce(
  text: string,
  startMs: number,
  endMs: number,
  w: number,
  h: number,
): ASSEvent[] {
  const events: ASSEvent[] = [];
  const dur = (endMs - startMs) / 1000;
  const cx = w / 2;
  const settleY = h - 520;

  const tags = [
    `{\\fad(100,200)`,
    `\\move(${cx},${h + 100},${cx},${settleY},0,${Math.round(dur * 25)})`,
    `\\t(0,${Math.round(dur * 12)},\\fscx110\\fscy110)`,
    `\\t(${Math.round(dur * 12)},${Math.round(dur * 25)},\\fscx100\\fscy100)`,
    `}`,
  ].join("");

  events.push({
    start: msToASS(startMs),
    end: msToASS(endMs),
    style: "Bounce",
    text: tags + text,
  });

  return events;
}

function animShake(
  text: string,
  startMs: number,
  endMs: number,
  w: number,
  h: number,
): ASSEvent[] {
  const events: ASSEvent[] = [];
  const cx = w / 2;
  const y = h - 520;

  const shakeFrames = 6;
  const frameDur = (endMs - startMs) / shakeFrames;

  for (let i = 0; i < shakeFrames; i++) {
    const offset = i % 2 === 0 ? 8 : -8;
    const fStart = startMs + Math.round(i * frameDur);
    const fEnd = startMs + Math.round((i + 1) * frameDur);
    events.push({
      start: msToASS(fStart),
      end: msToASS(fEnd),
      style: "Shake",
      text: `{\\pos(${cx + offset},${y})}${text}`,
    });
  }

  return events;
}

function animZoom(text: string, startMs: number, endMs: number): ASSEvent[] {
  const events: ASSEvent[] = [];
  const dur = (endMs - startMs) / 1000;

  // Zoom in from small to full size
  const tags = [
    `{\\fad(150,200)`,
    `\\fscx30\\fscy30`, // start small
    `\\t(0,${Math.round(dur * 40)},\\fscx100\\fscy100)`, // zoom to full
    `}`,
  ].join("");

  events.push({
    start: msToASS(startMs),
    end: msToASS(endMs),
    style: "Zoom",
    text: tags + text,
  });

  return events;
}

function animFadeIn(text: string, startMs: number, endMs: number): ASSEvent[] {
  return [
    {
      start: msToASS(startMs),
      end: msToASS(endMs),
      style: "BoldPop",
      text: `{\\fad(400,300)}${text}`,
    },
  ];
}

function animColorful(
  text: string,
  startMs: number,
  endMs: number,
): ASSEvent[] {
  const events: ASSEvent[] = [];
  const words = text.split(" ");
  const wordDur = Math.max((endMs - startMs) / words.length, 100);

  // Each word appears with fade, alternating colors
  const colors = ["&H00FFFF&", "&HFF00FF&", "&H00FF00&", "&HFFFF00&"];
  let accMs = startMs;

  for (let i = 0; i < words.length; i++) {
    const color = colors[i % colors.length];
    events.push({
      start: msToASS(accMs),
      end: msToASS(endMs),
      style: "Colorful",
      text: `{\\fad(100,100)\\1c${color}}${words.slice(0, i + 1).join(" ")}`,
    });
    accMs += wordDur;
  }

  return events;
}

function animWordByWord(
  text: string,
  startMs: number,
  endMs: number,
): ASSEvent[] {
  const events: ASSEvent[] = [];
  const words = text.split(" ");
  const wordDur = Math.max((endMs - startMs) / words.length, 100);

  // Each word appears one at a time, building up
  let accMs = startMs;
  for (let i = 0; i < words.length; i++) {
    events.push({
      start: msToASS(accMs),
      end: msToASS(endMs),
      style: "WordByWord",
      text: `{\\fad(80,80)}${words.slice(0, i + 1).join(" ")}`,
    });
    accMs += wordDur;
  }

  return events;
}

// ─── ASS file generator ───

function generateASSHeader(
  styles: ASSStyle[],
  width = 1080,
  height = 1920,
): string {
  const styleLines = styles
    .map(
      (s) =>
        `Style: ${s.name},${s.fontname},${s.fontsize},${s.primaryColor},${s.secondaryColor},${s.outlineColor},${s.shadowColor},${s.bold},${s.italic},0,0,100,100,0,0,${s.borderStyle ?? 1},${s.outline},${s.shadow},${s.alignment},${s.marginL},${s.marginR},${s.marginV},${s.encoding}`,
    )
    .join("\n");

  return `[Script Info]
Title: Crayo Local Captions
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, ShadowColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

function generateASSEvents(events: ASSEvent[]): string {
  return events
    .map((e) => `Dialogue: 0,${e.start},${e.end},${e.style},,0,0,0,,${e.text}`)
    .join("\n");
}

export function generateASS(
  captions: CaptionAnim[],
  styleName: string,
  width = 1080,
  height = 1920,
): string {
  const styleDef = DEFAULT_STYLES[styleName] ?? DEFAULT_STYLES.bold_pop;
  const allStyles = new Set<string>();
  allStyles.add(styleDef.name);

  const events: ASSEvent[] = [];

  for (const cap of captions) {
    const text = cap.text.trim();
    if (!text) continue;

    switch (styleName) {
      case "scripture":
      case "testimony":
      case "altar-call": {
        const safeText = text.replace(/[{}\\]/g, "").replace(/\r?\n/g, " ");
        const reference = cap.reference?.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
        let tags = "{\\fad(150,150)}";
        if (styleName === "altar-call") {
          tags = "{\\fscx100\\fscy100";
          for (let t = 0; t < cap.endMs - cap.startMs; t += 800) {
            tags += `\\t(${t},${t + 400},\\fscx106\\fscy106)\\t(${t + 400},${t + 800},\\fscx100\\fscy100)`;
          }
          tags += "}";
        }
        events.push({ start: msToASS(cap.startMs), end: msToASS(cap.endMs), style: styleDef.name,
          text: tags + safeText + (styleName === "scripture" && reference ? `\\N{\\fs34}${reference}` : "") });
        break;
      }
      case "typewriter":
        events.push(...animTypewriter(text, cap.startMs, cap.endMs));
        allStyles.add("Typewriter");
        break;
      case "bounce":
        events.push(...animBounce(text, cap.startMs, cap.endMs, width, height));
        allStyles.add("Bounce");
        break;
      case "shake":
        events.push(...animShake(text, cap.startMs, cap.endMs, width, height));
        allStyles.add("Shake");
        break;
      case "zoom":
        events.push(...animZoom(text, cap.startMs, cap.endMs));
        allStyles.add("Zoom");
        break;
      case "colorful":
        events.push(...animColorful(text, cap.startMs, cap.endMs));
        allStyles.add("Colorful");
        break;
      case "word_by_word":
        events.push(...animWordByWord(text, cap.startMs, cap.endMs));
        allStyles.add("WordByWord");
        break;
      default:
        events.push(...animFadeIn(text, cap.startMs, cap.endMs));
        break;
    }
  }

  const usedStyles = [...allStyles]
    .map(
      (name) =>
        Object.values(DEFAULT_STYLES).find((s) => s.name === name) ??
        DEFAULT_STYLES.bold_pop,
    )
    .filter((s) => allStyles.has(s.name));

  const header = generateASSHeader(usedStyles, width, height);
  const body = generateASSEvents(events);

  return `${header}\n\n${body}`;
}

export function writeASS(
  captions: CaptionAnim[],
  styleName: string,
  outputPath: string,
  width?: number,
  height?: number,
): void {
  const content = generateASS(captions, styleName, width, height);
  writeFileSync(outputPath, content, "utf-8");
}

export function getCaptionStyles(): string[] {
  return Object.keys(DEFAULT_STYLES);
}
