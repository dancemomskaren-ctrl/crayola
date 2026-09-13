# Scattered Word Captions — Usage Guide

## What It Does

Creates the "aesthetic edit" scattered-word effect where:
- Each word appears at a **random position** as it's spoken
- All words **stay visible** until the clip ends
- Words fade in smoothly (0.2s)
- No overlapping text (collision detection)
- 5 style presets included

## Styles

1. **clean** — White text, black outline (default)
2. **neon** — Cyan text, magenta outline (gaming/tech)
3. **pastel** — Light pink text, white outline (aesthetic/wholesome)
4. **bold** — Yellow text, thick black outline (attention-grabbing)
5. **handwritten** — Dark blue text, casual Comic Sans (playful)

## Basic Usage

```typescript
import { buildScatteredWordFilterComplex } from "@crayo/core";

// Get word-level timestamps from Whisper
const words = [
  { text: "This", startMs: 0, endMs: 200 },
  { text: "is", startMs: 200, endMs: 400 },
  { text: "amazing", startMs: 400, endMs: 800 },
  // ... more words
];

// Generate filter string
const filterComplex = buildScatteredWordFilterComplex({
  words,
  videoWidth: 1080,
  videoHeight: 1920,
  style: "neon", // or "clean", "pastel", "bold", "handwritten"
  minFontSize: 60,
  maxFontSize: 100,
  safeMargin: 50, // pixels from edge
  rotationRange: 15, // degrees (not yet implemented)
});

// Apply with ffmpeg
await ffmpeg.run([
  "-i", inputVideo,
  "-vf", filterComplex,
  "-c:v", "libx264",
  "-crf", "18",
  "-preset", "medium",
  "-c:a", "copy",
  outputVideo,
]);
```

## Batched Mode (for long videos)

For videos with 100+ words, use batched mode to avoid overwhelming ffmpeg:

```typescript
import { generateScatteredWordFiltersBatched } from "@crayo/core";

const filters = generateScatteredWordFiltersBatched(
  {
    words,
    videoWidth: 1080,
    videoHeight: 1920,
    style: "pastel",
  },
  20, // batch size (words per group)
);

const filterComplex = filters.join(",");
```

## Integration with Auto-Clip

```typescript
// In auto-clip endpoint
const result = await autoClip({ url, clipCount: 5 });

for (const clip of result.clips) {
  // Option 1: Viral ASS captions (word-by-word highlights)
  const assPath = `/tmp/${clip.id}.ass`;
  const assContent = generateViralASS(
    clip.captions,
    "mrbeast",
    1080,
    1920,
  );
  writeFileSync(assPath, assContent);

  // Option 2: Scattered word effect (aesthetic edit style)
  const scatteredFilter = buildScatteredWordFilterComplex({
    words: clip.captions,
    videoWidth: 1080,
    videoHeight: 1920,
    style: "neon",
  });

  // Render with chosen style
  await ffmpeg.run([
    "-i", segmentPath,
    "-vf", scatteredFilter, // or `ass=${assPath}` for viral captions
    "-c:v", "libx264",
    outputPath,
  ]);
}
```

## UI Integration

Add a new caption style dropdown:

```typescript
// In templates.ts
{
  key: "captionEffect",
  label: "Caption Effect",
  type: "select",
  options: [
    { value: "viral_mrbeast", label: "MrBeast (word highlights)" },
    { value: "viral_hormozi", label: "Hormozi (cyan pop)" },
    { value: "viral_karaoke", label: "Karaoke (color wipe)" },
    { value: "scattered_clean", label: "Scattered - Clean" },
    { value: "scattered_neon", label: "Scattered - Neon" },
    { value: "scattered_pastel", label: "Scattered - Pastel" },
    { value: "scattered_bold", label: "Scattered - Bold" },
    { value: "scattered_handwritten", label: "Scattered - Handwritten" },
    { value: "none", label: "No captions" },
  ],
  default: "viral_mrbeast",
}
```

## Performance Notes

- Each word = one `drawtext` filter
- 100 words = 100 filters chained together
- FFmpeg handles this fine for clips under 60 seconds
- For longer videos (100+ words), use batched mode or split into segments

## Customization

Adjust parameters in `ScatteredWordOptions`:

```typescript
{
  minFontSize: 50,      // smaller = more words fit
  maxFontSize: 120,     // larger = more dramatic
  safeMargin: 80,       // more = words stay away from edges
  rotationRange: 20,    // more = more chaotic (not yet implemented)
}
```

## Collision Detection

The algorithm tries 10 times to find a non-overlapping position for each word. If it can't find one after 10 attempts, it allows overlap (better than failing).

For dense layouts, increase `safeMargin` or reduce `maxFontSize`.

## Future Enhancements

- [ ] Text rotation (requires affine transform filter)
- [ ] Per-word animations (bounce, wiggle, pulse)
- [ ] Grouping related words (noun phrases stay close together)
- [ ] Energy-based font size (louder words = bigger text)
- [ ] Scene-change detection (clear screen between scenes)

## Examples

**Music video aesthetic edit:**
```typescript
style: "neon",
minFontSize: 70,
maxFontSize: 110,
safeMargin: 60,
```

**Soft wholesome vlog:**
```typescript
style: "pastel",
minFontSize: 50,
maxFontSize: 80,
safeMargin: 100,
```

**Bold attention-grabbing:**
```typescript
style: "bold",
minFontSize: 80,
maxFontSize: 120,
safeMargin: 40,
```

## Comparison with Viral Captions

| Feature | Viral Captions (ASS) | Scattered Words |
|---------|---------------------|-----------------|
| Word position | Centered, bottom-third | Random, anywhere |
| Word visibility | Active word only | All words stay |
| Animation | Color change, scale | Fade in |
| Use case | TikTok/Shorts clips | Aesthetic edits |
| Style | MrBeast, Hormozi, etc. | Clean, neon, pastel |
| Complexity | ASS subtitle file | FFmpeg drawtext |

Choose **Viral Captions** for traditional short-form content.
Choose **Scattered Words** for aesthetic music edits and fan videos.
