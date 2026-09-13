// Viral caption styles adapted from nicolaigaina/ai-video-captions (MIT licensed)
// Generates ASS subtitles with word-level animations for TikTok/Shorts/Reels

export interface ViralCaptionStyle {
  id: string;
  name: string;
  description: string;
  fontName: string;
  fontNameFallback: string;
  fontSize: number;
  primaryColor: string; // hex format #RRGGBB
  highlightColor: string;
  outlineColor: string;
  shadowColor: string;
  shadowAlpha: number; // 0-255
  outlineSize: number;
  shadowDepth: number;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
  wordSpacing: number; // percentage (100 = normal)
  animationType: "highlight" | "karaoke" | "scale" | "bounce";
  bestFor: string;
}

export const VIRAL_STYLES: Record<string, ViralCaptionStyle> = {
  hormozi: {
    id: "hormozi",
    name: "Hormozi",
    description: "Bold cyan highlights with thick outline",
    fontName: "Montserrat",
    fontNameFallback: "IBM Plex Sans",
    fontSize: 105,
    primaryColor: "#FFFFFF",
    highlightColor: "#00FFFF",
    outlineColor: "#000000",
    shadowColor: "#000000",
    shadowAlpha: 128,
    outlineSize: 5.0,
    shadowDepth: 4.5,
    bold: true,
    italic: false,
    letterSpacing: 0,
    wordSpacing: 100,
    animationType: "highlight",
    bestFor: "Business & motivation",
  },
  mrbeast: {
    id: "mrbeast",
    name: "MrBeast",
    description: "Yellow text with orange highlights and extra thick outline",
    fontName: "Bebas Neue",
    fontNameFallback: "IBM Plex Sans",
    fontSize: 120,
    primaryColor: "#FFFF00",
    highlightColor: "#FF6600",
    outlineColor: "#000000",
    shadowColor: "#000000",
    shadowAlpha: 0,
    outlineSize: 8.0,
    shadowDepth: 6.0,
    bold: true,
    italic: false,
    letterSpacing: 0,
    wordSpacing: 100,
    animationType: "highlight",
    bestFor: "Gaming & entertainment",
  },
  karaoke: {
    id: "karaoke",
    name: "Karaoke",
    description: "Color wipe animation from left to right",
    fontName: "Montserrat",
    fontNameFallback: "IBM Plex Sans",
    fontSize: 105,
    primaryColor: "#FFFFFF",
    highlightColor: "#0080FF",
    outlineColor: "#000000",
    shadowColor: "#000000",
    shadowAlpha: 128,
    outlineSize: 4.0,
    shadowDepth: 3.0,
    bold: true,
    italic: false,
    letterSpacing: 0,
    wordSpacing: 100,
    animationType: "karaoke",
    bestFor: "Music & sing-alongs",
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Subtle scaling effect with near-white highlights",
    fontName: "Bebas Neue",
    fontNameFallback: "IBM Plex Sans",
    fontSize: 120,
    primaryColor: "#FFFFFF",
    highlightColor: "#F5F5F5",
    outlineColor: "#000000",
    shadowColor: "#000000",
    shadowAlpha: 128,
    outlineSize: 4.0,
    shadowDepth: 3.0,
    bold: true,
    italic: true,
    letterSpacing: 3.0,
    wordSpacing: 110,
    animationType: "scale",
    bestFor: "Professional & clean",
  },
  bounce: {
    id: "bounce",
    name: "Bounce",
    description: "Playful bounce animation with bright colors",
    fontName: "Bangers",
    fontNameFallback: "IBM Plex Sans",
    fontSize: 110,
    primaryColor: "#00FF88",
    highlightColor: "#FF00FF",
    outlineColor: "#000000",
    shadowColor: "#000000",
    shadowAlpha: 0,
    outlineSize: 5.0,
    shadowDepth: 5.0,
    bold: true,
    italic: false,
    letterSpacing: 0,
    wordSpacing: 100,
    animationType: "bounce",
    bestFor: "Fun & energetic",
  },
  classic: {
    id: "classic",
    name: "Classic",
    description: "Traditional yellow highlights with Anton font",
    fontName: "Anton",
    fontNameFallback: "IBM Plex Sans",
    fontSize: 105,
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    shadowColor: "#000000",
    shadowAlpha: 180,
    outlineSize: 6.0,
    shadowDepth: 3.0,
    bold: true,
    italic: false,
    letterSpacing: 0,
    wordSpacing: 100,
    animationType: "highlight",
    bestFor: "Viral & attention-grabbing",
  },
  
  // ─── EXTENDED STYLES (2026 TRENDING) ───
  
  neon: {
    id: "neon",
    name: "Neon Glow",
    description: "Bright neon colors with electric glow effect",
    fontName: "Bebas Neue",
    fontNameFallback: "IBM Plex Sans",
    fontSize: 115,
    primaryColor: "#FF00FF", // magenta
    highlightColor: "#00FFFF", // cyan
    outlineColor: "#000000",
    shadowColor: "#FF00FF",
    shadowAlpha: 200,
    outlineSize: 4.0,
    shadowDepth: 8.0,
    bold: true,
    italic: false,
    letterSpacing: 2.0,
    wordSpacing: 105,
    animationType: "highlight",
    bestFor: "Gaming & tech",
  },
  
  retro: {
    id: "retro",
    name: "Retro Wave",
    description: "80s vaporwave aesthetic with pink/blue gradient feel",
    fontName: "Bangers",
    fontNameFallback: "IBM Plex Sans",
    fontSize: 110,
    primaryColor: "#FF1493", // deep pink
    highlightColor: "#00CED1", // dark turquoise
    outlineColor: "#4B0082", // indigo
    shadowColor: "#FF1493",
    shadowAlpha: 150,
    outlineSize: 6.0,
    shadowDepth: 5.0,
    bold: true,
    italic: true,
    letterSpacing: 1.0,
    wordSpacing: 110,
    animationType: "bounce",
    bestFor: "Nostalgic & aesthetic",
  },
  
  luxury: {
    id: "luxury",
    name: "Luxury Gold",
    description: "Premium gold text with elegant styling",
    fontName: "Cinzel",
    fontNameFallback: "Playfair Display",
    fontSize: 100,
    primaryColor: "#FFD700", // gold
    highlightColor: "#FFFFFF", // white highlight
    outlineColor: "#1C1C1C", // dark grey
    shadowColor: "#000000",
    shadowAlpha: 180,
    outlineSize: 3.0,
    shadowDepth: 4.0,
    bold: true,
    italic: false,
    letterSpacing: 3.0,
    wordSpacing: 115,
    animationType: "scale",
    bestFor: "Luxury & finance",
  },
  
  streetwear: {
    id: "streetwear",
    name: "Streetwear",
    description: "Bold street style with heavy outline",
    fontName: "Impact",
    fontNameFallback: "Arial Black",
    fontSize: 125,
    primaryColor: "#FF0000", // red
    highlightColor: "#FFFF00", // yellow
    outlineColor: "#000000",
    shadowColor: "#000000",
    shadowAlpha: 0,
    outlineSize: 10.0,
    shadowDepth: 0,
    bold: true,
    italic: false,
    letterSpacing: -1.0,
    wordSpacing: 95,
    animationType: "highlight",
    bestFor: "Fashion & culture",
  },
  
  comic: {
    id: "comic",
    name: "Comic Book",
    description: "Comic book speech bubble style",
    fontName: "Bangers",
    fontNameFallback: "Comic Sans MS",
    fontSize: 105,
    primaryColor: "#000000", // black
    highlightColor: "#FF0000", // red for emphasis
    outlineColor: "#FFFFFF", // white outline (inverted)
    shadowColor: "#FFFF00", // yellow shadow
    shadowAlpha: 220,
    outlineSize: 7.0,
    shadowDepth: 3.0,
    bold: true,
    italic: false,
    letterSpacing: 0,
    wordSpacing: 100,
    animationType: "bounce",
    bestFor: "Comedy & reactions",
  },
  
  corporate: {
    id: "corporate",
    name: "Corporate Clean",
    description: "Professional business presentation style",
    fontName: "Helvetica",
    fontNameFallback: "Arial",
    fontSize: 95,
    primaryColor: "#2C3E50", // dark blue-grey
    highlightColor: "#3498DB", // bright blue
    outlineColor: "#FFFFFF", // white outline
    shadowColor: "#000000",
    shadowAlpha: 100,
    outlineSize: 2.0,
    shadowDepth: 2.0,
    bold: false,
    italic: false,
    letterSpacing: 1.0,
    wordSpacing: 105,
    animationType: "scale",
    bestFor: "Business & education",
  },
  
  horror: {
    id: "horror",
    name: "Horror Glitch",
    description: "Distorted horror movie style",
    fontName: "Creepster",
    fontNameFallback: "Impact",
    fontSize: 110,
    primaryColor: "#8B0000", // dark red
    highlightColor: "#FF0000", // bright red
    outlineColor: "#000000",
    shadowColor: "#FF0000",
    shadowAlpha: 200,
    outlineSize: 5.0,
    shadowDepth: 6.0,
    bold: true,
    italic: true,
    letterSpacing: 2.0,
    wordSpacing: 100,
    animationType: "highlight",
    bestFor: "Horror & thriller",
  },
  
  pastel: {
    id: "pastel",
    name: "Soft Pastel",
    description: "Gentle pastel colors for wholesome content",
    fontName: "Quicksand",
    fontNameFallback: "Trebuchet MS",
    fontSize: 100,
    primaryColor: "#FFB6C1", // light pink
    highlightColor: "#E0BBE4", // lavender
    outlineColor: "#FFFFFF",
    shadowColor: "#D8BFD8",
    shadowAlpha: 150,
    outlineSize: 3.0,
    shadowDepth: 3.0,
    bold: false,
    italic: false,
    letterSpacing: 1.5,
    wordSpacing: 108,
    animationType: "scale",
    bestFor: "Lifestyle & wellness",
  },
  
  fire: {
    id: "fire",
    name: "Fire Bars",
    description: "Hot take style with orange-red gradient feel",
    fontName: "Oswald",
    fontNameFallback: "Arial Black",
    fontSize: 115,
    primaryColor: "#FF4500", // orange-red
    highlightColor: "#FFD700", // gold
    outlineColor: "#8B0000", // dark red
    shadowColor: "#FF8C00",
    shadowAlpha: 180,
    outlineSize: 5.0,
    shadowDepth: 4.0,
    bold: true,
    italic: false,
    letterSpacing: 0,
    wordSpacing: 100,
    animationType: "highlight",
    bestFor: "Hot takes & rants",
  },
  
  iced: {
    id: "iced",
    name: "Ice Cold",
    description: "Frosty blue with cool vibe",
    fontName: "Montserrat",
    fontNameFallback: "Verdana",
    fontSize: 105,
    primaryColor: "#87CEEB", // sky blue
    highlightColor: "#00FFFF", // cyan
    outlineColor: "#1E90FF", // dodger blue
    shadowColor: "#B0E0E6",
    shadowAlpha: 200,
    outlineSize: 4.0,
    shadowDepth: 4.0,
    bold: true,
    italic: false,
    letterSpacing: 1.0,
    wordSpacing: 105,
    animationType: "highlight",
    bestFor: "Chill & calm",
  },
  
  matrix: {
    id: "matrix",
    name: "Matrix Code",
    description: "Hacker/tech aesthetic with green on black",
    fontName: "Courier New",
    fontNameFallback: "Monospace",
    fontSize: 100,
    primaryColor: "#00FF00", // bright green
    highlightColor: "#39FF14", // neon green
    outlineColor: "#000000",
    shadowColor: "#00FF00",
    shadowAlpha: 220,
    outlineSize: 2.0,
    shadowDepth: 5.0,
    bold: true,
    italic: false,
    letterSpacing: 0,
    wordSpacing: 100,
    animationType: "karaoke",
    bestFor: "Tech & hacking",
  },
};

