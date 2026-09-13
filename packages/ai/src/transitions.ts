// Transition rendering for music edits
// Supports all 46+ FFmpeg xfade transitions plus energy-based smart selection
// Enhancement 9: Full transition catalog (inspired by editly/xfade-easing)

export type TransitionType =
  | "cut" | "fade" | "dissolve" | "zoom_in" | "zoom_out"
  | "slide_left" | "slide_right"
  // All native FFmpeg xfade transitions:
  | XfadeTransition;

/** Every transition supported by FFmpeg's xfade filter */
export type XfadeTransition =
  | "circleclose" | "circleopen" | "circlecrop" | "rectcrop"
  | "coverleft" | "coverright" | "coverdown" | "coverup"
  | "diagbl" | "diagbr" | "diagtl" | "diagtr"
  | "fadefast" | "fadeslow" | "fadeblack" | "fadewhite" | "fadegrays"
  | "pixelize" | "radial" | "distance" | "hblur"
  | "hlslice" | "hrslice" | "vdslice" | "vuslice"
  | "hlwind" | "hrwind" | "vdwind" | "vuwind"
  | "horzclose" | "horzopen" | "vertclose" | "vertopen"
  | "revealleft" | "revealright" | "revealdown" | "revealup"
  | "slideleft" | "slideright" | "slidedown" | "slideup"
  | "smoothleft" | "smoothright" | "smoothdown" | "smoothup"
  | "squeezeh" | "squeezev" | "zoomin" | "wipeleft" | "wiperight"
  | "wipedown" | "wipeup" | "wipebl" | "wipebr" | "wipetl" | "wipetr";

/** Categories for energy-based transition selection */
export type TransitionCategory = "subtle" | "directional" | "energetic" | "dramatic";

export interface TransitionConfig {
  type: TransitionType;
  durationMs: number; // transition duration in ms (default 200-300ms)
}

/** Full transition catalog with metadata for smart selection */
export const TRANSITION_CATALOG: Record<string, { xfade: string; category: TransitionCategory; energy: number }> = {
  // Subtle (low energy — verses, intros, talking)
  fade: { xfade: "fade", category: "subtle", energy: 0.2 },
  fadefast: { xfade: "fadefast", category: "subtle", energy: 0.25 },
  fadeslow: { xfade: "fadeslow", category: "subtle", energy: 0.15 },
  dissolve: { xfade: "dissolve", category: "subtle", energy: 0.2 },
  fadeblack: { xfade: "fadeblack", category: "subtle", energy: 0.3 },
  fadewhite: { xfade: "fadewhite", category: "subtle", energy: 0.3 },
  fadegrays: { xfade: "fadegrays", category: "subtle", energy: 0.25 },
  distance: { xfade: "distance", category: "subtle", energy: 0.2 },
  hblur: { xfade: "hblur", category: "subtle", energy: 0.3 },
  // Directional (medium — builds, transitions between sections)
  slideleft: { xfade: "slideleft", category: "directional", energy: 0.5 },
  slideright: { xfade: "slideright", category: "directional", energy: 0.5 },
  slidedown: { xfade: "slidedown", category: "directional", energy: 0.5 },
  slideup: { xfade: "slideup", category: "directional", energy: 0.5 },
  smoothleft: { xfade: "smoothleft", category: "directional", energy: 0.45 },
  smoothright: { xfade: "smoothright", category: "directional", energy: 0.45 },
  smoothdown: { xfade: "smoothdown", category: "directional", energy: 0.45 },
  smoothup: { xfade: "smoothup", category: "directional", energy: 0.45 },
  coverleft: { xfade: "coverleft", category: "directional", energy: 0.5 },
  coverright: { xfade: "coverright", category: "directional", energy: 0.5 },
  coverdown: { xfade: "coverdown", category: "directional", energy: 0.5 },
  coverup: { xfade: "coverup", category: "directional", energy: 0.5 },
  revealleft: { xfade: "revealleft", category: "directional", energy: 0.5 },
  revealright: { xfade: "revealright", category: "directional", energy: 0.5 },
  revealdown: { xfade: "revealdown", category: "directional", energy: 0.5 },
  revealup: { xfade: "revealup", category: "directional", energy: 0.5 },
  wipeleft: { xfade: "wipeleft", category: "directional", energy: 0.45 },
  wiperight: { xfade: "wiperight", category: "directional", energy: 0.45 },
  wipedown: { xfade: "wipedown", category: "directional", energy: 0.45 },
  wipeup: { xfade: "wipeup", category: "directional", energy: 0.45 },
  // Energetic (high — chorus, drops, beat hits)
  circleopen: { xfade: "circleopen", category: "energetic", energy: 0.7 },
  circleclose: { xfade: "circleclose", category: "energetic", energy: 0.7 },
  circlecrop: { xfade: "circlecrop", category: "energetic", energy: 0.7 },
  rectcrop: { xfade: "rectcrop", category: "energetic", energy: 0.65 },
  hlslice: { xfade: "hlslice", category: "energetic", energy: 0.7 },
  hrslice: { xfade: "hrslice", category: "energetic", energy: 0.7 },
  vdslice: { xfade: "vdslice", category: "energetic", energy: 0.7 },
  vuslice: { xfade: "vuslice", category: "energetic", energy: 0.7 },
  squeezeh: { xfade: "squeezeh", category: "energetic", energy: 0.75 },
  squeezev: { xfade: "squeezev", category: "energetic", energy: 0.75 },
  zoomin: { xfade: "zoomin", category: "energetic", energy: 0.8 },
  radial: { xfade: "radial", category: "energetic", energy: 0.75 },
  // Dramatic (max energy — drops, impacts, hype moments)
  diagbl: { xfade: "diagbl", category: "dramatic", energy: 0.85 },
  diagbr: { xfade: "diagbr", category: "dramatic", energy: 0.85 },
  diagtl: { xfade: "diagtl", category: "dramatic", energy: 0.85 },
  diagtr: { xfade: "diagtr", category: "dramatic", energy: 0.85 },
  pixelize: { xfade: "pixelize", category: "dramatic", energy: 0.9 },
  hlwind: { xfade: "hlwind", category: "dramatic", energy: 0.9 },
  hrwind: { xfade: "hrwind", category: "dramatic", energy: 0.9 },
  vdwind: { xfade: "vdwind", category: "dramatic", energy: 0.9 },
  vuwind: { xfade: "vuwind", category: "dramatic", energy: 0.9 },
  horzclose: { xfade: "horzclose", category: "dramatic", energy: 0.85 },
  horzopen: { xfade: "horzopen", category: "dramatic", energy: 0.85 },
  vertclose: { xfade: "vertclose", category: "dramatic", energy: 0.85 },
  vertopen: { xfade: "vertopen", category: "dramatic", energy: 0.85 },
  wipebl: { xfade: "wipebl", category: "dramatic", energy: 0.8 },
  wipebr: { xfade: "wipebr", category: "dramatic", energy: 0.8 },
  wipetl: { xfade: "wipetl", category: "dramatic", energy: 0.8 },
  wipetr: { xfade: "wipetr", category: "dramatic", energy: 0.8 },
};

