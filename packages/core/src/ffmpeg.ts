import { spawn } from "child_process";
import { join } from "path";

let ffmpegPath = "";

try {
  ffmpegPath = process.env.FFMPEG_PATH || Bun.which("ffmpeg") || require("ffmpeg-static");
} catch {
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
}

export interface ClipOpts {
  input: string;
  start?: number;
  end?: number;
  output: string;
}

export async function overlayWatermark(input: string, output: string, branding: {
  logoPath: string;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  opacity: number;
}): Promise<string> {
  const positions = {
    "top-left": "20:20", "top-right": "main_w-overlay_w-20:20",
    "bottom-left": "20:main_h-overlay_h-20", "bottom-right": "main_w-overlay_w-20:main_h-overlay_h-20",
  };
  if (!positions[branding.position] || !Number.isFinite(branding.opacity) || branding.opacity < 0 || branding.opacity > 1) {
    throw new Error("Invalid watermark position or opacity (expected 0–1).");
  }
  await run(["-i", input, "-loop", "1", "-i", branding.logoPath,
    "-filter_complex", `[1:v]scale=160:160:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${branding.opacity}[logo];[0:v][logo]overlay=${positions[branding.position]}:shortest=1[v]`,
    "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", output]);
  return output;
}

export interface TextOverlay {
  text: string;
  startMs: number;
  endMs: number;
  style?: CaptionStyle;
}

export interface CaptionStyle {
  fontSize?: number;
  fontColor?: string;
  bgColor?: string;
  position?: "top" | "center" | "bottom";
  fontFamily?: string;
  outline?: boolean;
  outlineColor?: string;
  animation?: "pop" | "fade" | "none";
}

const DEFAULT_STYLE: CaptionStyle = {
  fontSize: 48,
  fontColor: "white",
  position: "bottom",
  fontFamily: "Arial",
  outline: true,
  outlineColor: "black",
};

export type AspectRatio = "9:16" | "1:1" | "16:9";

export type TransitionType = "none" | "crossfade" | "zoom_cut";

export interface AspectDef {
  width: number;
  height: number;
  label: string;
  platforms: string;
}

export const ASPECTS: Record<AspectRatio, AspectDef> = {
  "9:16": {
    width: 1080,
    height: 1920,
    label: "Vertical (TikTok, Shorts, Reels)",
    platforms: "TikTok, YouTube Shorts, Instagram Reels",
  },
  "1:1": {
    width: 1080,
    height: 1080,
    label: "Square (Instagram Feed)",
    platforms: "Instagram Feed, Facebook",
  },
  "16:9": {
    width: 1920,
    height: 1080,
    label: "Landscape (YouTube)",
    platforms: "YouTube, Twitter/X",
  },
};

export type QualityPreset = "draft" | "standard" | "high" | "ultra";

export interface QualityDef {
  label: string;
  crf: number;
  preset: string;
  maxScale: number;
}

export const QUALITY: Record<QualityPreset, QualityDef> = {
  draft: {
    label: "Draft (720p, fast)",
    crf: 28,
    preset: "ultrafast",
    maxScale: 720,
  },
  standard: {
    label: "Standard (1080p)",
    crf: 23,
    preset: "fast",
    maxScale: 1080,
  },
  high: {
    label: "High (1080p, quality)",
    crf: 18,
    preset: "slow",
    maxScale: 1080,
  },
  ultra: {
    label: "Ultra (4K)",
    crf: 18,
    preset: "slow",
    maxScale: 2160,
  },
};

function spawnFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-y", ...args], { stdio: "pipe" });
    const timer = setTimeout(() => proc.kill("SIGKILL"), 60 * 60 * 1000);
    timer.unref();
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", error => { clearTimeout(timer); reject(error); });
  });
}

export async function run(args: string[]): Promise<void> {
  return spawnFfmpeg(args);
}

export async function getDuration(input: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-i", input], { stdio: "pipe" });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (m)
        resolve(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]));
      else resolve(0);
    });
    proc.on("error", () => resolve(0));
  });
}

export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, " ")
    .replace(/\r/g, "");
}

export async function trim(opts: ClipOpts): Promise<string> {
  const args: string[] = [];
  if (opts.start !== undefined) args.push("-ss", String(opts.start));
  args.push("-i", opts.input);
  if (opts.end !== undefined) args.push("-to", String(opts.end));
  args.push("-c", "copy", opts.output);
  await run(args);
  return opts.output;
}

