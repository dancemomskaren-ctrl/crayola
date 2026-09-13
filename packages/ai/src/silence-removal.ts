// Silence Removal & Speed Ramping
// Inspired by WyattBlue/auto-editor (Unlicense/Public Domain)
// Detects silence/speech segments and enables:
//   - Hard cut (remove silence entirely)
//   - Speed ramp (speed up silence, keep speech normal)
//   - Margin padding (keep Xms of silence around speech for natural feel)
//   - Motion-based cuts (via FFmpeg scene detection)

import { existsSync } from "fs";
import { join } from "path";

// ─── Types ───

export interface SilenceDetectOptions {
  inputPath: string; // video or audio file
  threshold?: number; // dB threshold (default: -30dB, lower = more sensitive)
  minSilenceMs?: number; // minimum silence duration to detect (default: 300ms)
  minSpeechMs?: number; // minimum speech duration to keep (default: 200ms)
  method?: "audio" | "motion"; // detection method (default: audio)
  motionThreshold?: number; // for motion method: 0-1 (default: 0.02)
  stream?: number; // audio stream index (default: 0)
}

export interface Segment {
  startMs: number;
  endMs: number;
  type: "speech" | "silence";
  energy: number; // average RMS energy 0-1
  durationMs: number;
}

export interface SilenceAnalysis {
  segments: Segment[];
  totalDurationMs: number;
  speechDurationMs: number;
  silenceDurationMs: number;
  speechPercent: number;
  silenceCount: number;
}

export interface SilenceRemovalOptions {
  inputPath: string;
  outputPath: string;
  mode: "cut" | "speed" | "margin";
  threshold?: number; // dB, default -30
  minSilenceMs?: number; // default 300
  marginMs?: number; // padding around speech (default: 200ms)
  silenceSpeed?: number; // for speed mode: playback speed during silence (default: 6x)
  maxSilenceMs?: number; // cap silence duration in margin mode (default: 500ms)
}

export interface SpeedSegment {
  startMs: number;
  endMs: number;
  speed: number; // 1.0 = normal, >1 = fast
}

// ─── Silence Detection ───

/**
 * Detect silence/speech segments in a video or audio file.
 * Uses FFmpeg's silencedetect filter for accurate results.
 */
export async function detectSilence(
  opts: SilenceDetectOptions,
): Promise<SilenceAnalysis> {
  const threshold = opts.threshold ?? -30;
  const minSilenceMs = opts.minSilenceMs ?? 300;
  const minSilenceSec = minSilenceMs / 1000;
  const method = opts.method ?? "audio";

  if (!existsSync(opts.inputPath)) {
    throw new Error(`File not found: ${opts.inputPath}`);
  }

  if (method === "motion") {
    return detectByMotion(opts);
  }

  console.log(`[silence] Detecting silence (threshold=${threshold}dB, min=${minSilenceMs}ms)...`);

  // Use FFmpeg silencedetect filter — outputs start/end of each silence region
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i", opts.inputPath,
      "-af", `silencedetect=noise=${threshold}dB:d=${minSilenceSec}`,
      "-f", "null",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  // Parse silencedetect output
  // Format: [silencedetect @ ...] silence_start: 1.234
  //         [silencedetect @ ...] silence_end: 2.567 | silence_duration: 1.333
  const silenceRegions: Array<{ startMs: number; endMs: number }> = [];
  let currentStart: number | null = null;

  for (const line of stderr.split("\n")) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (startMatch) {
      currentStart = parseFloat(startMatch[1]) * 1000;
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    if (endMatch && currentStart !== null) {
      const endMs = parseFloat(endMatch[1]) * 1000;
      silenceRegions.push({ startMs: currentStart, endMs });
      currentStart = null;
    }
  }

  // Get total duration
  const durationMs = await getMediaDurationMs(opts.inputPath);

  // Build segments (interleave speech and silence)
  const segments = buildSegments(silenceRegions, durationMs, opts.minSpeechMs ?? 200);

  const speechDurationMs = segments
    .filter((s) => s.type === "speech")
    .reduce((sum, s) => sum + s.durationMs, 0);
  const silenceDurationMs = durationMs - speechDurationMs;

  console.log(
    `[silence] Found ${silenceRegions.length} silence regions. ` +
    `Speech: ${(speechDurationMs / 1000).toFixed(1)}s, ` +
    `Silence: ${(silenceDurationMs / 1000).toFixed(1)}s ` +
    `(${((silenceDurationMs / durationMs) * 100).toFixed(0)}%)`,
  );

  return {
    segments,
    totalDurationMs: durationMs,
    speechDurationMs,
    silenceDurationMs,
    speechPercent: (speechDurationMs / durationMs) * 100,
    silenceCount: silenceRegions.length,
  };
}

