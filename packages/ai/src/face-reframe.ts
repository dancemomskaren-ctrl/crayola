// Face Tracking + 9:16 Auto-Reframe
// Inspired by mutonby/openshorts (MIT) and KazKozDev/auto-vertical-reframe
// Takes landscape video → produces vertical (9:16) with smooth face-following crop
// Uses existing YuNet face detector (detect_faces.py) + FFmpeg crop filter

import { existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// ─── Types ───

export interface ReframeOptions {
  inputPath: string;
  outputPath: string;
  targetAspect?: "9:16" | "1:1" | "4:5"; // default 9:16
  sampleFps?: number; // face detection sample rate (default: 2fps)
  smoothing?: number; // smoothing factor 0-1 (default: 0.85, higher = smoother pan)
  padding?: number; // extra padding around face as fraction (default: 0.4)
  fallback?: "center" | "rule-of-thirds"; // when no face detected
  outputWidth?: number; // default: 1080
  multiSpeaker?: boolean; // if true, try to frame all faces (default: false)
}

export interface FaceKeyframe {
  t: number; // timestamp in seconds
  x: number; // face bbox left
  y: number; // face bbox top
  w: number; // face bbox width
  h: number; // face bbox height
}

export interface FaceTrackData {
  width: number; // source video width
  height: number; // source video height
  duration: number;
  keyframes: FaceKeyframe[];
}

export interface CropWindow {
  t: number;
  x: number; // crop left position
  y: number; // crop top position
  w: number; // crop width
  h: number; // crop height
}

export interface ReframeResult {
  outputPath: string;
  sourceWidth: number;
  sourceHeight: number;
  cropWidth: number;
  cropHeight: number;
  facesDetected: number;
  smoothedKeyframes: number;
}

// ─── Main Reframe Function ───

/**
 * Auto-reframe a landscape video to vertical (9:16) with face tracking.
 * Pipeline: detect faces → compute crop windows → smooth → render with FFmpeg crop.
 */
export async function reframeVideo(opts: ReframeOptions): Promise<ReframeResult> {
  const targetAspect = opts.targetAspect ?? "9:16";
  const sampleFps = opts.sampleFps ?? 2;
  const smoothing = opts.smoothing ?? 0.85;
  const padding = opts.padding ?? 0.4;
  const fallback = opts.fallback ?? "center";
  const outputWidth = opts.outputWidth ?? 1080;
  const multiSpeaker = opts.multiSpeaker ?? false;

  if (!existsSync(opts.inputPath)) {
    throw new Error(`Input file not found: ${opts.inputPath}`);
  }

  // Ensure output directory exists
  const outDir = dirname(opts.outputPath);
  mkdirSync(outDir, { recursive: true });

  // Step 1: Run face detection
  console.log(`[reframe] Detecting faces at ${sampleFps}fps...`);
  const trackData = await runFaceDetection(opts.inputPath, sampleFps);
  console.log(`[reframe] Detected faces in ${trackData.keyframes.length} keyframes`);

  // Step 2: Calculate crop dimensions
  const [aspectW, aspectH] = targetAspect.split(":").map(Number);
  const cropRatio = aspectW / aspectH; // e.g. 9/16 = 0.5625
  
  // Crop height = source height, crop width = height * ratio
  let cropH = trackData.height;
  let cropW = Math.round(cropH * cropRatio);

  // If crop is wider than source, constrain by width
  if (cropW > trackData.width) {
    cropW = trackData.width;
    cropH = Math.round(cropW / cropRatio);
  }

  // Step 3: Compute crop windows for each keyframe
  const rawCrops = computeCropWindows(
    trackData, cropW, cropH, padding, fallback, multiSpeaker,
  );

  // Step 4: Smooth the crop path (exponential moving average)
  const smoothedCrops = smoothCropPath(rawCrops, smoothing);

  // Step 5: Render with FFmpeg
  console.log(`[reframe] Rendering ${targetAspect} (${cropW}x${cropH})...`);
  await renderReframe(opts.inputPath, opts.outputPath, smoothedCrops, cropW, cropH, outputWidth);

  console.log(`[reframe] Done → ${opts.outputPath}`);
  return {
    outputPath: opts.outputPath,
    sourceWidth: trackData.width,
    sourceHeight: trackData.height,
    cropWidth: cropW,
    cropHeight: cropH,
    facesDetected: trackData.keyframes.filter(k => k.w > 0).length,
    smoothedKeyframes: smoothedCrops.length,
  };
}

// ─── Face Detection ───

/**
 * Run the YuNet face detector on a video.
 */
async function runFaceDetection(inputPath: string, sampleFps: number): Promise<FaceTrackData> {
  const tmpJson = join("/tmp", `faces-${randomUUID()}.json`);
  const scriptPath = join(dirname(import.meta.path), "detect_faces.py");

  const proc = Bun.spawn(
    ["python3", scriptPath, inputPath, tmpJson, String(sampleFps)],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Face detection failed: ${stderr.slice(0, 300)}`);
  }

  if (!existsSync(tmpJson)) {
    throw new Error("Face detection produced no output");
  }

  const data = JSON.parse(readFileSync(tmpJson, "utf-8")) as FaceTrackData;

  // Cleanup
  try { require("fs").unlinkSync(tmpJson); } catch {}

  return data;
}

// ─── Crop Window Computation ───

/**
 * For each keyframe, compute where to place the crop window to center on the face.
 */
function computeCropWindows(
  trackData: FaceTrackData,
  cropW: number,
  cropH: number,
  padding: number,
  fallback: "center" | "rule-of-thirds",
  multiSpeaker: boolean,
): CropWindow[] {
  const { width: srcW, height: srcH, keyframes } = trackData;

  return keyframes.map((kf) => {
    let targetX: number;
    let targetY: number;

    if (kf.w > 0 && kf.h > 0) {
      // Face detected — center crop on face center with padding
      const faceCenterX = kf.x + kf.w / 2;
      const faceCenterY = kf.y + kf.h / 2;

      // Place face in upper third (more natural framing)
      targetX = faceCenterX - cropW / 2;
      targetY = faceCenterY - cropH * 0.35; // face sits at ~35% from top
    } else {
      // No face — use fallback
      if (fallback === "rule-of-thirds") {
        targetX = srcW / 2 - cropW / 2;
        targetY = srcH * 0.15; // slightly above center
      } else {
        targetX = (srcW - cropW) / 2;
        targetY = (srcH - cropH) / 2;
      }
    }

    // Clamp to bounds
    const x = Math.max(0, Math.min(srcW - cropW, Math.round(targetX)));
    const y = Math.max(0, Math.min(srcH - cropH, Math.round(targetY)));

    return { t: kf.t, x, y, w: cropW, h: cropH };
  });
}

// ─── Smoothing ───

/**
 * Smooth crop path using exponential moving average.
 * Prevents jittery pan — the camera moves slowly to follow the subject.
 */
function smoothCropPath(crops: CropWindow[], factor: number): CropWindow[] {
  if (crops.length === 0) return [];

  const smoothed: CropWindow[] = [crops[0]];

  for (let i = 1; i < crops.length; i++) {
    const prev = smoothed[i - 1];
    const curr = crops[i];

    smoothed.push({
      t: curr.t,
      x: Math.round(prev.x * factor + curr.x * (1 - factor)),
      y: Math.round(prev.y * factor + curr.y * (1 - factor)),
      w: curr.w,
      h: curr.h,
    });
  }

  return smoothed;
}

// ─── FFmpeg Rendering ───

/**
 * Render the reframed video using FFmpeg's crop filter with keyframe interpolation.
 * Uses sendcmd to dynamically move the crop window over time.
 */
async function renderReframe(
  inputPath: string,
  outputPath: string,
  crops: CropWindow[],
  cropW: number,
  cropH: number,
  outputWidth: number,
): Promise<void> {
  if (crops.length === 0) {
    throw new Error("No crop keyframes to render");
  }

  // Strategy: use FFmpeg crop filter with expression-based x/y
  // that interpolates between keyframes using if/between expressions.
  // For many keyframes this gets long, so we use a simpler approach:
  // Build a sendcmd script that updates crop position at each keyframe time.

  const tmpDir = join("/tmp", `reframe-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  // Build sendcmd script for dynamic crop
  const cmdLines = crops.map((c) => {
    return `${c.t.toFixed(3)} [enter] crop x ${c.x};`;
  });

  // For short videos or when sendcmd is overkill, use a single average crop
  // For longer videos, we'll use the expression-based approach
  if (crops.length <= 3) {
    // Simple static crop at average position
    const avgX = Math.round(crops.reduce((s, c) => s + c.x, 0) / crops.length);
    const avgY = Math.round(crops.reduce((s, c) => s + c.y, 0) / crops.length);

    const outputHeight = Math.round(outputWidth / (cropW / cropH));

    const proc = Bun.spawn(
      [
        "ffmpeg", "-y",
        "-i", inputPath,
        "-vf", `crop=${cropW}:${cropH}:${avgX}:${avgY},scale=${outputWidth}:${outputHeight}`,
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        outputPath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const stderr = await new Response(proc.stderr).text();
    if (await proc.exited !== 0) {
      throw new Error(`FFmpeg reframe failed: ${stderr.slice(0, 300)}`);
    }
    return;
  }

  // For dynamic crop: build an expression that interpolates x,y over time
  const xExpr = buildInterpolationExpr(crops, "x");
  const yExpr = buildInterpolationExpr(crops, "y");
  const outputHeight = Math.round(outputWidth / (cropW / cropH));

  const vf = `crop=${cropW}:${cropH}:'${xExpr}':'${yExpr}',scale=${outputWidth}:${outputHeight}`;

  const proc = Bun.spawn(
    [
      "ffmpeg", "-y",
      "-i", inputPath,
      "-vf", vf,
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-c:a", "aac", "-b:a", "192k",
      outputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // Cleanup
  try { require("fs").rmSync(tmpDir, { recursive: true }); } catch {}

  if (exitCode !== 0) {
    throw new Error(`FFmpeg reframe failed: ${stderr.slice(0, 300)}`);
  }
}

/**
 * Build FFmpeg expression for interpolating crop position over time.
 * Uses nested if(between(t,...)) expressions.
 * Limits to ~50 keyframes to keep expression manageable.
 */
function buildInterpolationExpr(
  crops: CropWindow[],
  axis: "x" | "y",
): string {
  // Downsample to max 50 keyframes
  let sampled = crops;
  if (crops.length > 50) {
    const step = Math.ceil(crops.length / 50);
    sampled = crops.filter((_, i) => i % step === 0);
    if (sampled[sampled.length - 1] !== crops[crops.length - 1]) {
      sampled.push(crops[crops.length - 1]);
    }
  }

  if (sampled.length === 1) {
    return String(sampled[0][axis]);
  }

  // Build linear interpolation between consecutive keyframes:
  // if(between(t,t0,t1), lerp(x0,x1,(t-t0)/(t1-t0)), ...)
  const parts: string[] = [];
  for (let i = 0; i < sampled.length - 1; i++) {
    const a = sampled[i];
    const b = sampled[i + 1];
    const va = a[axis];
    const vb = b[axis];
    const t0 = a.t.toFixed(3);
    const t1 = b.t.toFixed(3);

    if (va === vb) {
      parts.push(`if(between(t\\,${t0}\\,${t1})\\,${va}`);
    } else {
      // Linear interp: va + (vb-va) * (t-t0)/(t1-t0)
      const range = (b.t - a.t).toFixed(3);
      parts.push(
        `if(between(t\\,${t0}\\,${t1})\\,${va}+(${vb - va})*(t-${t0})/${range}`,
      );
    }
  }

  // Close all if() — last fallback is final value
  const lastVal = sampled[sampled.length - 1][axis];
  const expr = parts.join("\\,") + "\\," + String(lastVal) + ")".repeat(parts.length);

  return expr;
}