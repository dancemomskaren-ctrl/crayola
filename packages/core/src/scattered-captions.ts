// Scattered word captions — aesthetic edit style
// Each word appears at random position as spoken, all stay visible until clip end

export interface ScatteredWordOptions {
  words: Array<{ text: string; startMs: number; endMs: number }>;
  videoWidth: number;
  videoHeight: number;
  style?: "clean" | "neon" | "pastel" | "bold" | "handwritten";
  minFontSize?: number; // default 60
  maxFontSize?: number; // default 100
  safeMargin?: number; // pixels from edge, default 50
  rotationRange?: number; // degrees, default 15
}

interface ScatteredWordStyle {
  fontFamily: string;
  fontColor: string;
  outlineColor: string;
  outlineSize: number;
  shadowColor: string;
  shadowX: number;
  shadowY: number;
  bold: boolean;
  italic: boolean;
}

const SCATTERED_STYLES: Record<string, ScatteredWordStyle> = {
  clean: {
    fontFamily: "Arial",
    fontColor: "white",
    outlineColor: "black",
    outlineSize: 2,
    shadowColor: "0x00000060",
    shadowX: 2,
    shadowY: 2,
    bold: true,
    italic: false,
  },
  neon: {
    fontFamily: "Impact",
    fontColor: "#00FFFF", // cyan
    outlineColor: "#FF00FF", // magenta
    outlineSize: 3,
    shadowColor: "0x00FFFF80",
    shadowX: 0,
    shadowY: 0,
    bold: true,
    italic: false,
  },
  pastel: {
    fontFamily: "Trebuchet MS",
    fontColor: "#FFB6C1", // light pink
    outlineColor: "#FFFFFF",
    outlineSize: 2,
    shadowColor: "0xE0BBE480",
    shadowX: 2,
    shadowY: 2,
    bold: false,
    italic: false,
  },
  bold: {
    fontFamily: "Impact",
    fontColor: "#FFFF00", // yellow
    outlineColor: "#000000",
    outlineSize: 5,
    shadowColor: "0x00000080",
    shadowX: 3,
    shadowY: 3,
    bold: true,
    italic: false,
  },
  handwritten: {
    fontFamily: "Comic Sans MS",
    fontColor: "#2C3E50", // dark blue-grey
    outlineColor: "#FFFFFF",
    outlineSize: 1,
    shadowColor: "0x00000040",
    shadowX: 1,
    shadowY: 1,
    bold: false,
    italic: true,
  },
};

/**
 * Generate scattered-word captions as ffmpeg drawtext filters.
 * Each word appears at random position when spoken and stays visible.
 * 
 * @returns Array of drawtext filter strings (one per word)
 */
export function generateScatteredWordFilters(opts: ScatteredWordOptions): string[] {
  const style = SCATTERED_STYLES[opts.style || "clean"];
  const minSize = opts.minFontSize || 60;
  const maxSize = opts.maxFontSize || 100;
  const margin = opts.safeMargin || 50;
  const rotRange = opts.rotationRange || 15;

  // Calculate safe zone for text placement
  const safeWidth = opts.videoWidth - (margin * 2);
  const safeHeight = opts.videoHeight - (margin * 2);

  const filters: string[] = [];
  const usedPositions: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const word of opts.words) {
    const startSec = word.startMs / 1000;
    const text = word.text.trim();
    if (!text) continue;

    // Random font size
    const fontSize = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;

    // Estimate text dimensions (rough approximation)
    const charWidth = fontSize * 0.6; // approx char width
    const textWidth = text.length * charWidth;
    const textHeight = fontSize * 1.2;

    // Find non-overlapping position (with max 10 attempts)
    let x = 0;
    let y = 0;
    let attempts = 0;
    let overlaps = true;

    while (overlaps && attempts < 10) {
      x = margin + Math.floor(Math.random() * (safeWidth - textWidth));
      y = margin + Math.floor(Math.random() * (safeHeight - textHeight));

      // Check for overlap with existing words
      overlaps = usedPositions.some(pos => {
        return !(
          x + textWidth < pos.x ||
          x > pos.x + pos.width ||
          y + textHeight < pos.y ||
          y > pos.y + pos.height
        );
      });

      attempts++;
    }

    // If still overlapping after 10 attempts, allow it (better than failing)
    usedPositions.push({ x, y, width: textWidth, height: textHeight });

    // Random rotation
    const rotation = (Math.random() * rotRange * 2) - rotRange; // -rotRange to +rotRange

    // Escape text for ffmpeg
    const escaped = text.replace(/'/g, "'\\''");

    // Build drawtext filter
    let filter = `drawtext=text='${escaped}'`;
    filter += `:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans${style.bold ? "-Bold" : ""}.ttf`;
    filter += `:fontsize=${fontSize}`;
    filter += `:fontcolor=${style.fontColor}`;
    filter += `:borderw=${style.outlineSize}`;
    filter += `:bordercolor=${style.outlineColor}`;
    filter += `:shadowcolor=${style.shadowColor}`;
    filter += `:shadowx=${style.shadowX}`;
    filter += `:shadowy=${style.shadowY}`;
    filter += `:x=${x}`;
    filter += `:y=${y}`;

    // Add rotation if non-zero
    if (Math.abs(rotation) > 0.5) {
      // FFmpeg text rotation is tricky — use affine transform instead
      // For now, skip rotation to keep it simple (can add later with complex filter)
    }

    // Enable from word start to end of video (stays visible)
    filter += `:enable='gte(t,${startSec.toFixed(3)})'`;

    // Add fade-in animation (0.2s)
    const fadeEnd = startSec + 0.2;
    filter += `:alpha='if(lt(t,${fadeEnd.toFixed(3)}),(t-${startSec.toFixed(3)})/0.2,1)'`;

    filters.push(filter);
  }

  return filters;
}

