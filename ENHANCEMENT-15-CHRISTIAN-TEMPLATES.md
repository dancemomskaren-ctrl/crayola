# Enhancement 15: Christian Clipping Agency Templates

## Overview
15 specialized templates + 5 faith-coded caption styles for church/ministry social media content.

## 🎨 Christian Caption Styles (5 new styles)

1. **holy_glow** - Reverent white text with soft golden glow
   - Use for: sermon highlights, scripture quotes, pastoral messages
   - Font: Arial 54pt, white with gold outline/shadow

2. **cross_bold** - Strong black text with white cross outline  
   - Use for: altar calls, salvation messages, bold declarations
   - Font: Arial Black 58pt, high contrast

3. **worship_purple** - Regal purple for praise content
   - Use for: worship lyrics, testimonies, celebration clips
   - Font: Georgia 52pt italic, purple tones

4. **scripture_serif** - Traditional serif for Bible verses
   - Use for: verse overlays, devotionals, teaching moments
   - Font: Times New Roman 48pt, cream/brown

5. **fire_revival** - Bold orange/red for passion messages
   - Use for: revival content, youth ministry, high-energy preaching
   - Font: Impact 60pt, red/orange gradient

## 📋 15 Christian Templates

### 1. Sunday Sermon Highlights ⛪
- **Input:** Full YouTube sermon
- **Output:** 3-5 powerful 20-60s clips with scripture overlays
- **Caption Style:** holy_glow
- **Fields:** sermon URL, title, pastor name, key scriptures

### 2. Testimony Story 🙏
- **Input:** Personal testimony video
- **Output:** Emotional hook + transformation + CTA (30-90s)
- **Caption Style:** worship_purple
- **Fields:** video URL, hook text, call-to-action

### 3. Worship Lyrics Video 🎵
- **Input:** Worship song audio + lyrics
- **Output:** Synchronized animated lyrics with aesthetic background
- **Caption Style:** worship_purple
- **Fields:** audio, song title, artist, lyrics

### 4. Bible Verse Animation 📖
- **Input:** Single scripture text
- **Output:** Cinematic 8s verse overlay (4 background themes)
- **Caption Style:** scripture_serif
- **Backgrounds:** nature, cross sunset, church interior, abstract light

### 5. Prayer Request 🤲
- **Input:** Prayer text
- **Output:** Community prayer invitation with soft music (10s)
- **Caption Style:** holy_glow
- **Background:** candle/prayer imagery

### 6. Daily/Weekly Devotional ☀️
- **Input:** Short teaching video
- **Output:** Verse + application + prayer (45-90s)
- **Caption Style:** cross_bold
- **Fields:** video URL, title, key verse

### 7. Altar Call / Salvation ✝️
- **Input:** Gospel presentation
- **Output:** Powerful 60-120s call to accept Christ
- **Caption Style:** fire_revival
- **Fields:** message URL, end CTA

### 8. Kids Ministry Clip 👶
- **Input:** Children's lesson video
- **Output:** 3 colorful, upbeat 15-45s clips
- **Caption Style:** colorful
- **Fields:** video URL, lesson title (e.g. "David and Goliath")

### 9. Youth Group Hype 🔥
- **Input:** Youth event video
- **Output:** 5 high-energy 10-30s clips
- **Caption Style:** fire_revival
- **Features:** fast transitions, modern style, peer-focused

### 10. Baptism Announcement 💧
- **Input:** Baptism celebration video
- **Output:** Joyful 20-60s clip + next baptism date
- **Caption Style:** worship_purple
- **Fields:** video URL, next baptism date

### 11. Mission Trip Recap 🌍
- **Input:** Mission photos/video
- **Output:** 60s impact story montage
- **Caption Style:** cross_bold
- **Fields:** photos, location, impact stats (e.g. "200 fed, 50 saved")

### 12. Church Event Promo 📅
- **Input:** Event details
- **Output:** 15s announcement (date, time, location, reg link)
- **Caption Style:** cross_bold
- **Platform:** 1:1 (Instagram feed)

### 13. Pastor's Weekly Word 👔
- **Input:** Pastor greeting/encouragement video
- **Output:** Personal 30-90s message with face tracking
- **Caption Style:** minimal
- **Features:** builds trust, conversational tone

### 14. Prophetic Word ⚡
- **Input:** Prophetic message video
- **Output:** Reverent 45-120s clip with scripture backing
- **Caption Style:** fire_revival
- **Fields:** message URL, speaker name, supporting verses

### 15. Christmas/Easter Special 🎄
- **Input:** Holiday service video
- **Output:** 5 celebratory 20-60s clips (share-worthy)
- **Caption Style:** holy_glow
- **Holiday Options:** Christmas, Easter, Pentecost, Good Friday

## 🎯 Agency-Specific Features

All templates support:
- **Scripture overlays** (automated verse references)
- **Worship music** (ambient/energetic background tracks)
- **Pastor attribution** (custom branding per church)
- **Face tracking** (auto-reframe for 9:16)
- **Emotion detection** (highlight passionate moments)
- **Batch processing** (10 sermons → 50 clips overnight)
- **Multi-platform publish** (TikTok, YouTube, Instagram, Facebook)

## 📦 File Locations

- Caption styles: `packages/core/src/ass.ts` (merged into DEFAULT_STYLES)
- Templates: `packages/core/src/templates.ts` (CHRISTIAN_TEMPLATES array, merged into main TEMPLATES)
- Christian caption types: `packages/core/src/christian-captions.ts` (reference file)

## 🚀 Usage

Templates appear in the web UI under a new **"Ministry"** category. Each template is optimized for:
- Mega churches (high-volume sermon clipping)
- Youth/kids ministries (age-appropriate styles)
- Mission organizations (impact storytelling)
- Christian creators (testimony/devotional content)

## 💡 Competitive Edge

**vs Crayo:**
- Crayo has 0 Christian-specific templates
- You have 15 + faith-coded language
- You understand sermon structure (altar calls, testimonies, scripture overlays)
- You can batch-process Sunday services for an entire month

**Pricing advantage:**
- Crayo: $19-79/mo for generic templates
- You: self-hosted, unlimited, Christian-optimized

This makes Crayola the **only AI clipping tool purpose-built for churches and Christian creators**.