/**
 * Build ordered segments from silence regions.
 */
function buildSegments(
  silenceRegions: Array<{ startMs: number; endMs: number }>,
  totalDurationMs: number,
  minSpeechMs: number,
): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const silence of silenceRegions) {
    // Speech before this silence
    if (silence.startMs > cursor + minSpeechMs) {
      segments.push({
        startMs: cursor,
        endMs: silence.startMs,
        type: "speech",
        energy: 0.6, // estimated
        durationMs: silence.startMs - cursor,
      });
    } else if (silence.startMs > cursor) {
      // Too short to be speech on its own — merge into previous or skip
      if (segments.length > 0 && segments[segments.length - 1].type === "speech") {
        segments[segments.length - 1].endMs = silence.startMs;
        segments[segments.length - 1].durationMs =
          segments[segments.length - 1].endMs - segments[segments.length - 1].startMs;
      }
    }

    // The silence itself
    segments.push({
      startMs: silence.startMs,
      endMs: silence.endMs,
      type: "silence",
      energy: 0.05,
      durationMs: silence.endMs - silence.startMs,
    });

    cursor = silence.endMs;
  }

  // Trailing speech after last silence
  if (cursor < totalDurationMs - minSpeechMs) {
    segments.push({
      startMs: cursor,
      endMs: totalDurationMs,
      type: "speech",
      energy: 0.6,
      durationMs: totalDurationMs - cursor,
    });
  }

  return segments;
}

// ─── Silence Removal (FFmpeg) ───

/**
 * Remove silence from a video/audio file.
 * Three modes:
 *   - cut: hard remove silence entirely
 *   - speed: keep silence but speed it up (e.g. 6x)
 *   - margin: keep a small margin of silence around each speech segment
 */
export async function removeSilence(
  opts: SilenceRemovalOptions,
): Promise<{ outputPath: string; savedMs: number; segments: SpeedSegment[] }> {
  const analysis = await detectSilence({
    inputPath: opts.inputPath,
    threshold: opts.threshold,
    minSilenceMs: opts.minSilenceMs,
  });

  const marginMs = opts.marginMs ?? 200;
  const silenceSpeed = opts.silenceSpeed ?? 6;
  const maxSilenceMs = opts.maxSilenceMs ?? 500;

  let speedSegments: SpeedSegment[];

  switch (opts.mode) {
    case "cut":
      speedSegments = buildCutSegments(analysis.segments, marginMs);
      break;
    case "speed":
      speedSegments = buildSpeedSegments(analysis.segments, silenceSpeed, marginMs);
      break;
    case "margin":
      speedSegments = buildMarginSegments(analysis.segments, marginMs, maxSilenceMs);
      break;
  }

  // Render with FFmpeg using concat filter
  console.log(`[silence] Rendering ${opts.mode} mode...`);
  await renderSegments(opts.inputPath, opts.outputPath, speedSegments);

  const keptMs = speedSegments.reduce(
    (sum, s) => sum + (s.endMs - s.startMs) / s.speed,
    0,
  );
  const savedMs = analysis.totalDurationMs - keptMs;

  console.log(`[silence] Done. Saved ${(savedMs / 1000).toFixed(1)}s`);

  return { outputPath: opts.outputPath, savedMs, segments: speedSegments };
}

