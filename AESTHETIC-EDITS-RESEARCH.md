# Aesthetic Edits & Music Sync — Research Summary

## What We Found

### 1. **BeatSync-Engine** (AGPL-3.0)
**GitHub:** https://github.com/Merserk/BeatSync-Engine

**What it does:**
- Automatic beat-synced AMV/GMV/music video editing
- Detects beat grid, energy waves, song structure
- Scans source videos for motion, quality, scene changes
- Uses Qwen3-VL for semantic scene matching (action, combat, beauty, emotion)
- GPU-accelerated (CUDA + llama.cpp Vulkan + NVENC)
- Portable Windows app with Gradio UI

**Key Features:**
- Energy-wave cut density (calm = long cuts, drops = fast cuts)
- Song structure detection (intro, verse, chorus, bridge, drop, build, outro)
- Rhythm feature analysis (kick, clap, bass, hi-hat, novelty, impact)
- Source moment library (motion, quality, action, beauty)
- Frame-locked timeline (no timing drift)

**Tech Stack:**
- Python + Gradio UI
- librosa for audio analysis
- FFmpeg for video processing
- CuPy for CUDA acceleration
- llama.cpp Vulkan for Qwen3-VL vision tagging

**License:** AGPL-3.0 (viral copyleft — if we use it, Crayola must be open-source too)

---

### 2. **StemSyncVideoEditor** (MIT)
**GitHub:** https://github.com/vrgamegirl19/StemSyncVideoEditor

**What it does:**
- Automatic music video editing from audio stems
- Cuts only on beats, switches cameras based on stem energy
- Works with live footage, studio sessions, OR AI-generated visuals
- Supports B-roll injection

**Key Features:**
- Beat detection + onset analysis
- Energy per stem drives camera selection
- Chorus cuts faster than verses
- Camera cooldown prevents rapid reuse
- Works with multi-camera live recordings or AI-gen video

**Workflow:**
- Vocals stem → singer-focused shots
- Drums stem → drummer angles
- Guitar/bass stem → instrument shots
- Free clips (B-roll) injected on beat

**Tech Stack:**
- Python + Gradio UI
- librosa for beat detection
- FFmpeg for rendering

**License:** MIT (permissive — can integrate freely)

---

### 3. **Kinetic Studio** (MIT)
**GitHub:** https://github.com/udaykirancodes/kinetic-studio

**What it does:**
- Text-to-video kinetic typography generator
- Each word becomes a frame
- Frame-by-frame control for timing
- Real-time preview with audio sync

**Key Features:**
- Transform text scripts into cinematic kinetic typography
- Edit every word, adjust duration, split phrases
- Customize each frame with colors/contrasts
- No waiting, no rendering (Remotion-powered)

**Tech Stack:**
- Next.js 15 (App Router)
- Remotion for video generation
- Motion (Framer Motion) for animation
- Zustand for state management

**License:** MIT

---

### 4. **remotion-bits**
**GitHub:** https://github.com/av/remotion-bits

**What it does:**
- Ready-made animated components for Remotion
- Reusable motion graphics bits (AnimatedText, GradientTransition, 3D cards, etc.)

**License:** MIT

---

## Missing: The "Scattered Words" Effect

**What we're looking for:**
- Each word appears at a **random position** on screen as it's spoken
- All words **stay visible** until the next clip/scene change
- No background, just clean white text
- Popular in fan edits, aesthetic compilations, TikTok edits

**Similar to:**
- Kinetic typography but with persistent accumulation
- NOT traditional captions (not synchronized lines)
- Each word is its own independent element with random placement

**How to build it:**

### Option A: FFmpeg drawtext (simpler, no dependencies)
```
For each word:
1. Get word timestamp from Whisper
2. Generate random (x, y) position within safe zone
3. Add drawtext filter with enable='gte(t,{startSec})'
   (stays visible from startSec until end of video)
```

### Option B: Remotion (richer, requires Node/React)
```
1. Create Remotion composition
2. Map words to <AbsoluteFill> positioned elements
3. Each word has opacity animation (fade in at timestamp)
4. All words persist until video end
5. Render via @remotion/renderer
```

