// Split-Screen Gameplay Overlay
// Composite talking-head or story content over looping gameplay footage
// Classic faceless content format: main content + gameplay background
// Inspired by Subway Surfers / Minecraft parkour aesthetic

import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// ─── Types ───

export type LayoutMode = 
  | "vertical-split"      // top/bottom (most common)
  | "horizontal-split"    // left/right
  | "pip"                 // picture-in-picture (main floats over gameplay)
  | "side-by-side";       // 50/50 split horizontally

export interface SplitScreenOptions {
  mainVideo: string;        // path to primary content (talking head, story)
  backgroundVideo: string;  // path to gameplay footage
  outputPath: string;       // where to save composite
  layout?: LayoutMode;      // default: vertical-split
  mainRatio?: number;       // 0-1, how much space main takes (default: 0.5)
  backgroundLoop?: boolean; // loop background if shorter (default: true)
  outputWidth?: number;     // final width (default: 1080)
  outputHeight?: number;    // final height (default: 1920, 9:16)
  blur?: boolean;           // blur the background slightly (default: false)
  border?: number;          // border width between sections (default: 0)
  fps?: number;             // output fps (default: 30)
}

export interface SplitScreenResult {
  outputPath: string;
  layout: LayoutMode;
  duration: number; // final video duration in seconds
  mainDuration: number;
  backgroundDuration: number;
}

// ─── Main Function ───

/**
 * Create a split-screen composite with gameplay background.
 * Most common: vertical split with main content on top, gameplay looping below.
 */
export async function createSplitScreen(
  opts: SplitScreenOptions,
): Promise<SplitScreenResult> {
  const layout = opts.layout ?? "vertical-split";
  const mainRatio = opts.mainRatio ?? 0.5;
  const backgroundLoop = opts.backgroundLoop ?? true;
  const outputWidth = opts.outputWidth ?? 1080;
  const outputHeight = opts.outputHeight ?? 1920;
  const fps = opts.fps ?? 30;
  const blur = opts.blur ?? false;
  const border = opts.border ?? 0;

  if (!existsSync(opts.mainVideo)) {
    throw new Error(`Main video not found: ${opts.mainVideo}`);
  }
  if (!existsSync(opts.backgroundVideo)) {
    throw new Error(`Background video not found: ${opts.backgroundVideo}`);
  }

  mkdirSync(dirname(opts.outputPath), { recursive: true });

  console.log(`[split-screen] Creating ${layout} composite...`);

  // Get durations
  const mainDur = await getVideoDuration(opts.mainVideo);
  const bgDur = await getVideoDuration(opts.backgroundVideo);

  let filterComplex: string;
  switch (layout) {
    case "vertical-split":
      filterComplex = buildVerticalSplit(
        outputWidth, outputHeight, mainRatio, blur, border, mainDur, bgDur, backgroundLoop,
      );
      break;
    case "horizontal-split":
      filterComplex = buildHorizontalSplit(
        outputWidth, outputHeight, mainRatio, blur, border, mainDur, bgDur, backgroundLoop,
      );
      break;
    case "pip":
      filterComplex = buildPictureInPicture(
        outputWidth, outputHeight, mainRatio, blur, mainDur, bgDur, backgroundLoop,
      );
      break;
    case "side-by-side":
      filterComplex = buildSideBySide(
        outputWidth, outputHeight, blur, border, mainDur, bgDur, backgroundLoop,
      );
      break;
  }

  // Run FFmpeg
  const args = [
    "-y",
    "-i", opts.mainVideo,
    "-i", opts.backgroundVideo,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", String(mainDur), // clip to main video duration
    opts.outputPath,
  ];

  await runFFmpeg(args);

  console.log(`[split-screen] Done → ${opts.outputPath}`);
  return {
    outputPath: opts.outputPath,
    layout,
    duration: mainDur,
    mainDuration: mainDur,
    backgroundDuration: bgDur,
  };
}

// ─── Filter Builders ───

/**
 * Vertical split: main on top, gameplay on bottom
 * Classic faceless content layout
 */