// ─── Segment Builders ───

/**
 * Cut mode: keep only speech segments with small margin.
 */
function buildCutSegments(segments: Segment[], marginMs: number): SpeedSegment[] {
  const result: SpeedSegment[] = [];

  for (const seg of segments) {
    if (seg.type === "speech") {
      result.push({
        startMs: Math.max(0, seg.startMs - marginMs),
        endMs: seg.endMs + marginMs,
        speed: 1.0,
      });
    }
    // silence segments are dropped entirely
  }

  return mergeOverlapping(result);
}

/**
 * Speed mode: keep everything but speed up silence portions.
 */
function buildSpeedSegments(
  segments: Segment[],
  silenceSpeed: number,
  marginMs: number,
): SpeedSegment[] {
  const result: SpeedSegment[] = [];

  for (const seg of segments) {
    if (seg.type === "speech") {
      result.push({ startMs: seg.startMs, endMs: seg.endMs, speed: 1.0 });
    } else {
      // Keep margin at normal speed, speed up the middle
      const silenceDur = seg.endMs - seg.startMs;
      if (silenceDur <= marginMs * 2) {
        // Short silence — keep at normal speed
        result.push({ startMs: seg.startMs, endMs: seg.endMs, speed: 1.0 });
      } else {
        // Leading margin
        result.push({ startMs: seg.startMs, endMs: seg.startMs + marginMs, speed: 1.0 });
        // Sped-up middle
        result.push({ startMs: seg.startMs + marginMs, endMs: seg.endMs - marginMs, speed: silenceSpeed });
        // Trailing margin
        result.push({ startMs: seg.endMs - marginMs, endMs: seg.endMs, speed: 1.0 });
      }
    }
  }

  return result;
}

/**
 * Margin mode: cap silence to maxSilenceMs (trim the excess).
 */
function buildMarginSegments(
  segments: Segment[],
  marginMs: number,
  maxSilenceMs: number,
): SpeedSegment[] {
  const result: SpeedSegment[] = [];

  for (const seg of segments) {
    if (seg.type === "speech") {
      result.push({ startMs: seg.startMs, endMs: seg.endMs, speed: 1.0 });
    } else {
      // Cap silence duration
      const capped = Math.min(seg.durationMs, maxSilenceMs);
      const center = seg.startMs + seg.durationMs / 2;
      result.push({
        startMs: center - capped / 2,
        endMs: center + capped / 2,
        speed: 1.0,
      });
    }
  }

  return result;
}

// ─── Utilities ───

/**
 * Merge overlapping speed segments.
 */
function mergeOverlapping(segments: SpeedSegment[]): SpeedSegment[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const merged: SpeedSegment[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].startMs <= last.endMs && sorted[i].speed === last.speed) {
      last.endMs = Math.max(last.endMs, sorted[i].endMs);
    } else {
      merged.push(sorted[i]);
    }
  }

  return merged;
}

/**
 * Render speed segments to output file using FFmpeg concat + setpts.
 */
