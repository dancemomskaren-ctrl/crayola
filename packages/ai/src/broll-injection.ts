// B-Roll Injection — overlay short clips on beat hits
// Injects flash frames, cutaways, and reaction shots at peak energy moments

export interface BRollClip {
  path: string;
  durationMs: number;
  tags?: string[]; // optional tags for smart matching
}

export interface BRollInjectionOptions {
  beatTimestamps: number[]; // ms timestamps of beats to inject at
  brollClips: BRollClip[]; // available B-roll clips
  injectionRate: number; // 0-1, how often to inject (0.3 = 30% of beats)
  style: "flash" | "overlay" | "cutaway" | "reaction";
  maxDurationMs?: number; // max B-roll duration per injection (default 500ms)
  minDurationMs?: number; // min B-roll duration per injection (default 100ms)
}

export interface BRollEvent {
  timeMs: number; // when to inject
  clipPath: string; // which B-roll clip to use
  durationMs: number; // how long to show it
  style: "flash" | "overlay" | "cutaway" | "reaction";
  opacity?: number; // for overlay style (0-1, default 0.8)
}

/**
 * Generate B-roll injection events for a beat-synced edit.
 * 
 * Selects which beats get B-roll based on energy and injection rate,
 * then picks appropriate clips from the library.
 */
export function generateBRollEvents(opts: BRollInjectionOptions): BRollEvent[] {
  const events: BRollEvent[] = [];
  const maxDur = opts.maxDurationMs ?? 500;
  const minDur = opts.minDurationMs ?? 100;

  if (opts.brollClips.length === 0) return events;

  let clipIndex = 0;

  for (const beatMs of opts.beatTimestamps) {
    // Inject based on rate (random chance per beat)
    if (Math.random() > opts.injectionRate) continue;

    // Pick a B-roll clip (round-robin with shuffle)
    const clip = opts.brollClips[clipIndex % opts.brollClips.length];
    clipIndex++;

    // Duration varies by style
    let duration: number;
    switch (opts.style) {
      case "flash":
        duration = minDur + Math.random() * 150; // 100-250ms (very short)
        break;
      case "overlay":
        duration = 200 + Math.random() * 300; // 200-500ms
        break;
      case "cutaway":
        duration = 300 + Math.random() * (maxDur - 300); // 300-maxDur
        break;
      case "reaction":
        duration = maxDur; // full duration for reaction shots
        break;
      default:
        duration = 200;
    }

    duration = Math.min(duration, maxDur);

    events.push({
      timeMs: beatMs,
      clipPath: clip.path,
      durationMs: duration,
      style: opts.style,
      opacity: opts.style === "overlay" ? 0.7 : 1.0,
    });
  }

  return events;
}

/**
 * Build FFmpeg filter for B-roll overlay injection.
 * 
 * For "flash" style: briefly shows the B-roll frame at full opacity
 * For "overlay" style: blends B-roll on top with transparency
 * For "cutaway" style: replaces the main video entirely for the duration
 * For "reaction" style: picture-in-picture (small B-roll in corner)
 */
export function buildBRollFilter(
  events: BRollEvent[],
  videoWidth: number,
  videoHeight: number,
): string {
  if (events.length === 0) return "";

  const filters: string[] = [];

  for (const event of events) {
    const startSec = event.timeMs / 1000;
    const endSec = (event.timeMs + event.durationMs) / 1000;

    switch (event.style) {
      case "flash":
        // Flash: quick brightness spike (simulates flash frame without needing B-roll file)
        filters.push(
          `eq=brightness=0.3:enable='between(t,${startSec.toFixed(3)},${(startSec + 0.05).toFixed(3)})'`
        );
        break;

      case "overlay":
        // Overlay: darken/lighten effect (simulated without separate input)
        filters.push(
          `colorbalance=rs=0.2:gs=0.2:bs=0.2:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'`
        );
        break;

      case "cutaway":
        // Cutaway: zoom effect to simulate camera switch
        const zoomFactor = 1.3;
        filters.push(
          `zoompan=z=${zoomFactor}:d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${videoWidth}x${videoHeight}:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'`
        );
        break;

      case "reaction":
        // Reaction: quick zoom + brightness pop
        filters.push(
          `eq=brightness=0.15:enable='between(t,${startSec.toFixed(3)},${(startSec + 0.1).toFixed(3)})'`
        );
        break;
    }
  }

  return filters.join(",");
}

/**
 * Advanced B-roll injection using actual B-roll video files.
 * Requires FFmpeg overlay filter with multiple inputs.
 * 
 * Returns FFmpeg args for a complex filter that overlays B-roll clips
 * on top of the main video at specified timestamps.
 */
export function buildBRollOverlayArgs(
  mainVideoPath: string,
  events: BRollEvent[],
  videoWidth: number,
  videoHeight: number,
): { inputs: string[]; filterComplex: string } {
  if (events.length === 0) {
    return { inputs: [mainVideoPath], filterComplex: "" };
  }

  const inputs: string[] = [mainVideoPath];
  const filterParts: string[] = [];

  // Add each B-roll clip as an input
  const uniqueClips = [...new Set(events.map(e => e.clipPath))];
  const clipInputMap = new Map<string, number>();

  for (const clipPath of uniqueClips) {
    inputs.push(clipPath);
    clipInputMap.set(clipPath, inputs.length - 1);
  }

  // Build overlay chain
  let prevLabel = "[0:v]";

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const inputIdx = clipInputMap.get(event.clipPath)!;
    const startSec = event.timeMs / 1000;
    const endSec = (event.timeMs + event.durationMs) / 1000;
    const outLabel = i < events.length - 1 ? `[broll${i}]` : "[vout]";

    if (event.style === "reaction") {
      // Picture-in-picture (bottom-right corner, 30% size)
      const pipW = Math.floor(videoWidth * 0.3);
      const pipH = Math.floor(videoHeight * 0.3);
      const pipX = videoWidth - pipW - 20;
      const pipY = videoHeight - pipH - 20;

      filterParts.push(
        `[${inputIdx}:v]scale=${pipW}:${pipH}[pip${i}];` +
        `${prevLabel}[pip${i}]overlay=${pipX}:${pipY}:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'${outLabel}`
      );
    } else {
      // Full-screen overlay with opacity
      const opacity = event.opacity ?? 1.0;

      filterParts.push(
        `[${inputIdx}:v]scale=${videoWidth}:${videoHeight},format=rgba,colorchannelmixer=aa=${opacity}[ovl${i}];` +
        `${prevLabel}[ovl${i}]overlay=0:0:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'${outLabel}`
      );
    }

    prevLabel = outLabel;
  }

  return {
    inputs,
    filterComplex: filterParts.join(";"),
  };
}

/**
 * Select which beats should receive B-roll injection.
 * Prioritizes high-energy beats (drops, impacts) over regular beats.
 */
export function selectBRollBeats(
  beats: Array<{ timeMs: number; energy: number }>,
  injectionRate: number = 0.3,
): number[] {
  // Sort by energy descending, take top N%
  const sorted = [...beats].sort((a, b) => b.energy - a.energy);
  const count = Math.max(1, Math.floor(beats.length * injectionRate));
  const selected = sorted.slice(0, count);

  // Return in chronological order
  return selected.map(b => b.timeMs).sort((a, b) => a - b);
}