export async function concat(
  inputs: string[],
  output: string,
): Promise<string> {
  const listPath = output + ".txt";
  const { writeFileSync, unlinkSync } = await import("fs");
  const content = inputs
    .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
    .join("\n");
  writeFileSync(listPath, content);
  await run([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    output,
  ]);
  unlinkSync(listPath);
  return output;
}

export async function concatTransitions(
  inputs: string[],
  output: string,
  opts?: {
    transition?: TransitionType;
    transitionDuration?: number;
    quality?: QualityPreset;
  },
): Promise<string> {
  const transition = opts?.transition ?? "none";
  const tDur = opts?.transitionDuration ?? 0.5;
  const q = QUALITY[opts?.quality ?? "standard"];

  if (inputs.length === 0) throw new Error("No inputs");
  if (inputs.length === 1 || transition === "none") {
    await concat(inputs, output);
    return output;
  }

  const { getDuration: dur } = await import("./ffmpeg");
  const durations: number[] = [];
  for (const f of inputs) {
    durations.push(await dur(f));
  }

  const isCrossfade = transition === "crossfade";
  const xfadeType = isCrossfade ? "fade" : "fadeblack";

  // Build video filter chain
  const vFilters: string[] = [];
  let prevLabel = "[0:v]";

  for (let i = 1; i < inputs.length; i++) {
    const offset =
      durations.slice(0, i + 1).reduce((a, b) => a + b, 0) - (i + 1) * tDur;
    const nextIn = `[${i}:v]`;
    const outLabel = i < inputs.length - 1 ? `[xv${i}]` : "[vout]";

    if (i === 1) {
      vFilters.push(
        `${prevLabel}${nextIn}xfade=transition=${xfadeType}:duration=${tDur}:offset=${offset.toFixed(3)}${outLabel}`,
      );
    } else {
      vFilters.push(
        `${prevLabel}${nextIn}xfade=transition=${xfadeType}:duration=${tDur}:offset=${offset.toFixed(3)}${outLabel}`,
      );
    }
    prevLabel = outLabel;
  }

  // Build args: N video inputs + silent audio output
  const args: string[] = [];
  for (const f of inputs) {
    args.push("-i", f);
  }
  args.push(
    "-filter_complex",
    vFilters.join(";"),
    "-map",
    "[vout]",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-map",
    `${inputs.length}:a`,
    "-t",
    String(durations.reduce((a, b) => a + b, 0) - (inputs.length - 1) * tDur),
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    String(q.crf),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    output,
  );
  await run(args);
  return output;
}

export async function toVertical(
  input: string,
  output: string,
): Promise<string> {
  return toAspect(input, output, "9:16");
}

export async function centerCrop(input: string, output: string, ratio: AspectRatio, quality: QualityPreset = "standard") {
  const { width, height } = ASPECTS[ratio];
  const q = QUALITY[quality];
  await run(["-i", input, "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-c:v", "libx264", "-preset", q.preset, "-crf", String(q.crf), "-c:a", "aac", output]);
  return output;
}

export async function toAspect(
  input: string,
  output: string,
  ratio: AspectRatio = "9:16",
  quality: QualityPreset = "standard",
): Promise<string> {
  const { width, height } = ASPECTS[ratio];
  const q = QUALITY[quality];
  await run([
    "-i",
    input,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    String(q.crf),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    output,
  ]);
  return output;
}

export async function overlayText(
  input: string,
  texts: TextOverlay[],
  output: string,
  quality: QualityPreset = "standard",
): Promise<string> {
  const q = QUALITY[quality];
  const filters: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const s = { ...DEFAULT_STYLE, ...t.style };
    const y =
      s.position === "top"
        ? "50"
        : s.position === "center"
          ? "(h-text_h)/2"
          : "h-text_h-50";
    const escaped = escapeDrawtext(t.text);
    let fontOpts = `fontsize=${s.fontSize}:fontcolor=${s.fontColor}:font=${s.fontFamily}:y=${y}:x=(w-text_w)/2`;
    if (s.outline) {
      fontOpts += `:borderw=3:bordercolor=${s.outlineColor}`;
    }
    filters.push(
      `drawtext=expansion=none:text='${escaped}':${fontOpts}:enable='between(t,${(t.startMs / 1000).toFixed(2)},${(t.endMs / 1000).toFixed(2)})'`,
    );
  }
  await run([
    "-i",
    input,
    "-vf",
    filters.join(","),
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    String(q.crf),
    "-c:a",
    "copy",
    output,
  ]);
  return output;
}