export const TRANSITION_PRESETS: Record<string, TransitionConfig> = {
  cut: { type: "cut", durationMs: 0 },
  fade: { type: "fade", durationMs: 200 },
  dissolve: { type: "dissolve", durationMs: 300 },
  zoom_in: { type: "zoom_in", durationMs: 250 },
  zoom_out: { type: "zoom_out", durationMs: 250 },
  slide_left: { type: "slide_left", durationMs: 200 },
  slide_right: { type: "slide_right", durationMs: 200 },
};

/**
 * Build FFmpeg xfade filter for a transition between two clips.
 * Now supports all 46+ xfade transitions via the catalog.
 */
export function buildXfadeFilter(
  offsetSec: number,
  durationSec: number,
  type: TransitionType,
): string {
  // Legacy map for backward compat
  const legacyMap: Record<string, string> = {
    cut: "fade",
    fade: "fade",
    dissolve: "dissolve",
    zoom_in: "circlecrop",
    zoom_out: "circleopen",
    slide_left: "slideleft",
    slide_right: "slideright",
  };

  // Check catalog first, then legacy map, then use as-is (it might be a raw xfade name)
  const catalogEntry = TRANSITION_CATALOG[type as string];
  const xfadeType = catalogEntry?.xfade ?? legacyMap[type] ?? type;

  return `xfade=transition=${xfadeType}:duration=${durationSec.toFixed(3)}:offset=${offsetSec.toFixed(3)}`;
}

/**
 * Concatenate video segments with transitions using FFmpeg filter_complex.
 * 
 * For hard cuts, uses simple concat demuxer (fastest).
 * For transitions, uses xfade filter chain (slower but smooth).
 * 
 * @param segmentPaths Ordered array of video segment file paths
 * @param outputPath Path for the final rendered video
 * @param transition Transition configuration
 * @param ffmpegRun Function to run ffmpeg commands
 */
