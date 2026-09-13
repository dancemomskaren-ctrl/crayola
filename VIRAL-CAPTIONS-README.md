# Viral Captions + AI Hooks — Implementation Summary

## What We Built

### 1. **17 Viral Caption Styles** (adapted from nicolaigaina/ai-video-captions, MIT licensed)
Located in: `packages/core/src/viral-captions.ts`

**Original 6 Styles:**
- **Hormozi** — Bold cyan highlights (business & motivation)
- **MrBeast** — Yellow with orange highlights (gaming & entertainment)
- **Karaoke** — Color wipe animation (music & sing-alongs)
- **Minimal** — Subtle scaling (professional & clean)
- **Bounce** — Playful bounce animation (fun & energetic)
- **Classic** — Traditional yellow highlights (viral & attention-grabbing)

**New 11 Extended Styles (2026 Trending):**
- **Neon Glow** — Magenta/cyan electric (gaming & tech)
- **Retro Wave** — 80s vaporwave pink/blue (nostalgic & aesthetic)
- **Luxury Gold** — Premium gold text (luxury & finance)
- **Streetwear** — Bold red/yellow street style (fashion & culture)
- **Comic Book** — Black text with white outline (comedy & reactions)
- **Corporate Clean** — Professional blue-grey (business & education)
- **Horror Glitch** — Dark red distorted (horror & thriller)
- **Soft Pastel** — Light pink/lavender (lifestyle & wellness)
- **Fire Bars** — Orange-red hot takes (rants & opinions)
- **Ice Cold** — Frosty blue (chill & calm)
- **Matrix Code** — Green on black hacker style (tech & hacking)

Each style includes:
- Word-by-word animation (highlight, karaoke, scale, bounce)
- Custom fonts, colors, outlines, shadows
- ASS subtitle format for ffmpeg rendering

### 2. **AI Hook Generator**
Located in: `packages/ai/src/hooks.ts`

Generates viral TikTok-style hooks from transcript snippets using an LLM (OpenAI-compatible API).

**Features:**
- 4 hook styles: curiosity, bold, question, story
- 7-word max (configurable)
- Falls back to first sentence if no API key set
- Examples: "This Changed Everything For Me", "Why I Quit My 6-Figure Job"

**Requirements:**
- Set `OPENAI_API_KEY` env var (or `OPENAI_BASE_URL` for custom endpoint)
- Uses `gpt-4o-mini` by default (configurable via `OPENAI_MODEL`)

## How To Use

### In Auto-Clip Endpoint

```typescript
import { generateViralASS, VIRAL_STYLES } from "@crayo/core";
import { generateHook } from "@crayo/ai";

// 1. Get word-level captions from Whisper (already done)
const result = await autoClip({ url, clipCount: 5 });

// 2. Generate AI hook for each clip
for (const clip of result.clips) {
  const hook = await generateHook({
    transcript: clip.text,
    maxWords: 7,
    style: "curiosity",
  });
  clip.suggestedTitle = hook; // Replace default title
}

// 3. Generate viral ASS captions
const assPath = `/tmp/${clip.id}.ass`;
const assContent = generateViralASS(
  clip.captions, // word-level timestamps
  "mrbeast", // or any style from VIRAL_STYLES
  1080, // video width
  1920, // video height
  10, // position from bottom (%)
);
writeFileSync(assPath, assContent);

// 4. Burn captions into video
await ffmpeg.run([
  "-i", inputVideo,
  "-vf", `ass=${assPath}`,
  "-c:v", "libx264",
  outputVideo,
]);
```

### Available Styles

```typescript
Object.keys(VIRAL_STYLES);
// Returns: ["hormozi", "mrbeast", "karaoke", "minimal", "bounce", "classic", 
//           "neon", "retro", "luxury", "streetwear", "comic", "corporate",
//           "horror", "pastel", "fire", "iced", "matrix"]
```

## Next Steps

1. **Wire into endpoints** — Replace old ASS generation with `generateViralASS()`
2. **Add UI controls** — Dropdown for style selection in web UI
3. **Test fonts** — Install missing fonts (Montserrat, Bebas Neue, Bangers, etc.) on server
4. **Hook toggle** — Add "Auto-generate hooks" checkbox in UI (default: on)

## Font Requirements

Some styles require specific fonts. Install via:

```bash
# Debian/Ubuntu
sudo apt-get install -y fonts-montserrat fonts-bebas-neue fonts-quicksand

# Or download from Google Fonts
```

Fallback fonts are configured for each style if primary font is missing.

## Credits

Viral caption styles adapted from [nicolaigaina/ai-video-captions](https://github.com/nicolaigaina/ai-video-captions) (MIT License)