---

## What We Should Build

### Phase 1: Beat-Synced Editing (Priority 1)
Integrate **StemSyncVideoEditor** logic (MIT licensed) into Crayola:

**Features to add:**
1. **Beat detection** — analyze audio track, find beat grid
2. **Auto-cut on beats** — slice source video to rhythm
3. **Energy-based pacing** — fast cuts on drops, slow cuts on verses
4. **Multi-clip support** — switch between source clips based on audio energy
5. **B-roll injection** — insert random clips on beat

**Use cases:**
- Music video generation from long footage
- Aesthetic edits with music sync
- AMV/GMV creation
- CapCut-style templates

**Implementation:**
- Add `librosa` to AI package for beat detection
- New template: "Music Edit" (🎵 icon)
- UI: upload audio + 2-4 source videos
- Backend: analyze beats, generate cut timeline, ffmpeg render

---

### Phase 2: Scattered Word Captions (Priority 2)
Build the kinetic scattered-word effect:

**Features:**
1. Each word appears at random (x, y) position
2. Words fade in as spoken (word-level Whisper timestamps)
3. All words stay visible until clip end
4. Optional: slight rotation, scale variation per word
5. Style presets: clean white, neon glow, pastel, bold

**Implementation:**
- New caption style: "scattered" (alongside viral styles)
- Generate random positions avoiding overlap
- Build ffmpeg drawtext chain or Remotion composition
- UI toggle: "Scattered mode" vs "Stacked mode"

---

### Phase 3: Scene-Aware Editing (Priority 3)
Adapt **BeatSync-Engine** logic (if we can work around AGPL):

**Features:**
1. **Scene analysis** — detect motion, quality, scene changes in source clips
2. **Semantic tagging** — action, beauty, emotion, energy (via vision model)
3. **Smart clip selection** — match video energy to audio energy
4. **Song structure detection** — intro/verse/chorus awareness

**Challenges:**
- AGPL license (can't integrate without making Crayola open-source)
- Could re-implement the concepts independently (reverse-engineering is legal)
- Or run BeatSync as separate microservice

---

## Recommended Next Steps

1. ✅ **Finish viral captions + AI hooks** (already in progress)
2. **Add scattered-word effect** (FFmpeg drawtext approach, 1-2 hours)
3. **Integrate beat detection** (librosa + StemSyncVideoEditor logic, 4-6 hours)
4. **Build "Music Edit" template** (UI + backend wiring, 2-3 hours)
5. **Test with real aesthetic edit workflow** (your own test clips)

---

## Tools Comparison

| Feature | BeatSync | StemSync | Kinetic Studio | Crayola (current) |
|---------|----------|----------|----------------|-------------------|
| Beat detection | ✅ | ✅ | ❌ | ❌ |
| Auto-cut on beat | ✅ | ✅ | ❌ | ❌ |
| Energy-based pacing | ✅ | ✅ | ❌ | ❌ |
| Multi-camera switching | ✅ | ✅ | ❌ | ❌ |
| Scene analysis | ✅ (AI) | ❌ | ❌ | ❌ |
| B-roll injection | ✅ | ✅ | ❌ | ❌ |
| Kinetic typography | ❌ | ❌ | ✅ | ❌ |
| Word-by-word captions | ❌ | ❌ | ❌ | ✅ (new) |
| Scattered-word effect | ❌ | ❌ | ❌ | ❌ (need to build) |
| Viral caption styles | ❌ | ❌ | ❌ | ✅ (17 styles) |
| AI hooks | ❌ | ❌ | ❌ | ✅ (new) |
| License | AGPL | MIT | MIT | Proprietary |

---

## Credits

- **BeatSync-Engine** by Merserk (AGPL-3.0)
- **StemSyncVideoEditor** by vrgamegirl19 (MIT)
- **Kinetic Studio** by udaykirancodes (MIT)
- **remotion-bits** by av (MIT)
