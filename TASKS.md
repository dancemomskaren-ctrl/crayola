# Crayola Task Queue
Work through these in order. One task at a time. Commit after each.

---

## PHASE 1 — Church Clipping Core (do these first)

- [ ] **sermon-scoring-v2:** Rewrite `detectHighlights()` in `packages/ai/src/index.ts` to score clips using church-specific signals: scripture references (book names, chapter:verse patterns), altar call language ("come forward", "repeat after me", "raise your hand"), testimony language ("I was", "God healed", "before I knew Christ"), and emotional peaks (audience laughter/applause markers in transcript). Weight these higher than generic hook words.

- [x] **christian-clip-titles:** In `packages/ai/src/index.ts`, add `generateChristianClipTitle(text: string, apiKey: string, apiBase: string): Promise<string>` that uses the LLM to generate a short viral-ready clip title for church social media (e.g. "Pastor's 30-second testimony will wreck you 😭"). Wire it up in the `/api/auto-clip` route so each clip gets a `suggestedTitle`.

- [x] **sermon-template-upgrade:** In `packages/core/src/templates.ts`, add 3 new sermon clip caption styles: `"scripture"` (bold gold text, dark bg, reference shown below), `"testimony"` (handwritten-feel font, warm tone), `"altar-call"` (urgent red/white, pulsing animation class). Add these as options to the sermon_clip template fields.

- [x] **church-branding-watermark:** Add a watermark/logo overlay to rendered sermon clips. API route: `POST /api/clients/:id/branding` accepts `{ logoUrl: string, position: "top-left"|"top-right"|"bottom-left"|"bottom-right", opacity: number }`. Store in client DB record. Apply watermark in FFmpeg render pipeline when client has branding set.

- [x] **multi-clip-export:** After auto-clip runs, add a "Download All as ZIP" button in the UI (`packages/web/src/App.tsx`). Backend: `GET /api/renders/batch/:batchId/zip` — use `archiver` or shell `zip` to bundle all clips in a batch into a single download.

---

## PHASE 2 — Autonomous Research Agent

- [ ] **competitor-scraper:** Create `scripts/research-competitors.ts`. It should fetch and parse these URLs: https://opus.pro, https://descript.com, https://submagic.co — extract feature lists, pricing, and any mention of "church" or "sermon". Save results to `data/research/competitors-<date>.json`. Run with `bun scripts/research-competitors.ts`.

- [ ] **trending-church-content:** Create `scripts/research-trends.ts`. Use YouTube RSS feeds (no API key needed) to pull top 20 trending videos from church channels: https://www.youtube.com/@TD_Jakes, https://www.youtube.com/@StevenFurtick, https://www.youtube.com/@elevation_church. Extract video titles, view counts, and description snippets. Save to `data/research/church-trends-<date>.json`.

- [ ] **research-brief-generator:** Create `scripts/generate-brief.ts`. Reads the latest competitor + trends JSON files, sends them to the LLM (using `DEEPSEEK_API_KEY`), and asks: "Based on this research, what are the top 5 features Crayola should build next to win against these competitors for the church market?" Save the response to `data/research/brief-<date>.md` and print it to stdout.

---

## PHASE 3 — UI/UX Polish (ministry-focused)

- [ ] **onboarding-flow:** Add a first-run setup wizard to the web UI. If no `.env` file exists or `DEEPSEEK_API_KEY` is not set, show a modal on app load: "Welcome to Crayola — paste your API key to get started". Store it in localStorage and pass it via a header to the API. API should accept `X-API-Key` header as fallback to env var.

- [ ] **church-landing-redesign:** Redesign the top section of `App.tsx`. Replace the current generic header with: ministry-focused headline ("Turn Sunday's Sermon into a Week of Content"), a simple 3-step visual ("Upload → AI Clips → Download"), and a subtle cross/church icon in the brand color. Keep it clean, not cheesy.

- [ ] **clip-preview-player:** In the auto-clip results section, add an inline video preview that plays a 5-second preview of the clip on hover (already partially wired — finish it for all clip types, not just sermon_clip).

- [ ] **pastor-mode:** Add a "Pastor Mode" toggle in settings (stored in localStorage). When on: larger font sizes throughout the UI, simplified template names ("Sermon Clip" instead of "auto_clip"), hidden advanced options, and a big "Upload Sermon" button as the primary CTA.

---

## PHASE 4 — Robustness & Performance

- [ ] **error-recovery:** Wrap all FFmpeg calls in `packages/core/src/ffmpeg.ts` with retry logic (3 attempts, exponential backoff). Add a `data/logs/render-errors.log` file that captures failed renders with timestamp, error message, and input file path.

- [ ] **queue-system:** Add a simple job queue using SQLite. New table `job_queue` with columns: `id, type, payload, status, created_at, started_at, completed_at, error`. API route `POST /api/jobs` adds jobs. Background worker in `packages/api/src/index.ts` polls the queue every 5 seconds and processes one job at a time. This prevents multiple simultaneous FFmpeg processes from killing the Mac.

- [ ] **storage-cleanup:** Add `GET /api/storage/stats` returning total disk usage of `data/renders`, `data/uploads`, `data/delivery`. Add `DELETE /api/storage/cleanup` that deletes renders older than 30 days. Add a storage bar to the UI showing "X GB used" with a "Clean up old files" button.

- [ ] **health-check-dashboard:** Add `GET /api/health/full` that checks: FFmpeg installed, Whisper/faster-whisper installed, Python3 available, disk space > 1GB free, API key set. Return JSON with pass/fail for each. Show a status bar in the UI header with green/red dots per dependency.

---

## PHASE 5 — SaaS Prep

- [ ] **usage-tracking:** Add a `usage_log` table to SQLite. Log every render with: client_id, template_type, duration_seconds, render_time_ms, timestamp. Add `GET /api/usage/report` that returns total renders per client per month.

- [ ] **pricing-tiers:** Add a `tier` field to the clients table: `"free"` (5 clips/month), `"starter"` ($29/mo, 50 clips), `"pro"` ($79/mo, unlimited). Enforce clip limits in the render pipeline — return a 402 error with a friendly message when a free client hits 5 clips.

- [ ] **export-for-upload:** After render completes, add a "Copy Caption" button next to each clip download. Pre-fills a caption template: "[Clip title] 🙏 [auto-generated hashtags from transcript keywords] #church #sermon #faith #[pastor name if detected]". Let user edit before copying.