export async function concatWithTransitions(
  segmentPaths: string[],
  outputPath: string,
  transition: TransitionConfig,
  ffmpegRun: (args: string[]) => Promise<void>,
): Promise<void> {
  if (segmentPaths.length === 0) {
    throw new Error("No segments to concatenate");
  }

  if (segmentPaths.length === 1) {
    // Single segment, just copy
    await ffmpegRun(["-y", "-i", segmentPaths[0], "-c", "copy", outputPath]);
    return;
  }

  // For hard cuts, use simple concat (fastest)
  if (transition.type === "cut" || transition.durationMs === 0) {
    const { writeFileSync } = await import("fs");
    const concatFile = outputPath + ".concat.txt";
    const content = segmentPaths.map(p => `file '${p}'`).join("\n");
    writeFileSync(concatFile, content);

    await ffmpegRun([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatFile,
      "-c", "copy",
      outputPath,
    ]);

    // Cleanup concat file
    try { (await import("fs")).unlinkSync(concatFile); } catch {}
    return;
  }

  // For transitions, use xfade filter chain
  const transitionDurSec = transition.durationMs / 1000;

  // Need segment durations for offset calculation
  const durations: number[] = [];
  for (const seg of segmentPaths) {
    const dur = await getSegmentDuration(seg);
    durations.push(dur);
  }

  // Build filter_complex with chained xfade filters
  const inputs: string[] = [];
  for (const seg of segmentPaths) {
    inputs.push("-i", seg);
  }

  if (segmentPaths.length === 2) {
    // Simple case: two segments, one transition
    const offset = durations[0] - transitionDurSec;
    const filter = buildXfadeFilter(offset, transitionDurSec, transition.type);

    await ffmpegRun([
      "-y",
      ...inputs,
      "-filter_complex",
      `[0:v][1:v]${filter}[vout]`,
      "-map", "[vout]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",
      outputPath,
    ]);
    return;
  }

  // Multiple segments: chain xfade filters
  const filterParts: string[] = [];
  let prevLabel = "[0:v]";
  let cumulativeOffset = 0;

  for (let i = 1; i < segmentPaths.length; i++) {
    cumulativeOffset += durations[i - 1] - transitionDurSec;
    const nextLabel = i < segmentPaths.length - 1 ? `[xv${i}]` : "[vout]";
    const filter = buildXfadeFilter(
      cumulativeOffset,
      transitionDurSec,
      transition.type,
    );
    filterParts.push(`${prevLabel}[${i}:v]${filter}${nextLabel}`);
    prevLabel = nextLabel;
  }

  const filterComplex = filterParts.join(";");

  // Calculate total output duration
  const totalDur = durations.reduce((a, b) => a + b, 0) - (segmentPaths.length - 1) * transitionDurSec;

  await ffmpegRun([
    "-y",
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    // Generate silent audio of correct length
    "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo`,
    "-map", `${segmentPaths.length}:a`,
    "-t", String(totalDur),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    outputPath,
  ]);
}

/**
 * Get duration of a video segment in seconds using ffprobe.
 */
async function getSegmentDuration(videoPath: string): Promise<number> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  return parseFloat(output.trim()) || 1;
}

/**
 * Select transition type based on music energy.
 * Higher energy = faster/harder transitions, lower energy = smoother.
 */
export function selectTransitionForEnergy(
  energy: "low" | "medium" | "high",
  userPreference: TransitionType = "fade",
): TransitionConfig {
  if (userPreference === "cut") {
    return TRANSITION_PRESETS.cut; // user wants hard cuts, respect that
  }

  switch (energy) {
    case "high":
      return { type: userPreference, durationMs: 100 };
    case "medium":
      return { type: userPreference, durationMs: 200 };
    case "low":
      return { type: userPreference, durationMs: 400 };
  }
}

/**
 * Smart transition selection from the full catalog based on energy level.
 * Picks a random transition from the appropriate category.
 * Use this for varied, professional-looking edits.
 */
export function selectTransitionFromCatalog(
  energy: number, // 0-1
  opts?: { avoidRepeat?: string; category?: TransitionCategory },
): TransitionConfig {
  let category: TransitionCategory;
  let durationMs: number;

  if (energy > 0.75) {
    category = "dramatic";
    durationMs = 150;
  } else if (energy > 0.55) {
    category = "energetic";
    durationMs = 200;
  } else if (energy > 0.3) {
    category = "directional";
    durationMs = 300;
  } else {
    category = "subtle";
    durationMs = 400;
  }

  // Override category if user specified
  if (opts?.category) category = opts.category;

  // Get all transitions in this category
  const options = Object.entries(TRANSITION_CATALOG)
    .filter(([_, v]) => v.category === category)
    .filter(([name]) => name !== opts?.avoidRepeat) // avoid repeating last one
    .map(([name]) => name);

  if (options.length === 0) {
    return { type: "fade", durationMs };
  }

  // Pick random from category
  const picked = options[Math.floor(Math.random() * options.length)];
  return { type: picked as TransitionType, durationMs };
}

/**
 * Get all available transition names (for UI/API listing).
 */
export function listAllTransitions(): string[] {
  return Object.keys(TRANSITION_CATALOG);
}
