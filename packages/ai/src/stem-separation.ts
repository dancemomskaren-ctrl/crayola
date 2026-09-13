// Multi-Stem Audio Separation using Demucs (Facebook Research)
// Separates audio into 4 stems: vocals, drums, bass, other
// Requires: pip install demucs (or pipx install demucs)

import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join, basename, extname } from "path";
import { randomUUID } from "crypto";

export interface StemSeparationOptions {
  audioPath: string;
  model?: DemucsModel;
  outputDir?: string; // defaults to /tmp/crayola-stems/<uuid>
  twoStems?: "vocals" | "drums" | "bass"; // optional: only separate one stem vs rest
  shifts?: number; // quality shifts (1=fast, 5=best, default 1)
  device?: "cpu" | "cuda"; // default cpu
}

export type DemucsModel =
  | "htdemucs" // default, best quality hybrid transformer
  | "htdemucs_ft" // fine-tuned, slightly better but slower
  | "mdx_extra" // older MDX-Net, faster
  | "mdx_extra_q"; // quantized MDX-Net, fastest

export interface StemFiles {
  vocals: string; // path to vocals.wav
  drums: string; // path to drums.wav
  bass: string; // path to bass.wav
  other: string; // path to other.wav
  outputDir: string; // parent directory containing stems
}

export interface StemEnergy {
  stem: "vocals" | "drums" | "bass" | "other";
  rmsTimeline: number[]; // normalized 0-1, one value per 100ms window
  peakTimeline: number[]; // peak energy per window
  averageEnergy: number;
  peakEnergy: number;
  dominantRanges: Array<{ startMs: number; endMs: number; energy: number }>;
}

export interface MultiStemAnalysis {
  stems: StemFiles;
  energy: {
    vocals: StemEnergy;
    drums: StemEnergy;
    bass: StemEnergy;
    other: StemEnergy;
  };
  dominantTimeline: Array<{
    startMs: number;
    endMs: number;
    dominantStem: "vocals" | "drums" | "bass" | "other";
    energy: number;
    secondaryStem?: "vocals" | "drums" | "bass" | "other";
  }>;
  bpm: number; // re-estimated from drums stem (more accurate)
  hasSinging: boolean; // true if vocals stem has significant energy
}

const WINDOW_MS = 100; // 100ms analysis windows

/**
 * Check if Demucs is installed and available.
 */
export async function isDemucsAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["demucs", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Separate audio into stems using Demucs.
 * Returns paths to the 4 stem WAV files.
 */
export async function separateStems(
  opts: StemSeparationOptions,
): Promise<StemFiles> {
  const model = opts.model ?? "htdemucs";
  const shifts = opts.shifts ?? 1;
  const device = opts.device ?? "cpu";
  const outputDir = opts.outputDir ?? join("/tmp", "crayola-stems", randomUUID());

  if (!existsSync(opts.audioPath)) {
    throw new Error(`Audio file not found: ${opts.audioPath}`);
  }

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  console.log(`[stem-sep] Separating stems with ${model} (shifts=${shifts})...`);
  console.log(`[stem-sep] Input: ${opts.audioPath}`);
  console.log(`[stem-sep] Output: ${outputDir}`);

  const args = [
    "demucs",
    "--out", outputDir,
    "--name", "stems",
    "-n", model,
    "--device", device,
    "--shifts", String(shifts),
  ];

  // Optional: two-stem mode (faster, isolates one stem vs rest)
  if (opts.twoStems) {
    args.push("--two-stems", opts.twoStems);
  }

  args.push(opts.audioPath);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Demucs failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
  }

  console.log("[stem-sep] Separation complete.");

  // Demucs outputs to: <outputDir>/stems/<filename_without_ext>/
  const inputName = basename(opts.audioPath, extname(opts.audioPath));
  const stemsDir = join(outputDir, "stems", inputName);

  if (!existsSync(stemsDir)) {
    // Try alternate path structure
    const files = readdirSync(join(outputDir, "stems"));
    const actualDir = files[0] ? join(outputDir, "stems", files[0]) : stemsDir;
    if (!existsSync(actualDir)) {
      throw new Error(`Stems directory not found at ${stemsDir}. Demucs output: ${stderr.slice(0, 300)}`);
    }
    return buildStemFiles(actualDir);
  }

  return buildStemFiles(stemsDir);
}

function buildStemFiles(dir: string): StemFiles {
  return {
    vocals: join(dir, "vocals.wav"),
    drums: join(dir, "drums.wav"),
    bass: join(dir, "bass.wav"),
    other: join(dir, "other.wav"),
    outputDir: dir,
  };
}

