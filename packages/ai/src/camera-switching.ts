// Audio stem analysis and camera switching logic
// Separates audio into stems (vocals, drums, bass, other) for intelligent camera angle selection
// Enhancement 5: Now uses Demucs for real stem separation when available

import type { MultiStemAnalysis } from "./stem-separation";

export interface AudioStem {
  type: "vocals" | "drums" | "bass" | "other";
  energy: number; // 0-1, average energy for this stem
  dominantAt: number[]; // timestamps (ms) where this stem is dominant
}

export interface StemAnalysis {
  vocals: AudioStem;
  drums: AudioStem;
  bass: AudioStem;
  other: AudioStem;
  timeline: Array<{
    startMs: number;
    endMs: number;
    dominantStem: "vocals" | "drums" | "bass" | "other";
    energy: number;
  }>;
}

export interface CameraAngle {
  type: "close-up" | "medium" | "wide" | "unknown";
  confidence: number; // 0-1
}

/**
 * Analyze audio and return stem analysis.
 * Uses Demucs (real separation) if available, falls back to FFmpeg frequency bands.
 */
export async function analyzeStemEnergy(audioPath: string): Promise<StemAnalysis> {
  // Try Demucs first (Enhancement 5)
  const { isDemucsAvailable, analyzeMultiStem } = await import("./stem-separation");
  
  if (await isDemucsAvailable()) {
    console.log("[stem-analysis] Using Demucs for real stem separation...");
    const multiStem = await analyzeMultiStem({ audioPath });
    return convertMultiStemToLegacy(multiStem);
  }

  // Fallback: FFmpeg frequency band estimation (original behavior)
  console.log("[stem-analysis] Demucs not found, using frequency-band estimation...");
  return analyzeStemEnergyFallback(audioPath);
}

/**
 * Convert MultiStemAnalysis (Enhancement 5) to legacy StemAnalysis format.
 */
function convertMultiStemToLegacy(multi: MultiStemAnalysis): StemAnalysis {
  const timeline: StemAnalysis["timeline"] = multi.dominantTimeline.map((t) => ({
    startMs: t.startMs,
    endMs: t.endMs,
    dominantStem: t.dominantStem,
    energy: t.energy,
  }));

  return {
    vocals: {
      type: "vocals",
      energy: multi.energy.vocals.averageEnergy,
      dominantAt: multi.energy.vocals.dominantRanges.map((r) => r.startMs),
    },
    drums: {
      type: "drums",
      energy: multi.energy.drums.averageEnergy,
      dominantAt: multi.energy.drums.dominantRanges.map((r) => r.startMs),
    },
    bass: {
      type: "bass",
      energy: multi.energy.bass.averageEnergy,
      dominantAt: multi.energy.bass.dominantRanges.map((r) => r.startMs),
    },
    other: {
      type: "other",
      energy: multi.energy.other.averageEnergy,
      dominantAt: multi.energy.other.dominantRanges.map((r) => r.startMs),
    },
    timeline,
  };
}

/**
 * Fallback: FFmpeg frequency band estimation (pre-Enhancement 5 behavior).
 */
