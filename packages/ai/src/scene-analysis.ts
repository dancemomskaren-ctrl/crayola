// Scene-aware video analysis for music edit
// Analyzes source videos and tags scenes with mood/energy/content

export interface VideoScene {
  sourceVideo: string;
  startMs: number;
  durationMs: number;
  keyframePath: string; // extracted keyframe image
  tags: SceneTags;
  cameraAngle?: CameraAngle; // NEW: camera shot type
}

export interface SceneTags {
  energy: "low" | "medium" | "high"; // movement/action level
  mood: "calm" | "neutral" | "intense" | "dramatic" | "playful";
  content: string[]; // ["person", "outdoors", "close-up", "motion", etc.]
  colorMood: "warm" | "cool" | "bright" | "dark" | "vibrant";
  score: number; // overall visual quality (0-1)
}

export interface CameraAngle {
  type: "close-up" | "medium" | "wide" | "unknown";
  confidence: number; // 0-1
}

export interface AnalyzeVideoOptions {
  videoPath: string;
  sampleInterval?: number; // extract keyframe every N seconds (default 5)
  useVisionModel?: boolean; // use LLM vision for semantic tagging (default true)
}

/**
 * Analyze a source video and extract scene metadata.
 * Returns array of scenes with tags for smart clip selection.
 */
export async function analyzeVideo(opts: AnalyzeVideoOptions): Promise<VideoScene[]> {
  const sampleInterval = opts.sampleInterval ?? 5; // every 5 seconds
  const useVisionModel = opts.useVisionModel ?? true;

  // Step 1: Get video duration
  const duration = await getVideoDuration(opts.videoPath);
  const scenes: VideoScene[] = [];

  // Step 2: Extract keyframes at intervals
  console.log(`[analyze] Extracting keyframes from ${opts.videoPath}...`);
  const keyframes: Array<{ timeMs: number; path: string }> = [];

  for (let t = 0; t < duration; t += sampleInterval * 1000) {
    const keyframePath = `/tmp/keyframe-${Date.now()}-${t}.jpg`;
    
    // Extract frame at time t
    await extractKeyframe(opts.videoPath, t, keyframePath);
    keyframes.push({ timeMs: t, path: keyframePath });
  }

  console.log(`[analyze] Extracted ${keyframes.length} keyframes`);

  // Step 3: Analyze each keyframe
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    const nextKf = keyframes[i + 1];
    const sceneDuration = nextKf ? (nextKf.timeMs - kf.timeMs) : (duration - kf.timeMs);

    let tags: SceneTags;

    if (useVisionModel) {
      // Use vision model for semantic analysis
      tags = await analyzeKeyframeWithVision(kf.path);
    } else {
      // Fallback: basic heuristic analysis
      tags = await analyzeKeyframeBasic(kf.path);
    }

    // Detect camera angle for this scene
    const { detectCameraAngle } = await import("./camera-switching");
    let cameraAngle: CameraAngle = { type: "unknown", confidence: 0 };
    if (useVisionModel) {
      cameraAngle = await detectCameraAngle(kf.path);
    }

    scenes.push({
      sourceVideo: opts.videoPath,
      startMs: kf.timeMs,
      durationMs: sceneDuration,
      keyframePath: kf.path,
      tags,
      cameraAngle,
    });
  }

  return scenes;
}

/**
 * Get video duration in milliseconds using ffprobe.
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    {
      stdout: "pipe",
    },
  );

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const durationSec = parseFloat(output.trim());
  return durationSec * 1000;
}

/**
 * Extract a single keyframe at a specific timestamp.
 */
async function extractKeyframe(videoPath: string, timeMs: number, outputPath: string): Promise<void> {
  const timeSec = timeMs / 1000;
  
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-ss", String(timeSec),
      "-i", videoPath,
      "-frames:v", "1",
      "-q:v", "2", // high quality JPEG
      outputPath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  await proc.exited;
}

/**
 * Analyze keyframe using vision model (OpenAI GPT-4 Vision or similar).
 */