/**
 * Analyze energy of a single stem WAV file.
 * Uses FFmpeg to get RMS energy in 100ms windows.
 */
async function analyzeStemFile(
  stemPath: string,
  stemType: "vocals" | "drums" | "bass" | "other",
): Promise<StemEnergy> {
  if (!existsSync(stemPath)) {
    console.warn(`[stem-sep] Stem file missing: ${stemPath}`);
    return {
      stem: stemType,
      rmsTimeline: [],
      peakTimeline: [],
      averageEnergy: 0,
      peakEnergy: 0,
      dominantRanges: [],
    };
  }

  // Use FFmpeg astats with reset=1 for ~100ms windows (at 44.1kHz)
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i", stemPath,
      "-af", "astats=metadata=1:reset=4410", // 4410 samples = 100ms at 44.1kHz
      "-f", "null",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  const rmsTimeline: number[] = [];
  const peakTimeline: number[] = [];

  for (const line of stderr.split("\n")) {
    const rmsMatch = line.match(/RMS_level=([-\d.]+)/);
    if (rmsMatch) {
      const db = parseFloat(rmsMatch[1]);
      const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
      rmsTimeline.push(normalized);
    }
    const peakMatch = line.match(/Peak_level=([-\d.]+)/);
    if (peakMatch) {
      const db = parseFloat(peakMatch[1]);
      const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
      peakTimeline.push(normalized);
    }
  }

  const averageEnergy = rmsTimeline.length > 0
    ? rmsTimeline.reduce((a, b) => a + b, 0) / rmsTimeline.length
    : 0;
  const peakEnergy = rmsTimeline.length > 0
    ? Math.max(...rmsTimeline)
    : 0;

  // Find dominant ranges (where this stem is above 0.4 energy)
  const dominantRanges = findDominantRanges(rmsTimeline, 0.4);

  return {
    stem: stemType,
    rmsTimeline,
    peakTimeline,
    averageEnergy,
    peakEnergy,
    dominantRanges,
  };
}

/**
 * Find contiguous ranges where energy exceeds threshold.
 */
function findDominantRanges(
  timeline: number[],
  threshold: number,
): Array<{ startMs: number; endMs: number; energy: number }> {
  const ranges: Array<{ startMs: number; endMs: number; energy: number }> = [];
  let rangeStart = -1;
  let rangeEnergy = 0;
  let rangeCount = 0;

  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i] >= threshold) {
      if (rangeStart === -1) rangeStart = i;
      rangeEnergy += timeline[i];
      rangeCount++;
    } else if (rangeStart !== -1) {
      ranges.push({
        startMs: rangeStart * WINDOW_MS,
        endMs: i * WINDOW_MS,
        energy: rangeEnergy / rangeCount,
      });
      rangeStart = -1;
      rangeEnergy = 0;
      rangeCount = 0;
    }
  }

  // Close final range
  if (rangeStart !== -1) {
    ranges.push({
      startMs: rangeStart * WINDOW_MS,
      endMs: timeline.length * WINDOW_MS,
      energy: rangeEnergy / rangeCount,
    });
  }

  return ranges;
}

/**
 * Full multi-stem analysis: separate + analyze all 4 stems.
 * This is the main entry point for Enhancement 5.
 */
