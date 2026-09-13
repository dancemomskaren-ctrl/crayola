// Beat detection and music analysis for automatic edit syncing
// Uses FFmpeg's astats filter to detect audio energy peaks

export interface BeatDetectionOptions {
  audioPath: string;
  minBPM?: number; // default 60
  maxBPM?: number; // default 200
  threshold?: number; // energy threshold (0-1), default 0.6
}

export interface Beat {
  timeMs: number;
  energy: number; // 0-1
  confidence: number; // 0-1
}

export interface BeatGrid {
  beats: Beat[];
  bpm: number; // estimated average BPM
  timeSignature: string; // e.g. "4/4"
  sections: Section[]; // song structure (intro, verse, chorus, etc.)
}

export interface Section {
  startMs: number;
  endMs: number;
  type: "intro" | "verse" | "chorus" | "bridge" | "drop" | "outro" | "unknown";
  energy: "low" | "medium" | "high";
  averageBPM: number;
}

/**
 * Detect beats in an audio file using FFmpeg energy analysis.
 * Returns a beat grid with timestamps, BPM, and song structure.
 */
export async function detectBeats(opts: BeatDetectionOptions): Promise<BeatGrid> {
  const minBPM = opts.minBPM ?? 60;
  const maxBPM = opts.maxBPM ?? 200;
  const threshold = opts.threshold ?? 0.6;

  // Step 1: Extract audio energy envelope using FFmpeg astats
  const energyData = await extractAudioEnergy(opts.audioPath);

  // Step 2: Find peaks in energy that correspond to beats
  const beats = findBeatsFromEnergy(energyData, threshold);

  // Step 3: Estimate BPM from beat intervals
  const bpm = estimateBPM(beats, minBPM, maxBPM);

  // Step 4: Detect song structure (intro, verse, chorus, etc.)
  const sections = detectSongStructure(beats, energyData);

  return {
    beats,
    bpm,
    timeSignature: "4/4", // assume 4/4 for now (most common)
    sections,
  };
}

/**
 * Extract audio energy envelope from an audio file.
 * Uses FFmpeg's astats filter to get RMS energy over time.
 */
async function extractAudioEnergy(audioPath: string): Promise<number[]> {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i", audioPath,
      "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f", "null",
      "-",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  // Parse RMS values from stderr
  // Format: frame:123 pts:456 pts_time:1.234 lavfi.astats.Overall.RMS_level=-12.3
  const energyValues: number[] = [];
  const lines = stderr.split("\n");

  for (const line of lines) {
    const match = line.match(/pts_time:([\d.]+).*RMS_level=([-\d.]+)/);
    if (match) {
      const time = parseFloat(match[1]);
      const rmsDb = parseFloat(match[2]);
      
      // Convert dB to linear scale (0-1)
      // RMS is typically -60dB (silence) to 0dB (max)
      const normalized = Math.max(0, Math.min(1, (rmsDb + 60) / 60));
      
      energyValues.push(normalized);
    }
  }

  return energyValues;
}

/**
 * Find beat timestamps from energy envelope.
 * Looks for peaks above threshold.
 */
function findBeatsFromEnergy(energyData: number[], threshold: number): Beat[] {
  const beats: Beat[] = [];
  const windowSize = 5; // frames to look ahead/behind for peak detection

  for (let i = windowSize; i < energyData.length - windowSize; i++) {
    const current = energyData[i];
    
    // Check if this is a local maximum above threshold
    if (current < threshold) continue;

    let isPeak = true;
    for (let j = i - windowSize; j <= i + windowSize; j++) {
      if (j !== i && energyData[j] >= current) {
        isPeak = false;
        break;
      }
    }

    if (isPeak) {
      // Assume ~10 energy samples per second (depends on FFmpeg frame rate)
      const timeMs = (i / 10) * 1000;
      
      beats.push({
        timeMs,
        energy: current,
        confidence: current, // simple approach: energy = confidence
      });
    }
  }

  return beats;
}

