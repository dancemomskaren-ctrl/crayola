# Music Edit / Beat Sync — Implementation Guide

## What We Built

### 1. **Beat Detection Module** (`packages/ai/src/beat-detection.ts`)

**Uses FFmpeg's `astats` filter to detect audio energy peaks:**
- Extracts RMS energy envelope from audio
- Finds peaks above threshold
- Estimates BPM from beat intervals
- Detects song structure (intro, verse, chorus, drop, outro)
- Classifies energy levels (low, medium, high)

**Key Functions:**
```typescript
detectBeats(options) → BeatGrid
  - Returns: beats[], bpm, timeSignature, sections[]

findNearestBeat(beatGrid, timeMs) → Beat
snapToBeat(beatGrid, timeMs) → number
getBeatsInRange(beatGrid, startMs, endMs) → Beat[]
calculateCutDensity(energy) → number
```

**BeatGrid Structure:**
```typescript
{
  beats: [{ timeMs, energy, confidence }, ...],
  bpm: 120,
  timeSignature: "4/4",
  sections: [
    { startMs, endMs, type: "chorus", energy: "high", averageBPM },
    ...
  ]
}
```

### 2. **Music Edit Template** (added to `templates.ts`)

**New template ID:** `music-edit` 🎵

**User Inputs:**
- Music track (audio file)
- Source videos (2-5 clips to cut between)
- Cut density (auto, low, medium, high)
- Min/max clip length
- Caption style (scattered styles recommended)
- Transition style (cut, fade, dissolve)
- Platform format (9:16, 1:1, 16:9)

**Default Settings:**
- Platform: 9:16 (TikTok/Shorts)
- Cut density: auto (follows music energy)
- Min clip: 0.5s, Max clip: 4s
- Captions: scattered_neon
- Transition: hard cut
- Quality: high (1080p CRF 18)

## How It Works (Algorithm)

### Step 1: Beat Detection
```typescript
const beatGrid = await detectBeats({
  audioPath: "/path/to/music.mp3",
  minBPM: 60,
  maxBPM: 200,
  threshold: 0.6, // energy threshold
});
```

### Step 2: Generate Cut Timeline
```typescript
const timeline = [];
let currentTime = 0;

for (const section of beatGrid.sections) {
  const sectionBeats = getBeatsInRange(beatGrid, section.startMs, section.endMs);
  
  // Calculate cut density based on energy
  let cutDensity;
  if (cutDensity === "auto") {
    cutDensity = calculateCutDensity(section.energy);
  }
  
  // Pick source video clips for this section
  for (let i = 0; i < sectionBeats.length; i++) {
    const beat = sectionBeats[i];
    const nextBeat = sectionBeats[i + 1];
    
    // Calculate clip duration (beat to beat, clamped by min/max)
    let clipDuration = nextBeat 
      ? (nextBeat.timeMs - beat.timeMs) / 1000
      : maxClipLength;
    
    clipDuration = Math.max(minClipLength, Math.min(maxClipLength, clipDuration));
    
    // Choose source video (round-robin or energy-based)
    const sourceIndex = i % sourceVideos.length;
    
    timeline.push({
      sourceVideo: sourceVideos[sourceIndex],
      startMs: currentTime,
      durationMs: clipDuration * 1000,
      beatSync: beat.timeMs,
    });
    
    currentTime += clipDuration * 1000;
  }
}
```

### Step 3: Render Video
```typescript
// Build ffmpeg concat file
const concatFile = timeline.map((seg, i) => {
  const segPath = `/tmp/seg-${i}.mp4`;
  
  // Extract segment from source video
  await ffmpeg.run([
    "-ss", seg.sourceStartSec,
    "-i", seg.sourceVideo,
    "-t", seg.durationSec,
    "-c:v", "libx264",
    "-c:a", "aac",
    segPath,
  ]);
  
  return `file '${segPath}'`;
}).join("\n");

// Concatenate all segments
await ffmpeg.run([
  "-f", "concat",
  "-safe", "0",
  "-i", concatFile,
  "-i", musicTrack,
  "-map", "0:v", // video from concat
  "-map", "1:a", // audio from music track
  "-c:v", "copy",
  "-c:a", "aac",
  "-shortest",
  outputPath,
]);
```

### Step 4: Add Captions (Optional)
If scattered captions are enabled, add them on top:
```typescript
const scatteredFilter = buildScatteredWordFilterComplex({
  words: transcriptWords, // from Whisper
  videoWidth: 1080,
  videoHeight: 1920,
  style: "neon",
});

await ffmpeg.run([
  "-i", outputPath,
  "-vf", scatteredFilter,
  finalOutputPath,
]);
```

## Next Steps: Build the API Endpoint

**Endpoint:** `POST /api/music-edit`

**Request Body:**
```json
{
  "audioFile": "/path/to/music.mp3",
  "sourceVideos": [
    "/path/to/video1.mp4",
    "/path/to/video2.mp4"
  ],
  "cutDensity": "auto",
  "minClipLength": 0.5,
  "maxClipLength": 4,
  "captionStyle": "scattered_neon",
  "transitionStyle": "cut",
  "platform": "9:16",
  "quality": "high"
}
```

**Response:**
```json
{
  "success": true,
  "projectId": "...",
  "renderId": "...",
  "outputPath": "/output/music-edit-123.mp4",
  "metadata": {
    "bpm": 128,
    "sections": [...],
    "totalClips": 42,
    "duration": 180000
  }
}
```

## Implementation Checklist

- [x] Beat detection module (`beat-detection.ts`)
- [x] Music edit template (added to `templates.ts`)
- [ ] API endpoint (`POST /api/music-edit`)
- [ ] Source video analysis (detect good moments to cut to)
- [ ] Energy-based clip selection (high energy = action shots)
- [ ] Transition rendering (fade, dissolve)
- [ ] B-roll injection (optional overlay clips on beats)

## Testing Plan

1. **Simple test:** 1 source video + 1 music track
2. **Multi-source test:** 3 source videos + beat-heavy track (EDM, hip-hop)
3. **Energy test:** Verify fast cuts on drops, slow cuts on verses
4. **Caption test:** Scattered words stay visible throughout
5. **Transition test:** Fade vs hard cut

## Performance Notes

- Beat detection: ~5-10 seconds for 3-minute song
- Timeline generation: instant
- Rendering: depends on clip count and quality
  - 50 clips @ 1080p high = ~2-3 minutes
  - 100 clips @ 4K ultra = ~10-15 minutes

## Future Enhancements

- [ ] Semantic scene matching (use vision model to match video content to music mood)
- [ ] Camera switching logic (vocals → close-up, drums → wide shot)
- [ ] Smart B-roll injection (detect "drop" moments, insert overlay)
- [ ] Multi-stem analysis (separate drums, bass, vocals)
- [ ] Motion detection in source videos (cut to moving shots on beats)
- [ ] Color grading based on music mood (warm for calm, cool for intense)

## Credits

Algorithm inspired by:
- **StemSyncVideoEditor** (vrgamegirl19, MIT)
- **BeatSync-Engine** (Merserk, AGPL — ideas only, no code copied)