async function analyzeStemEnergyFallback(audioPath: string): Promise<StemAnalysis> {
  const vocalsEnergy = await extractFrequencyBandEnergy(audioPath, "4000", "20000");
  const bassEnergy = await extractFrequencyBandEnergy(audioPath, "20", "250");
  const drumsEnergy = await extractFrequencyBandEnergy(audioPath, "250", "4000");
  const otherEnergy = await extractFrequencyBandEnergy(audioPath, "250", "4000");

  // Build timeline showing which stem is dominant at each moment
  const timeline: StemAnalysis["timeline"] = [];
  const windowSize = 1000; // 1 second windows

  for (let t = 0; t < vocalsEnergy.length; t++) {
    const vEnergy = vocalsEnergy[t] || 0;
    const dEnergy = drumsEnergy[t] || 0;
    const bEnergy = bassEnergy[t] || 0;
    const oEnergy = otherEnergy[t] || 0;

    // Find dominant stem
    const max = Math.max(vEnergy, dEnergy, bEnergy, oEnergy);
    let dominant: "vocals" | "drums" | "bass" | "other";

    if (max === vEnergy) dominant = "vocals";
    else if (max === dEnergy) dominant = "drums";
    else if (max === bEnergy) dominant = "bass";
    else dominant = "other";

    timeline.push({
      startMs: t * windowSize,
      endMs: (t + 1) * windowSize,
      dominantStem: dominant,
      energy: max,
    });
  }

  // Calculate average energy per stem
  const vocalsAvg = vocalsEnergy.reduce((a, b) => a + b, 0) / vocalsEnergy.length;
  const drumsAvg = drumsEnergy.reduce((a, b) => a + b, 0) / drumsEnergy.length;
  const bassAvg = bassEnergy.reduce((a, b) => a + b, 0) / bassEnergy.length;
  const otherAvg = otherEnergy.reduce((a, b) => a + b, 0) / otherEnergy.length;

  return {
    vocals: {
      type: "vocals",
      energy: vocalsAvg,
      dominantAt: timeline.filter(t => t.dominantStem === "vocals").map(t => t.startMs),
    },
    drums: {
      type: "drums",
      energy: drumsAvg,
      dominantAt: timeline.filter(t => t.dominantStem === "drums").map(t => t.startMs),
    },
    bass: {
      type: "bass",
      energy: bassAvg,
      dominantAt: timeline.filter(t => t.dominantStem === "bass").map(t => t.startMs),
    },
    other: {
      type: "other",
      energy: otherAvg,
      dominantAt: timeline.filter(t => t.dominantStem === "other").map(t => t.startMs),
    },
    timeline,
  };
}

/**
 * Extract energy for a specific frequency band using FFmpeg filters.
 */
async function extractFrequencyBandEnergy(
  audioPath: string,
  lowFreq: string,
  highFreq: string,
): Promise<number[]> {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i", audioPath,
      "-af", `highpass=f=${lowFreq},lowpass=f=${highFreq},astats=metadata=1:reset=1`,
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

  // Parse RMS values from stderr (similar to beat detection)
  const energyValues: number[] = [];
  const lines = stderr.split("\n");

  for (const line of lines) {
    const match = line.match(/RMS_level=([-\d.]+)/);
    if (match) {
      const rmsDb = parseFloat(match[1]);
      const normalized = Math.max(0, Math.min(1, (rmsDb + 60) / 60));
      energyValues.push(normalized);
    }
  }

  return energyValues;
}

/**
 * Detect camera angle from a keyframe image using vision model.
 */
export async function detectCameraAngle(imagePath: string): Promise<CameraAngle> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { type: "unknown", confidence: 0 };
  }

  try {
    const imageBuffer = await Bun.file(imagePath).arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this video frame and determine the camera shot type. Return JSON:
{
  "type": "close-up|medium|wide",
  "confidence": 0-1
}

Definitions:
- close-up: tight framing on face/subject, little background visible
- medium: waist-up or half-body shot
- wide: full body or establishing shot with lots of background

Return ONLY valid JSON, no explanation.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 100,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`Vision API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("Empty response from vision model");
    }

    const result = JSON.parse(text);
    return {
      type: result.type || "unknown",
      confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
    };

  } catch (err: any) {
    console.warn(`[camera-angle] Vision model failed: ${err.message}`);
    return { type: "unknown", confidence: 0 };
  }
}

/**
 * Match camera angle to audio stem.
 * 
 * Rules:
 * - Vocals dominant → close-up (intimate, personal)
 * - Drums/Bass dominant → wide (energy, movement)
 * - Other instruments → medium (balanced)
 */
export function matchCameraToStem(
  dominantStem: "vocals" | "drums" | "bass" | "other",
): "close-up" | "medium" | "wide" {
  switch (dominantStem) {
    case "vocals":
      return "close-up";
    case "drums":
    case "bass":
      return "wide";
    case "other":
    default:
      return "medium";
  }
}

/**
 * Score a scene based on how well its camera angle matches the desired angle.
 */
export function scoreCameraMatch(
  sceneAngle: CameraAngle,
  desiredAngle: "close-up" | "medium" | "wide",
): number {
  if (sceneAngle.type === "unknown") {
    return 0.5; // neutral score if unknown
  }

  if (sceneAngle.type === desiredAngle) {
    return sceneAngle.confidence; // perfect match, weighted by confidence
  }

  // Partial matches (medium is between close-up and wide)
  if (sceneAngle.type === "medium") {
    return 0.3; // medium works for anything, just not ideal
  }

  return 0.1; // mismatch
}