/**
 * Estimate BPM from beat intervals.
 */
function estimateBPM(beats: Beat[], minBPM: number, maxBPM: number): number {
  if (beats.length < 2) return 120; // default fallback

  // Calculate intervals between beats
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const intervalMs = beats[i].timeMs - beats[i - 1].timeMs;
    intervals.push(intervalMs);
  }

  // Find median interval (more robust than mean)
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];

  // Convert interval to BPM
  const bpm = (60 * 1000) / medianInterval;

  // Clamp to min/max
  return Math.max(minBPM, Math.min(maxBPM, Math.round(bpm)));
}

/**
 * Detect song structure based on energy patterns.
 * Simple heuristic: high energy = chorus/drop, low energy = verse/intro.
 */
function detectSongStructure(beats: Beat[], energyData: number[]): Section[] {
  const sections: Section[] = [];
  const windowSize = 8; // number of beats per section window

  for (let i = 0; i < beats.length; i += windowSize) {
    const sectionBeats = beats.slice(i, i + windowSize);
    if (sectionBeats.length === 0) continue;

    const startMs = sectionBeats[0].timeMs;
    const endMs = sectionBeats[sectionBeats.length - 1]?.timeMs ?? startMs + 4000;

    // Calculate average energy for this section
    const avgEnergy = sectionBeats.reduce((sum, b) => sum + b.energy, 0) / sectionBeats.length;

    // Classify section based on energy
    let energy: "low" | "medium" | "high";
    let type: Section["type"];

    if (avgEnergy > 0.7) {
      energy = "high";
      type = i === 0 ? "intro" : (i > beats.length - windowSize ? "outro" : "chorus");
    } else if (avgEnergy > 0.4) {
      energy = "medium";
      type = "verse";
    } else {
      energy = "low";
      type = i === 0 ? "intro" : "bridge";
    }

    // Estimate BPM for this section
    const sectionIntervals: number[] = [];
    for (let j = 1; j < sectionBeats.length; j++) {
      sectionIntervals.push(sectionBeats[j].timeMs - sectionBeats[j - 1].timeMs);
    }
    const avgInterval = sectionIntervals.length > 0
      ? sectionIntervals.reduce((a, b) => a + b, 0) / sectionIntervals.length
      : 500;
    const averageBPM = Math.round((60 * 1000) / avgInterval);

    sections.push({
      startMs,
      endMs,
      type,
      energy,
      averageBPM,
    });
  }

  return sections;
}

/**
 * Find the nearest beat to a given timestamp.
 */
export function findNearestBeat(beatGrid: BeatGrid, timeMs: number): Beat | null {
  if (beatGrid.beats.length === 0) return null;

  let nearest = beatGrid.beats[0];
  let minDiff = Math.abs(timeMs - nearest.timeMs);

  for (const beat of beatGrid.beats) {
    const diff = Math.abs(timeMs - beat.timeMs);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = beat;
    }
  }

  return nearest;
}

/**
 * Snap a timestamp to the nearest beat.
 */
export function snapToBeat(beatGrid: BeatGrid, timeMs: number): number {
  const nearest = findNearestBeat(beatGrid, timeMs);
  return nearest ? nearest.timeMs : timeMs;
}

/**
 * Get all beats within a time range.
 */
export function getBeatsInRange(beatGrid: BeatGrid, startMs: number, endMs: number): Beat[] {
  return beatGrid.beats.filter(b => b.timeMs >= startMs && b.timeMs <= endMs);
}

/**
 * Calculate cut density (cuts per second) for a given energy level.
 * High energy (drops, chorus) = more cuts, low energy (verse) = fewer cuts.
 */
export function calculateCutDensity(energy: "low" | "medium" | "high"): number {
  switch (energy) {
    case "high": return 2.0; // 2 cuts per second (every 0.5s)
    case "medium": return 1.0; // 1 cut per second
    case "low": return 0.5; // 1 cut every 2 seconds
  }
}