export async function composeSplitScreen(
  main: string,
  bg: string,
  output: string,
  opts?: {
    bgPosition?: "left" | "right" | "top" | "bottom";
    quality?: QualityPreset;
  },
): Promise<string> {
  const q = QUALITY[opts?.quality ?? "standard"];
  const pos = opts?.bgPosition ?? "left";
  let filter: string;
  if (pos === "left" || pos === "right") {
    filter =
      `[0:v]scale=540:1920:force_original_aspect_ratio=decrease,pad=540:1920:(ow-iw)/2:(oh-ih)/2:black[v0];` +
      `[1:v]scale=540:1920:force_original_aspect_ratio=decrease,pad=540:1920:(ow-iw)/2:(oh-ih)/2:black[v1];` +
      (pos === "left"
        ? `[v1][v0]hstack=inputs=2[out]`
        : `[v0][v1]hstack=inputs=2[out]`);
  } else {
    filter =
      `[0:v]scale=1080:960:force_original_aspect_ratio=decrease,pad=1080:960:(ow-iw)/2:(oh-ih)/2:black[v0];` +
      `[1:v]scale=1080:960:force_original_aspect_ratio=decrease,pad=1080:960:(ow-iw)/2:(oh-ih)/2:black[v1];` +
      (pos === "top"
        ? `[v1][v0]vstack=inputs=2[out]`
        : `[v0][v1]vstack=inputs=2[out]`);
  }
  await run([
    "-i",
    main,
    "-i",
    bg,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    String(q.crf),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    output,
  ]);
  return output;
}

export async function screenshot(
  video: string,
  timestamp: number,
  output: string,
): Promise<string> {
  await run(["-i", video, "-ss", String(timestamp), "-frames:v", "1", output]);
  return output;
}

export async function addAudio(
  video: string,
  audio: string,
  output: string,
  opts?: { volume?: number },
): Promise<string> {
  const vol = opts?.volume ?? 1.0;
  await run([
    "-i",
    video,
    "-i",
    audio,
    "-filter_complex",
    `[1:a]volume=${vol}[a]`,
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    output,
  ]);
  return output;
}

export interface AudioTrack {
  path: string;
  volume: number;
  loop?: boolean;
  delay?: number;
}

export interface SFXEntry {
  path: string;
  timeMs: number;
  volume: number;
}

export interface MixAudioOpts {
  tracks: AudioTrack[];
  sfx?: SFXEntry[];
  duration: number;
  output: string;
}

export async function mixAudio(opts: MixAudioOpts): Promise<string> {
  const { tracks, sfx, duration, output } = opts;

  if (tracks.length === 0 && (!sfx || sfx.length === 0)) {
    // Generate silent audio
    await run([
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=44100:cl=stereo`,
      "-t",
      String(duration),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      output,
    ]);
    return output;
  }

  const inputs: string[] = [];
  const filterParts: string[] = [];
  let idx = 0;

  // Process main audio tracks (voiceover, bg music)
  for (const track of tracks) {
    inputs.push("-i", track.path);
    let chain = `[${idx}:a]volume=${track.volume}`;
    if (track.loop) {
      chain += `,aloop=loop=-1:size=2e+09,atrim=0:${duration}`;
    }
    if (track.delay && track.delay > 0) {
      chain += `,adelay=${track.delay}|${track.delay}`;
    }
    chain += `[a${idx}]`;
    filterParts.push(chain);
    idx++;
  }

  // Process SFX entries
  if (sfx) {
    for (const fx of sfx) {
      inputs.push("-i", fx.path);
      const delayMs = fx.timeMs;
      filterParts.push(
        `[${idx}:a]volume=${fx.volume},adelay=${delayMs}|${delayMs}[a${idx}]`,
      );
      idx++;
    }
  }

  // Mix all streams together
  const mixInputs = Array.from({ length: idx }, (_, i) => `[a${i}]`).join("");
  filterParts.push(
    `${mixInputs}amix=inputs=${idx}:duration=first:dropout_transition=0[mixed]`,
  );

  await run([
    ...inputs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[mixed]",
    "-t",
    String(duration),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    output,
  ]);
  return output;
}

export async function imageToVideo(
  image: string,
  duration: number,
  output: string,
  ratio: AspectRatio = "9:16",
  quality: QualityPreset = "standard",
): Promise<string> {
  const { width, height } = ASPECTS[ratio];
  const q = QUALITY[quality];
  await run([
    "-loop",
    "1",
    "-i",
    image,
    "-t",
    String(duration),
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    String(q.crf),
    "-pix_fmt",
    "yuv420p",
    output,
  ]);
  return output;
}

export async function renderASS(
  input: string,
  assPath: string,
  output: string,
  quality: QualityPreset = "standard",
): Promise<string> {
  const q = QUALITY[quality];
  await run([
    "-i",
    input,
    "-vf",
    `ass='${assPath.replace(/'/g, "'\\''")}'`,
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    String(q.crf),
    "-c:a",
    "copy",
    output,
  ]);
  return output;
}

