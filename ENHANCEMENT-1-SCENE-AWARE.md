# Enhancement 1: Scene-Aware Selection — COMPLETE ✅

## What We Added

### 1. Scene Analysis Module (`packages/ai/src/scene-analysis.ts`)

**Analyzes source videos and extracts scene metadata:**
- Extracts keyframes every N seconds (default 5s)
- Tags each scene with:
  - **Energy**: low, medium, high (movement/action level)
  - **Mood**: calm, neutral, intense, dramatic, playful
  - **Content**: ["person", "outdoors", "close-up", "motion", etc.]
  - **Color mood**: warm, cool, bright, dark, vibrant
  - **Visual quality score**: 0-1

**Two Analysis Modes:**
1. **Vision Model** (GPT-4o-mini) — semantic understanding, accurate tagging
2. **Basic Fallback** — simple heuristics when no API key

### 2. Smart Clip Selection

**Old behavior (round-robin):**
```
Clip 1 → Video A
Clip 2 → Video B
Clip 3 → Video A
Clip 4 → Video B
...
```

**New behavior (scene-aware):**
```
Intro (low energy) → Calm scene from Video A
Verse (medium energy) → Neutral scene from Video B
Chorus (high energy) → Action scene from Video A
Drop (high energy) → Intense scene from Video C
...
```

### 3. Updated Music Edit Endpoint

**Added scene analysis step:**
```typescript
// Before timeline generation:
const sceneMap = await analyzeAllVideos(body.sourceVideos, 5);
const allScenes = [...]; // flatten all scenes

// During timeline generation:
const bestScene = findBestSceneForSection(
  allScenes,
  section.energy, // match video energy to music energy
  section.type === "chorus" ? "intense" : ..., // match mood
  usedScenes, // avoid reusing scenes too soon
);
```

## How It Works

### Scene Analysis Pipeline

1. **Extract Keyframes**
   ```bash
   ffmpeg -ss {time} -i video.mp4 -frames:v 1 keyframe.jpg
   ```

2. **Analyze with Vision Model** (if OPENAI_API_KEY is set)
   ```
   → GPT-4o-mini receives keyframe image
   → Returns JSON: { energy, mood, content, colorMood, score }
   → Example: { energy: "high", mood: "intense", content: ["person", "running", "motion"], colorMood: "bright", score: 0.8 }
   ```

3. **Build Scene Library**
   ```
   Video A:
     Scene 0-5s:  { energy: "low", mood: "calm", score: 0.7 }
     Scene 5-10s: { energy: "medium", mood: "neutral", score: 0.6 }
     Scene 10-15s: { energy: "high", mood: "intense", score: 0.9 }
   
   Video B:
     Scene 0-5s:  { energy: "medium", mood: "playful", score: 0.8 }
     ...
   ```

### Matching Algorithm

**Score calculation for each scene:**
```typescript
score = scene.visualQuality; // base score (0-1)

// Match energy (most important)
if (scene.energy === section.energy) {
  score += 0.5; // perfect match
} else if (partial match) {
  score += 0.2; // close enough
}

// Match mood (if specified)
if (section.type === "chorus" && scene.mood === "intense") {
  score += 0.3;
}

// Pick highest scoring unused scene
```

**Result:** High-energy drops get action shots, calm verses get slow clips.

## Configuration

### Enable/Disable Vision Model

**With vision model** (default, requires OPENAI_API_KEY):
```typescript
analyzeVideo({ videoPath, useVisionModel: true });
```

**Without vision model** (faster, less accurate):
```typescript
analyzeVideo({ videoPath, useVisionModel: false });
```

**Auto-fallback:**
- If OPENAI_API_KEY is not set → uses basic fallback automatically
- If vision API fails → falls back gracefully with warning

### Adjust Sampling Rate

**Default (5s intervals):**
```typescript
analyzeAllVideos(videoPaths, 5); // keyframe every 5 seconds
```

**Faster (10s intervals, fewer API calls):**
```typescript
analyzeAllVideos(videoPaths, 10);
```

**More detailed (2s intervals, higher quality):**
```typescript
analyzeAllVideos(videoPaths, 2);
```

## Performance Impact

### Without Vision Model (Basic Fallback)
- **Analysis time:** ~1-2 seconds per video (just keyframe extraction)
- **API cost:** $0
- **Accuracy:** Medium (heuristic-based)

### With Vision Model (GPT-4o-mini)
- **Analysis time:** ~5-10 seconds per video (depends on keyframe count)
- **API cost:** ~$0.01 per video (assuming 10 keyframes @ $0.001 each)
- **Accuracy:** High (semantic understanding)

**Example:** 3-minute video with 5s sampling = 36 keyframes
- Cost: 36 × $0.001 = $0.036 per video
- Time: ~10-15 seconds for 3 videos

## Example Results

**Before (Round-Robin):**
```
Music: Upbeat drop @ 1:30
Video: Random calm nature clip (mismatch ❌)
```

**After (Scene-Aware):**
```
Music: Upbeat drop @ 1:30
Video: High-energy action scene (perfect match ✅)
```

## Testing

**Test scene analysis:**
```bash
cd /Users/caseyn.corrigan/crayola
bun run packages/ai/src/scene-analysis.ts
```

**Test in music-edit endpoint:**
```bash
# Make sure OPENAI_API_KEY is set
export OPENAI_API_KEY=sk-...

# Run music edit with scene-aware selection
curl -X POST http://localhost:3000/api/music-edit \
  -H "Content-Type: application/json" \
  -d '{
    "audioFile": "/path/to/music.mp3",
    "sourceVideos": ["/path/to/video1.mp4", "/path/to/video2.mp4"],
    "cutDensity": "auto"
  }'
```

**Check logs:**
```
[music-edit] Analyzing source videos...
[analyze] Extracting keyframes from /path/to/video1.mp4...
[analyze] Extracted 12 keyframes
[music-edit] Analyzed 24 total scenes
[music-edit] Generating cut timeline (scene-aware)...
```

## What's Next

We've completed **Enhancement 1: Scene-Aware Selection**.

**Remaining Enhancements:**
2. **Camera Switching Logic** — close-up on vocals, wide on chorus
3. **Fade/Dissolve Transitions** — smooth blends between clips
4. **B-roll Injection** — overlay clips on beat hits
5. **Multi-Stem Analysis** — separate drums, bass, vocals for smarter switching

Ready for **Enhancement 2**?