/**
 * Build complete ffmpeg filter_complex string for scattered words.
 * Chains all drawtext filters together.
 */
export function buildScatteredWordFilterComplex(opts: ScatteredWordOptions): string {
  const filters = generateScatteredWordFilters(opts);
  return filters.join(",");
}

/**
 * Simplified approach: group words into batches to avoid overwhelming ffmpeg.
 * For videos with 100+ words, we batch them into groups that appear/disappear together.
 */
export function generateScatteredWordFiltersBatched(
  opts: ScatteredWordOptions,
  batchSize: number = 20,
): string[] {
  const style = SCATTERED_STYLES[opts.style || "clean"];
  const minSize = opts.minFontSize || 60;
  const maxSize = opts.maxFontSize || 100;
  const margin = opts.safeMargin || 50;

  const safeWidth = opts.videoWidth - (margin * 2);
  const safeHeight = opts.videoHeight - (margin * 2);

  const filters: string[] = [];
  
  // Process words in batches
  for (let i = 0; i < opts.words.length; i += batchSize) {
    const batch = opts.words.slice(i, i + batchSize);
    if (batch.length === 0) continue;

    const batchStartSec = batch[0].startMs / 1000;
    const batchEndSec = batch[batch.length - 1].endMs / 1000;

    // For each batch, create a multi-word layout
    const usedPositions: Array<{ x: number; y: number; width: number; height: number }> = [];

    for (const word of batch) {
      const startSec = word.startMs / 1000;
      const text = word.text.trim();
      if (!text) continue;

      const fontSize = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
      const charWidth = fontSize * 0.6;
      const textWidth = text.length * charWidth;
      const textHeight = fontSize * 1.2;

      // Find position
      let x = 0;
      let y = 0;
      let attempts = 0;
      let overlaps = true;

      while (overlaps && attempts < 10) {
        x = margin + Math.floor(Math.random() * (safeWidth - textWidth));
        y = margin + Math.floor(Math.random() * (safeHeight - textHeight));

        overlaps = usedPositions.some(pos => {
          return !(
            x + textWidth < pos.x ||
            x > pos.x + pos.width ||
            y + textHeight < pos.y ||
            y > pos.y + pos.height
          );
        });

        attempts++;
      }

      usedPositions.push({ x, y, width: textWidth, height: textHeight });

      const escaped = text.replace(/'/g, "'\\''");

      let filter = `drawtext=text='${escaped}'`;
      filter += `:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans${style.bold ? "-Bold" : ""}.ttf`;
      filter += `:fontsize=${fontSize}`;
      filter += `:fontcolor=${style.fontColor}`;
      filter += `:borderw=${style.outlineSize}`;
      filter += `:bordercolor=${style.outlineColor}`;
      filter += `:shadowcolor=${style.shadowColor}`;
      filter += `:shadowx=${style.shadowX}`;
      filter += `:shadowy=${style.shadowY}`;
      filter += `:x=${x}`;
      filter += `:y=${y}`;

      // Visible from word start, fade in over 0.2s
      const fadeEnd = startSec + 0.2;
      filter += `:enable='gte(t,${startSec.toFixed(3)})'`;
      filter += `:alpha='if(lt(t,${fadeEnd.toFixed(3)}),(t-${startSec.toFixed(3)})/0.2,1)'`;

      filters.push(filter);
    }
  }

  return filters;
}