export interface SmartZoomOpts {
  faceDataPath: string;
  output: string;
  zoomLevel?: number;
  quality?: QualityPreset;
}

export async function smartZoom(
  input: string,
  opts: SmartZoomOpts,
): Promise<string> {
  const { readFileSync } = await import("fs");
  const faceData = JSON.parse(readFileSync(opts.faceDataPath, "utf-8"));
  const zoom = opts.zoomLevel ?? 0.5;
  const q = QUALITY[opts.quality ?? "standard"];

  const { width: srcW, height: srcH, keyframes } = faceData;
  if (!keyframes || keyframes.length < 2) {
    // Not enough data — just copy
    await run(["-i", input, "-c", "copy", opts.output]);
    return opts.output;
  }

  // Compute zoom crop dimensions (50-70% of frame centered on face)
  const cropW = Math.round(srcW * (1 - zoom * 0.4));
  const cropH = Math.round(srcH * (1 - zoom * 0.4));

  // Compute crop center for each keyframe, clamped to frame bounds
  const rawPoints = keyframes.map((kf: any) => {
    const faceCx = kf.x + kf.w / 2;
    const faceCy = kf.y + kf.h / 2;
    return {
      t: kf.t,
      cx: Math.max(cropW / 2, Math.min(srcW - cropW / 2, faceCx)),
      cy: Math.max(cropH / 2, Math.min(srcH - cropH / 2, faceCy)),
    };
  });

  // Deduplicate consecutive identical keyframes
  const points = rawPoints.filter(
    (p: (typeof rawPoints)[number], i: number) =>
      i === 0 ||
      Math.abs(p.cx - rawPoints[i - 1].cx) > 0.5 ||
      Math.abs(p.cy - rawPoints[i - 1].cy) > 0.5,
  );
  // Ensure last keyframe is included
  if (
    points.length > 1 &&
    points[points.length - 1] !== rawPoints[rawPoints.length - 1]
  ) {
    points.push(rawPoints[rawPoints.length - 1]);
  }

  if (points.length < 2) {
    await run(["-i", input, "-c", "copy", opts.output]);
    return opts.output;
  }

  // Build per-axis crop expressions with nested if() and linear interpolation
  const buildExpr = (dim: "cx" | "cy", cropDim: number, srcDim: number) => {
    const segs: { t0: number; t1: number; expr: string }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const t0 = points[i].t;
      const t1 = points[i + 1].t;
      const v0 = points[i][dim] - cropDim / 2;
      const v1 = points[i + 1][dim] - cropDim / 2;
      const dt = t1 - t0;
      if (dt <= 0) continue;
      const val = `clip(${v0.toFixed(1)}+(${(v1 - v0).toFixed(1)})*(t-${t0.toFixed(3)})/${dt.toFixed(3)},0,${(srcDim - cropDim).toFixed(1)})`;
      segs.push({ t0, t1, expr: val });
    }
    // Build nested if() from innermost to outermost
    let expr = segs[segs.length - 1]?.expr ?? "0";
    for (let i = segs.length - 2; i >= 0; i--) {
      expr = `if(between(t,${segs[i].t0.toFixed(3)},${segs[i].t1.toFixed(3)}),${segs[i].expr},${expr})`;
    }
    return expr;
  };

  const xExpr = buildExpr("cx", cropW, srcW);
  const yExpr = buildExpr("cy", cropH, srcH);
  const filter = `[0:v]crop=${cropW}:${cropH}:'${xExpr}':'${yExpr}',format=yuv420p[v]`;

  await run([
    "-i",
    input,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    String(q.crf),
    "-c:a",
    "copy",
    opts.output,
  ]);
  return opts.output;
}

export { ffmpegPath };
