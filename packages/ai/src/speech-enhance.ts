// Speech Enhancement / Noise Suppression
// Inspired by Rikorose/DeepFilterNet (MIT, ⭐4.6k)
// Cleans up noisy audio: removes background noise, hum, room reverb
// Uses DeepFilterNet (best quality) when installed, falls back to FFmpeg filters

import { existsSync, mkdirSync, readdirSync } from "fs";
import { join, basename, dirname, extname } from "path";
import { randomUUID } from "crypto";

// ─── Types ───

export interface SpeechEnhanceOptions {
  inputPath: string; // video or audio file
  outputPath: string;
  method?: "auto" | "deepfilter" | "ffmpeg"; // default: auto (tries deepfilter first)
  model?: "DeepFilterNet" | "DeepFilterNet2" | "DeepFilterNet3"; // default: DeepFilterNet3
  postFilter?: boolean; // over-attenuate very noisy sections (default: true)
  // FFmpeg fallback options
  noiseReduction?: number; // FFmpeg anlmdn strength 0-1 (default: 0.5)
  highpass?: number; // Hz, cuts low rumble (default: 80)
  lowpass?: number; // Hz, cuts hiss (default: 14000)
  deesser?: boolean; // reduce sibilance (default: false)
}

export interface SpeechEnhanceResult {
  outputPath: string;
  method: "deepfilter" | "ffmpeg";
  model?: string;
  inputDurationMs: number;
  processingTimeMs: number;
}

// ─── Main Function ───

/**
 * Enhance speech audio by removing noise.
 * Tries DeepFilterNet first (AI-based, best quality), falls back to FFmpeg filters.
 */
export async function enhanceSpeech(
  opts: SpeechEnhanceOptions,
): Promise<SpeechEnhanceResult> {
  const method = opts.method ?? "auto";
  const startTime = Date.now();

  if (!existsSync(opts.inputPath)) {
    throw new Error(`File not found: ${opts.inputPath}`);
  }

  mkdirSync(dirname(opts.outputPath), { recursive: true });

  // Get duration for reporting
  const durationMs = await getMediaDuration(opts.inputPath);

  if (method === "deepfilter" || method === "auto") {
    const available = await isDeepFilterAvailable();
    if (available) {
      console.log("[speech-enhance] Using DeepFilterNet (AI noise suppression)...");
      await runDeepFilter(opts);
      return {
        outputPath: opts.outputPath,
        method: "deepfilter",
        model: opts.model ?? "DeepFilterNet3",
        inputDurationMs: durationMs,
        processingTimeMs: Date.now() - startTime,
      };
    } else if (method === "deepfilter") {
      throw new Error(
        "DeepFilterNet not installed. Install with: pip install deepfilternet torch torchaudio",
      );
    }
    // Fall through to ffmpeg
  }

  console.log("[speech-enhance] Using FFmpeg noise reduction filters...");
  await runFFmpegEnhance(opts);
  return {
    outputPath: opts.outputPath,
    method: "ffmpeg",
    inputDurationMs: durationMs,
    processingTimeMs: Date.now() - startTime,
  };
}

// ─── DeepFilterNet ───

/**
 * Check if DeepFilterNet CLI is available.
 */