function buildVerticalSplit(
  w: number, h: number, mainRatio: number, blur: boolean, border: number,
  mainDur: number, bgDur: number, loop: boolean,
): string {
  const mainH = Math.round(h * mainRatio);
  const bgH = h - mainH - border;

  let filters = [];

  // Main video: scale to fit top section
  filters.push(`[0:v]scale=${w}:${mainH}:force_original_aspect_ratio=decrease,pad=${w}:${mainH}:(ow-iw)/2:(oh-ih)/2[main]`);

  // Background: loop if needed, scale to bottom section
  let bgInput = "[1:v]";
  if (loop && bgDur < mainDur) {
    filters.push(`[1:v]loop=loop=-1:size=1:start=0[bgloop]`);
    bgInput = "[bgloop]";
  }
  
  const blurFilter = blur ? ",gblur=sigma=3" : "";
  filters.push(`${bgInput}scale=${w}:${bgH}:force_original_aspect_ratio=decrease,pad=${w}:${bgH}:(ow-iw)/2:(oh-ih)/2${blurFilter}[bg]`);

  // Stack vertically
  if (border > 0) {
    filters.push(`[main][bg]vstack=inputs=2,pad=${w}:${h}:0:0:black[out]`);
  } else {
    filters.push(`[main][bg]vstack=inputs=2[out]`);
  }

  return filters.join(";");
}

/**
 * Horizontal split: main on left, gameplay on right
 */
function buildHorizontalSplit(
  w: number, h: number, mainRatio: number, blur: boolean, border: number,
  mainDur: number, bgDur: number, loop: boolean,
): string {
  const mainW = Math.round(w * mainRatio);
  const bgW = w - mainW - border;

  let filters = [];

  filters.push(`[0:v]scale=${mainW}:${h}:force_original_aspect_ratio=decrease,pad=${mainW}:${h}:(ow-iw)/2:(oh-ih)/2[main]`);

  let bgInput = "[1:v]";
  if (loop && bgDur < mainDur) {
    filters.push(`[1:v]loop=loop=-1:size=1:start=0[bgloop]`);
    bgInput = "[bgloop]";
  }

  const blurFilter = blur ? ",gblur=sigma=3" : "";
  filters.push(`${bgInput}scale=${bgW}:${h}:force_original_aspect_ratio=decrease,pad=${bgW}:${h}:(ow-iw)/2:(oh-ih)/2${blurFilter}[bg]`);

  filters.push(`[main][bg]hstack=inputs=2[out]`);

  return filters.join(";");
}

/**
 * Picture-in-picture: main floats over full-screen gameplay
 */
function buildPictureInPicture(
  w: number, h: number, mainRatio: number, blur: boolean,
  mainDur: number, bgDur: number, loop: boolean,
): string {
  const mainW = Math.round(w * mainRatio);
  const mainH = Math.round(h * mainRatio);

  let filters = [];

  // Background fills entire frame
  let bgInput = "[1:v]";
  if (loop && bgDur < mainDur) {
    filters.push(`[1:v]loop=loop=-1:size=1:start=0[bgloop]`);
    bgInput = "[bgloop]";
  }

  const blurFilter = blur ? ",gblur=sigma=5" : "";
  filters.push(`${bgInput}scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2${blurFilter}[bg]`);

  // Main scaled down
  filters.push(`[0:v]scale=${mainW}:${mainH}:force_original_aspect_ratio=decrease[main]`);

  // Overlay main on top (centered)
  filters.push(`[bg][main]overlay=(W-w)/2:(H-h)/2[out]`);

  return filters.join(";");
}

/**
 * Side-by-side: 50/50 split (main left, gameplay right)
 */
function buildSideBySide(
  w: number, h: number, blur: boolean, border: number,
  mainDur: number, bgDur: number, loop: boolean,
): string {
  const halfW = Math.round(w / 2) - border;

  let filters = [];

  filters.push(`[0:v]scale=${halfW}:${h}:force_original_aspect_ratio=decrease,pad=${halfW}:${h}:(ow-iw)/2:(oh-ih)/2[main]`);

  let bgInput = "[1:v]";
  if (loop && bgDur < mainDur) {
    filters.push(`[1:v]loop=loop=-1:size=1:start=0[bgloop]`);
    bgInput = "[bgloop]";
  }

  const blurFilter = blur ? ",gblur=sigma=3" : "";
  filters.push(`${bgInput}scale=${halfW}:${h}:force_original_aspect_ratio=decrease,pad=${halfW}:${h}:(ow-iw)/2:(oh-ih)/2${blurFilter}[bg]`);

  filters.push(`[main][bg]hstack=inputs=2[out]`);

  return filters.join(";");
}

// ─── Utilities ───

async function getVideoDuration(videoPath: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return parseFloat(stdout.trim()) || 0;
}

async function runFFmpeg(args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", ...args], { stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  if (await proc.exited !== 0) {
    throw new Error(`FFmpeg failed: ${stderr.slice(0, 300)}`);
  }
}