export async function analyzeMultiStem(
  opts: StemSeparationOptions,
): Promise<MultiStemAnalysis> {
  // Step 1: Separate stems with Demucs
  const stems = await separateStems(opts);

  // Step 2: Analyze energy of each stem in parallel
  console.log("[stem-sep] Analyzing stem energy...");
  const [vocalsEnergy, drumsEnergy, bassEnergy, otherEnergy] =
    await Promise.all([
      analyzeStemFile(stems.vocals, "vocals"),
      analyzeStemFile(stems.drums, "drums"),
      analyzeStemFile(stems.bass, "bass"),
      analyzeStemFile(stems.other, "other"),
    ]);

  // Step 3: Build dominant timeline (which stem is loudest at each window)
  const maxLen = Math.max(
    vocalsEnergy.rmsTimeline.length,
    drumsEnergy.rmsTimeline.length,
    bassEnergy.rmsTimeline.length,
    otherEnergy.rmsTimeline.length,
  );

  const dominantTimeline: MultiStemAnalysis["dominantTimeline"] = [];
  for (let i = 0; i < maxLen; i++) {
    const v = vocalsEnergy.rmsTimeline[i] ?? 0;
    const d = drumsEnergy.rmsTimeline[i] ?? 0;
    const b = bassEnergy.rmsTimeline[i] ?? 0;
    const o = otherEnergy.rmsTimeline[i] ?? 0;

    const all = [
      { stem: "vocals" as const, energy: v },
      { stem: "drums" as const, energy: d },
      { stem: "bass" as const, energy: b },
      { stem: "other" as const, energy: o },
    ].sort((a, b) => b.energy - a.energy);

    dominantTimeline.push({
      startMs: i * WINDOW_MS,
      endMs: (i + 1) * WINDOW_MS,
      dominantStem: all[0].stem,
      energy: all[0].energy,
      secondaryStem: all[1].energy > 0.2 ? all[1].stem : undefined,
    });
  }

  // Step 4: Estimate BPM from drums stem (more accurate than full mix)
  const bpm = estimateBPMFromDrums(drumsEnergy.rmsTimeline);

  // Step 5: Detect if vocals are present (singing vs instrumental)
  const hasSinging = vocalsEnergy.averageEnergy > 0.15;

  console.log(`[stem-sep] Analysis complete. BPM=${bpm}, singing=${hasSinging}`);

  return {
    stems,
    energy: {
      vocals: vocalsEnergy,
      drums: drumsEnergy,
      bass: bassEnergy,
      other: otherEnergy,
    },
    dominantTimeline,
    bpm,
    hasSinging,
  };
}

/**
 * Estimate BPM from drums stem energy peaks.
 * More accurate than full-mix analysis because kick/snare are isolated.
 */
function estimateBPMFromDrums(drumsTimeline: number[]): number {
  if (drumsTimeline.length < 20) return 120; // fallback

  // Find peaks in drums energy (these are kick/snare hits)
  const peaks: number[] = [];
  const threshold = 0.5;
  const minGap = 2; // minimum 200ms between peaks (max 300 BPM)

  for (let i = 2; i < drumsTimeline.length - 2; i++) {
    if (
      drumsTimeline[i] > threshold &&
      drumsTimeline[i] > drumsTimeline[i - 1] &&
      drumsTimeline[i] > drumsTimeline[i + 1] &&
      drumsTimeline[i] > drumsTimeline[i - 2] &&
      drumsTimeline[i] > drumsTimeline[i + 2]
    ) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minGap) {
        peaks.push(i);
      }
    }
  }

  if (peaks.length < 2) return 120;

  // Calculate intervals between drum hits
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push((peaks[i] - peaks[i - 1]) * WINDOW_MS);
  }

  // Use median interval for robustness
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];

  const bpm = Math.round(60000 / median);
  return Math.max(60, Math.min(200, bpm));
}

/**
 * Clean up stem files after processing.
 */
export function cleanupStems(stems: StemFiles): void {
  try {
    rmSync(stems.outputDir, { recursive: true, force: true });
    console.log("[stem-sep] Cleaned up temporary stem files.");
  } catch (err: any) {
    console.warn(`[stem-sep] Cleanup failed: ${err.message}`);
  }
}

/**
 * Get the dominant stem at a specific timestamp.
 */
export function getDominantStemAt(
  analysis: MultiStemAnalysis,
  timeMs: number,
): { stem: "vocals" | "drums" | "bass" | "other"; energy: number } {
  const idx = Math.floor(timeMs / WINDOW_MS);
  const entry = analysis.dominantTimeline[idx];
  if (!entry) {
    return { stem: "other", energy: 0 };
  }
  return { stem: entry.dominantStem, energy: entry.energy };
}

/**
 * Get enhanced camera suggestion based on real stem separation.
 * Much more accurate than frequency-band estimation.
 */
export function getStemCameraSuggestion(
  analysis: MultiStemAnalysis,
  timeMs: number,
): { angle: "close-up" | "medium" | "wide"; reason: string } {
  const { stem, energy } = getDominantStemAt(analysis, timeMs);

  switch (stem) {
    case "vocals":
      return {
        angle: "close-up",
        reason: "vocals dominant — intimate framing",
      };
    case "drums":
      return energy > 0.7
        ? { angle: "wide", reason: "high-energy drums — energetic wide shot" }
        : { angle: "medium", reason: "drums present — balanced medium" };
    case "bass":
      return {
        angle: "wide",
        reason: "bass dominant — feels expansive",
      };
    case "other":
      return {
        angle: "medium",
        reason: "instruments — balanced medium shot",
      };
  }
}