export async function isDeepFilterAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["deepFilter", "--help"], {
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
 * Run DeepFilterNet on audio.
 * Handles video input by extracting audio first, then muxing back.
 */
async function runDeepFilter(opts: SpeechEnhanceOptions): Promise<void> {
  const model = opts.model ?? "DeepFilterNet3";
  const postFilter = opts.postFilter ?? true;
  const isVideo = isVideoFile(opts.inputPath);

  const tmpDir = join("/tmp", `deepfilter-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });

  let audioInput = opts.inputPath;

  // If video, extract audio first
  if (isVideo) {
    audioInput = join(tmpDir, "audio.wav");
    await runCmd([
      "ffmpeg", "-y", "-i", opts.inputPath,
      "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "1",
      audioInput,
    ]);
  }

  // Run DeepFilterNet
  const dfArgs = ["deepFilter", "--model", model, "--output-dir", tmpDir];
  if (postFilter) dfArgs.push("--pf");
  dfArgs.push(audioInput);

  const proc = Bun.spawn(dfArgs, { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  if (await proc.exited !== 0) {
    throw new Error(`DeepFilterNet failed: ${stderr.slice(0, 300)}`);
  }

  // Find the enhanced output file
  const enhancedFiles = readdirSync(tmpDir).filter(
    (f) => f.includes("enhanced") || f.includes("_DeepFilter"),
  );
  const enhancedPath = enhancedFiles.length > 0
    ? join(tmpDir, enhancedFiles[0])
    : join(tmpDir, basename(audioInput)); // sometimes same name

  if (!existsSync(enhancedPath)) {
    throw new Error("DeepFilterNet produced no output file");
  }

  if (isVideo) {
    // Mux enhanced audio back with original video
    await runCmd([
      "ffmpeg", "-y",
      "-i", opts.inputPath,
      "-i", enhancedPath,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-shortest",
      opts.outputPath,
    ]);
  } else {
    // Just copy/convert enhanced audio to output
    await runCmd([
      "ffmpeg", "-y", "-i", enhancedPath,
      "-c:a", "aac", "-b:a", "192k",
      opts.outputPath,
    ]);
  }

  // Cleanup
  try { require("fs").rmSync(tmpDir, { recursive: true }); } catch {}
}

// ─── FFmpeg Fallback ───

/**
 * Enhance speech using FFmpeg's built-in audio filters.
 * Not as good as DeepFilterNet, but requires no extra installs.
 * Chain: highpass → lowpass → noise reduction (anlmdn) → normalization
 */
async function runFFmpegEnhance(opts: SpeechEnhanceOptions): Promise<void> {
  const noiseReduction = opts.noiseReduction ?? 0.5;
  const highpass = opts.highpass ?? 80;
  const lowpass = opts.lowpass ?? 14000;
  const deesser = opts.deesser ?? false;
  const isVideo = isVideoFile(opts.inputPath);

  // Build filter chain
  const filters: string[] = [];

  // 1. High-pass: removes low rumble, HVAC hum, handling noise
  filters.push(`highpass=f=${highpass}`);

  // 2. Low-pass: removes high-frequency hiss
  filters.push(`lowpass=f=${lowpass}`);

  // 3. Noise reduction (adaptive non-local means denoising)
  // anlmdn: s=strength(0-1), p=patch_size, r=research_size
  const strength = Math.round(noiseReduction * 10000);
  filters.push(`anlmdn=s=${strength}:p=0.002:r=0.015:m=15`);

  // 4. Optional de-esser (reduces harsh S sounds)
  if (deesser) {
    filters.push("adeclick");
    filters.push("bandreject=f=7500:w=2000");
  }

  // 5. Normalize volume (loudnorm to -16 LUFS for speech)
  filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");

  const af = filters.join(",");

  if (isVideo) {
    await runCmd([
      "ffmpeg", "-y", "-i", opts.inputPath,
      "-af", af,
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "192k",
      opts.outputPath,
    ]);
  } else {
    await runCmd([
      "ffmpeg", "-y", "-i", opts.inputPath,
      "-af", af,
      "-c:a", "aac", "-b:a", "192k",
      opts.outputPath,
    ]);
  }
}

// ─── Utilities ───

function isVideoFile(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"].includes(ext);
}

async function getMediaDuration(inputPath: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inputPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return (parseFloat(stdout.trim()) || 0) * 1000;
}

async function runCmd(args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  if (await proc.exited !== 0) {
    throw new Error(`Command failed (${args[0]}): ${stderr.slice(0, 300)}`);
  }
}