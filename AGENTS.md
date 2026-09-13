# Crayola — AI Christian Video Clipping Tool
## Agent Briefing

You are an autonomous coding agent working on **Crayola**, a local-first AI video clipping tool built for churches and ministries. Your job is to work through the task queue in `TASKS.md` one task at a time, write clean code, run tests, and commit each completed task.

---

## Stack
- **Runtime:** Bun (not Node, not npm — use `bun` for everything)
- **Frontend:** SolidJS + Vite (`packages/web/`)
- **Backend:** Hono API (`packages/api/`)
- **AI/processing:** `packages/ai/` (TypeScript + Python scripts)
- **Core utils:** `packages/core/` (FFmpeg, ASS captions, DB, templates)
- **DB:** SQLite via Drizzle ORM
- **Styling:** Tailwind CSS

## Key files
- `packages/api/src/index.ts` — all API routes (Hono)
- `packages/web/src/App.tsx` — entire frontend (SolidJS)
- `packages/ai/src/index.ts` — AI functions (TTS, STT, script gen, hook scoring)
- `packages/core/src/templates.ts` — video templates
- `packages/core/src/ffmpeg.ts` — FFmpeg rendering pipeline
- `packages/core/src/db.ts` — Drizzle schema + db instance

## Environment variables (see .env.example)
- `DEEPSEEK_API_KEY` — script generation (can be swapped for any OpenAI-compatible key)
- `DEEPSEEK_API_BASE` — override to use OmniRoute/FreeBuff fallback
- `OPENAI_API_KEY` — fallback for script gen
- `WHISPER_MODEL` — override whisper model (default: medium.en)
- `FFMPEG_PATH` — override ffmpeg binary path

---

## How to work
1. Read `TASKS.md` — find the first task marked `[ ]`
2. Understand what it needs by reading the relevant files first
3. Implement it cleanly — no TODOs, no stubs
4. Run `bun test` to check nothing is broken
5. Mark the task `[x]` in TASKS.md
6. Commit: `git add -A && git commit -m "feat: <task name>"`
7. Move to the next task

## Rules
- Never break existing functionality — read before you change
- Keep the SolidJS frontend reactive (use signals, not direct DOM)
- All API routes go in `packages/api/src/index.ts`
- All AI functions go in `packages/ai/src/`
- FFmpeg operations go in `packages/core/src/ffmpeg.ts`
- New templates go in `packages/core/src/templates.ts`
- If an env var is missing, throw a clear error message — never silently fail
- Commit after every completed task

## Christian/Church context
This tool is for churches. The primary use case is:
1. Pastor uploads a sermon video (YouTube URL or local mp4)
2. AI transcribes it with Whisper
3. AI finds the best 3-7 clips (highlight detection)
4. FFmpeg renders each clip with captions
5. Church posts clips to TikTok/Reels/Shorts

Key terms to understand for clip scoring:
- **Hook moments:** Scripture quotes, personal testimony, altar call, emotional peaks
- **High-value moments:** Short punchy statements, audience reaction, key illustrations
- **Low-value moments:** Long pauses, announcements, worship transitions