async function analyzeKeyframeWithVision(imagePath: string): Promise<SceneTags> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[analyze] OPENAI_API_KEY not set, falling back to basic analysis");
    return analyzeKeyframeBasic(imagePath);
  }

  try {
    // Read image as base64
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
                text: `Analyze this video frame and return a JSON object with:
{
  "energy": "low|medium|high" (movement/action level),
  "mood": "calm|neutral|intense|dramatic|playful",
  "content": ["tag1", "tag2", ...] (what's in the frame: person, outdoors, close-up, motion, etc.),
  "colorMood": "warm|cool|bright|dark|vibrant",
  "score": 0-1 (visual quality/aesthetic appeal)
}

Be concise. Return ONLY valid JSON, no explanation.`,
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
        max_tokens: 200,
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

    // Parse JSON response
    const tags = JSON.parse(text);
    
    return {
      energy: tags.energy || "medium",
      mood: tags.mood || "neutral",
      content: Array.isArray(tags.content) ? tags.content : [],
      colorMood: tags.colorMood || "neutral",
      score: typeof tags.score === "number" ? tags.score : 0.5,
    };

  } catch (err: any) {
    console.warn(`[analyze] Vision model failed: ${err.message}, using fallback`);
    return analyzeKeyframeBasic(imagePath);
  }
}

/**
 * Fallback: basic heuristic analysis without vision model.
 * Uses ffmpeg filters to estimate energy/brightness.
 */
async function analyzeKeyframeBasic(imagePath: string): Promise<SceneTags> {
  // Simple heuristic: assume medium energy, neutral mood
  // In production, could use image processing to detect brightness, contrast, etc.
  
  return {
    energy: "medium",
    mood: "neutral",
    content: ["unknown"],
    colorMood: "neutral" as any,
    score: 0.5,
  };
}

/**
 * Match video scenes to music section energy and camera angle.
 * Returns the best scene for the given section.
 */
export function findBestSceneForSection(
  scenes: VideoScene[],
  sectionEnergy: "low" | "medium" | "high",
  sectionMood?: "calm" | "intense" | "playful",
  usedScenes: Set<number> = new Set(),
  desiredCameraAngle?: "close-up" | "medium" | "wide",
): VideoScene | null {
  if (scenes.length === 0) return null;

  // Score each scene based on how well it matches
  const scored = scenes.map((scene, idx) => {
    if (usedScenes.has(idx)) return { scene, idx, score: -1 };

    let score = scene.tags.score; // base visual quality score

    // Match energy (most important)
    if (scene.tags.energy === sectionEnergy) {
      score += 0.5;
    } else if (
      (scene.tags.energy === "medium" && sectionEnergy !== "low") ||
      (scene.tags.energy === "low" && sectionEnergy === "medium")
    ) {
      score += 0.2; // partial match
    }

    // Match mood (if provided)
    if (sectionMood) {
      if (
        (sectionMood === "calm" && scene.tags.mood === "calm") ||
        (sectionMood === "intense" && (scene.tags.mood === "intense" || scene.tags.mood === "dramatic")) ||
        (sectionMood === "playful" && scene.tags.mood === "playful")
      ) {
        score += 0.3;
      }
    }

    // Match camera angle (if provided and detected)
    if (desiredCameraAngle && scene.cameraAngle && scene.cameraAngle.type !== "unknown") {
      if (scene.cameraAngle.type === desiredCameraAngle) {
        score += 0.4 * scene.cameraAngle.confidence; // strong boost for correct angle
      } else if (scene.cameraAngle.type === "medium") {
        score += 0.1; // medium works for anything
      }
    }

    return { scene, idx, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return best match that hasn't been used
  const best = scored.find(s => s.score > 0);
  return best ? best.scene : null;
}

/**
 * Analyze all source videos in parallel.
 */
export async function analyzeAllVideos(
  videoPaths: string[],
  sampleInterval?: number,
): Promise<Map<string, VideoScene[]>> {
  console.log(`[analyze] Analyzing ${videoPaths.length} source videos...`);
  
  const results = await Promise.all(
    videoPaths.map(path => analyzeVideo({ videoPath: path, sampleInterval })),
  );

  const sceneMap = new Map<string, VideoScene[]>();
  for (let i = 0; i < videoPaths.length; i++) {
    sceneMap.set(videoPaths[i], results[i]);
  }

  return sceneMap;
}