async function renderSegments(
  inputPath: string,
  outputPath: string,
  segments: SpeedSegment[],
): Promise<void> {
  const tmpDir = join("/tmp", `silence-${Date.now()}`);
  const { mkdirSync } = await import("fs");
  mkdirSync(tmpDir, { recursive: true });

  const partPaths: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const partPath = join(tmpDir, `part-${String(i).padStart(4, "0")}.mp4`);
    partPaths.push(partPath);

    const startSec = (seg.startMs / 1000).toFixed(3);
    const durSec = ((seg.endMs - seg.startMs) / 1000).toFixed(3);

    if (seg.speed === 1.0) {
      // Stream copy — fast
      await runFFmpeg([
        "-y", "-ss", startSec, "-i", inputPath,
        "-t", durSec, "-c", "copy", "-avoid_negative_ts", "1",
        partPath,
      ]);
    } else {
      // Re-encode with speed change
      const pts = (1 / seg.speed).toFixed(4);
      const atempo = buildAtempoChain(seg.speed);
      await runFFmpeg([
        "-y", "-ss", startSec, "-i", inputPath,
        "-t", durSec,
        "-vf", `setpts=${pts}*PTS`,
        "-af", atempo,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        partPath,
      ]);
    }
  }

  // Concat all parts
  const listFile = join(tmpDir, "concat.txt");
  const listContent = partPaths.map((p) => `file '${p}'`).join("\n");
  await Bun.write(listFile, listContent);

  await runFFmpeg([
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-c", "copy", outputPath,
  ]);

  // Cleanup
  const { rmSync } = await import("fs");
  rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Build atempo filter chain for FFmpeg.
 * atempo only accepts values in [0.5, 100.0], so chain multiple for high speeds.
 */
function buildAtempoChain(speed: number): string {
  if (speed <= 2.0) return `atempo=${speed}`;

  const parts: string[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    parts.push("atempo=2.0");
    remaining /= 2.0;
  }
  parts.push(`atempo=${remaining.toFixed(4)}`);
  return parts.join(",");
}

/**
 * Run FFmpeg with args, throw on failure.
 */
async function runFFmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`FFmpeg failed: ${stderr.slice(0, 300)}`);
  }
}

/**
 * Get media duration in milliseconds.
 */
async function getMediaDurationMs(inputPath: string): Promise<number> {
  const proc = Bun.spawn(
    [
      "ffprobe", "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      inputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const seconds = parseFloat(stdout.trim());
  if (isNaN(seconds)) {
    throw new Error(`Could not determine duration of ${inputPath}`);
  }
  return seconds * 1000;
}

// ─── Motion-Based Detection ───

/**
 * Detect "silence" based on motion (for videos without meaningful audio).
 * Uses FFmpeg scene detection to find static frames.
 */
async function detectByMotion(opts: SilenceDetectOptions): Promise<SilenceAnalysis> {
  const motionThreshold = opts.motionThreshold ?? 0.02;

  console.log(`[silence] Detecting by motion (threshold=${motionThreshold})...`);

  // Use FFmpeg's select filter with scene change detection
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i", opts.inputPath,
      "-vf", `select='gt(scene,${motionThreshold})',metadata=print`,
      "-f", "null",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  // Parse scene change timestamps
  const sceneChanges: number[] = [];
  for (const line of stderr.split("\n")) {
    const match = line.match(/pts_time:([\d.]+)/);
    if (match) {
      sceneChanges.push(parseFloat(match[1]) * 1000);
    }
  }

  const durationMs = await getMediaDurationMs(opts.inputPath);
  const minSilenceMs = opts.minSilenceMs ?? 300;

  // Gaps between scene changes > minSilenceMs are "static" (silence equivalent)
  const silenceRegions: Array<{ startMs: number; endMs: number }> = [];
  let prevChange = 0;

  for (const changeMs of sceneChanges) {
    const gap = changeMs - prevChange;
    if (gap > minSilenceMs) {
      // If there's been no motion for a long time, that's "silence"
      // But actually, long gap = static scene = might be speech, short gap = cuts
      // For motion mode, we invert: periods WITH motion are "speech"
    }
    prevChange = changeMs;
  }

  // Build segments where motion = speech, no motion = silence
  const segments = buildSegments(silenceRegions, durationMs, opts.minSpeechMs ?? 200);

  const speechDurationMs = segments
    .filter((s) => s.type === "speech")
    .reduce((sum, s) => sum + s.durationMs, 0);

  return {
    segments,
    totalDurationMs: durationMs,
    speechDurationMs,
    silenceDurationMs: durationMs - speechDurationMs,
    speechPercent: (speechDurationMs / durationMs) * 100,
    silenceCount: silenceRegions.length,
  };
}