/**
 * Convert hex color to ASS format &HAABBGGRR&
 * ASS uses BGR instead of RGB, with optional alpha channel
 */
function hexToASS(hex: string, alpha: number = 0): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${r.toString(16).padStart(2, "0").toUpperCase()}`;
}

export interface WordTimestamp {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Generate ASS subtitles with viral word-by-word animations.
 * Based on nicolaigaina/ai-video-captions (MIT licensed).
 * 
 * @param words Word-level timestamps from Whisper
 * @param styleId Style ID (hormozi, mrbeast, karaoke, minimal, bounce, classic)
 * @param videoWidth Video width in pixels
 * @param videoHeight Video height in pixels
 * @param positionPercent Position from bottom as percentage (5-50%, default 10)
 * @returns ASS subtitle file content
 */
export function generateViralASS(
  words: WordTimestamp[],
  styleId: string,
  videoWidth: number,
  videoHeight: number,
  positionPercent: number = 10,
): string {
  const style = VIRAL_STYLES[styleId];
  if (!style) {
    throw new Error(`Invalid style: ${styleId}. Available: ${Object.keys(VIRAL_STYLES).join(", ")}`);
  }

  const primaryASS = hexToASS(style.primaryColor);
  const highlightASS = hexToASS(style.highlightColor);
  const outlineASS = hexToASS(style.outlineColor);
  const shadowASS = hexToASS(style.shadowColor, style.shadowAlpha);

  // ASS header
  let ass = `[Script Info]
