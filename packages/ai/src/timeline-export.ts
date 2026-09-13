// EDL/OTIO Export for Professional NLEs
// Inspired by mfahsold/montage-ai (⭐39) and WyattBlue/auto-editor
// Exports timeline to CMX 3600 EDL (Premiere, Resolve, Avid)
// and FCPXML (Final Cut Pro)
// Allows editors to fine-tune auto-generated edits in their preferred NLE

import { writeFileSync } from "fs";
import { basename, dirname } from "path";

// ─── Types ───

export type ExportFormat = "edl" | "fcpxml" | "resolve" | "premiere";

export interface TimelineClip {
  sourcePath: string; // path to source media file
  sourceIn: number; // source start time in seconds
  sourceOut: number; // source end time in seconds
  recordIn: number; // timeline start time in seconds
  recordOut: number; // timeline end time in seconds
  reel?: string; // reel name (default: derived from filename)
  transition?: "cut" | "dissolve"; // transition type into this clip
  transitionDuration?: number; // transition duration in seconds
}

export interface TimelineExportOptions {
  clips: TimelineClip[];
  title?: string; // sequence/project title
  fps?: number; // frame rate (default: 30)
  outputPath: string; // where to save the EDL/XML file
  format?: ExportFormat; // default: edl
  dropFrame?: boolean; // drop frame timecode (default: false)
  width?: number; // video width (for FCPXML, default: 1080)
  height?: number; // video height (for FCPXML, default: 1920)
}

export interface TimelineExportResult {
  outputPath: string;
  format: ExportFormat;
  clipCount: number;
  duration: number; // total timeline duration in seconds
}

// ─── Main Export Function ───

/**
 * Export a clip timeline to a professional NLE format.
 */
export function exportTimeline(opts: TimelineExportOptions): TimelineExportResult {
  const format = opts.format ?? "edl";
  const fps = opts.fps ?? 30;
  const title = opts.title ?? "Crayola Auto-Edit";

  console.log(`[export] Writing ${format.toUpperCase()} with ${opts.clips.length} clips...`);

  let content: string;
  switch (format) {
    case "edl":
    case "premiere":
    case "resolve":
      content = generateEDL(opts.clips, title, fps, opts.dropFrame ?? false);
      break;
    case "fcpxml":
      content = generateFCPXML(opts.clips, title, fps, opts.width ?? 1080, opts.height ?? 1920);
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  writeFileSync(opts.outputPath, content, "utf-8");

  const duration = opts.clips.length > 0
    ? Math.max(...opts.clips.map((c) => c.recordOut))
    : 0;

  console.log(`[export] Saved → ${opts.outputPath}`);
  return { outputPath: opts.outputPath, format, clipCount: opts.clips.length, duration };
}

// ─── CMX 3600 EDL Generator ───

function generateEDL(
  clips: TimelineClip[],
  title: string,
  fps: number,
  dropFrame: boolean,
): string {
  const lines: string[] = [];
  const fcm = dropFrame ? "DROP FRAME" : "NON-DROP FRAME";

  lines.push(`TITLE: ${title}`);
  lines.push(`FCM: ${fcm}`);
  lines.push("");

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const eventNum = String(i + 1).padStart(3, "0");
    const reel = clip.reel ?? deriveReel(clip.sourcePath, i);

    // Transition type
    let transType = "C"; // Cut
    if (clip.transition === "dissolve" && clip.transitionDuration) {
      transType = `D ${String(Math.round(clip.transitionDuration * fps)).padStart(3, "0")}`;
    }

    const srcIn = secondsToTimecode(clip.sourceIn, fps, dropFrame);
    const srcOut = secondsToTimecode(clip.sourceOut, fps, dropFrame);
    const recIn = secondsToTimecode(clip.recordIn, fps, dropFrame);
    const recOut = secondsToTimecode(clip.recordOut, fps, dropFrame);

    // EDL line: EVENT REEL TRACK TRANSITION SRC_IN SRC_OUT REC_IN REC_OUT
    lines.push(
      `${eventNum}  ${reel.padEnd(8)} V     ${transType.padEnd(8)} ${srcIn} ${srcOut} ${recIn} ${recOut}`,
    );
    lines.push(`* FROM CLIP NAME: ${basename(clip.sourcePath)}`);
    lines.push(`* SOURCE FILE: ${clip.sourcePath}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── FCPXML Generator (Final Cut Pro) ───

function generateFCPXML(
  clips: TimelineClip[],
  title: string,
  fps: number,
  width: number,
  height: number,
): string {
  const duration = clips.length > 0 ? Math.max(...clips.map((c) => c.recordOut)) : 0;
  const totalFrames = Math.round(duration * fps);

  const clipElements = clips.map((clip, i) => {
    const offsetFrames = Math.round(clip.recordIn * fps);
    const durationFrames = Math.round((clip.recordOut - clip.recordIn) * fps);
    const startFrames = Math.round(clip.sourceIn * fps);
    const name = basename(clip.sourcePath);

    return `            <asset-clip ref="r${i + 1}" offset="${offsetFrames}/${fps}s" name="${escapeXml(name)}" start="${startFrames}/${fps}s" duration="${durationFrames}/${fps}s"/>`;
  }).join("\n");

  const assetElements = clips.map((clip, i) => {
    return `        <asset id="r${i + 1}" name="${escapeXml(basename(clip.sourcePath))}" src="file://${escapeXml(clip.sourcePath)}"/>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
    <resources>
        <format id="r0" name="FFVideoFormat${height}p${fps}" frameDuration="1/${fps}s" width="${width}" height="${height}"/>
${assetElements}
    </resources>
    <library>
        <event name="${escapeXml(title)}">
            <project name="${escapeXml(title)}">
                <sequence format="r0" duration="${totalFrames}/${fps}s">
                    <spine>
${clipElements}
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>`;
}

// ─── Utilities ───

/**
 * Convert seconds to SMPTE timecode (HH:MM:SS:FF)
 */
function secondsToTimecode(seconds: number, fps: number, dropFrame: boolean): string {
  const totalFrames = Math.round(seconds * fps);
  const sep = dropFrame ? ";" : ":";

  const ff = totalFrames % fps;
  const ss = Math.floor(totalFrames / fps) % 60;
  const mm = Math.floor(totalFrames / (fps * 60)) % 60;
  const hh = Math.floor(totalFrames / (fps * 3600));

  return [
    String(hh).padStart(2, "0"),
    String(mm).padStart(2, "0"),
    String(ss).padStart(2, "0"),
    String(ff).padStart(2, "0"),
  ].join(sep);
}

/**
 * Derive a reel name from filename (max 8 chars for EDL compat).
 */
function deriveReel(sourcePath: string, index: number): string {
  const name = basename(sourcePath).replace(/\.[^.]+$/, "");
  // EDL reels are max 8 chars, uppercase
  const clean = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 7);
  return clean || String(index + 1).padStart(3, "0");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}