Title: Viral Captions
ScriptType: v4.00+
WrapStyle: 0
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontName},${style.fontSize},${primaryASS},${highlightASS},${outlineASS},${shadowASS},${style.bold ? "-1" : "0"},${style.italic ? "-1" : "0"},0,0,100,100,${style.letterSpacing},0,1,${style.outlineSize},${style.shadowDepth},2,10,10,${Math.floor((videoHeight * positionPercent) / 100)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Generate word-by-word events based on animation type
  for (const word of words) {
    const startSec = word.startMs / 1000;
    const endSec = word.endMs / 1000;
    const text = word.text.toUpperCase(); // Most viral styles use all-caps

    const startTime = formatASSTime(startSec);
    const endTime = formatASSTime(endSec);

    let assText = "";
    switch (style.animationType) {
      case "highlight":
        // Word pops to highlight color when spoken
        assText = `{\\c${highlightASS}}${text}`;
        break;
      case "karaoke":
        // Karaoke wipe effect (fill from left to right)
        const duration = (endSec - startSec) * 100; // in centiseconds
        assText = `{\\k${Math.round(duration)}}${text}`;
        break;
      case "scale":
        // Subtle scale up when active
        assText = `{\\fscx110\\fscy110}${text}`;
        break;
      case "bounce":
        // Bounce effect with position shift
        assText = `{\\move(0,-10,0,0,0,${Math.round((endSec - startSec) * 1000 / 2)})}${text}`;
        break;
      default:
        assText = text;
    }

    ass += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${assText}\n`;
  }

  return ass;
}

/**
 * Format time in ASS format: H:MM:SS.CS (centiseconds)
 */
function formatASSTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}
