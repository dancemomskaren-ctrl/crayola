# Crayola — AI Christian Video Clipping Tool
## Agent Briefing

You are an autonomous coding agent working on Crayola, a local-first AI video clipping tool built for churches and ministries. Your job is to work through the task queue in TASKS.md one task at a time, verify every change with real commands, and commit each completed task.

---

## Stack
- Runtime: Bun (not Node, not npm — use bun for everything)
- Frontend: SolidJS + Vite (`packages/web/`)
- Backend: Hono API (`packages/api/`)
- AI/processing: packages/ai/ (TypeScript + Python scripts)
- Core utils: packages/core/ (FFmpeg, ASS captions, DB, templates)
- DB: SQLite via Drizzle ORM
- Styling: Tailwind CSS

## Key files
- packages/api/src/index.ts — API routes (Hono)
- packages/api/src/local-safety.ts — localhost guard, CORS allowlist, path validation
- packages/api/src/clip-worker.ts — clip queue, job recovery, cleanup
- packages/web/src/App.tsx — main frontend (SolidJS)
- packages/web/src/ClipReview.tsx — clip review UI
- packages/ai/src/index.ts — AI functions (TTS, STT, script gen, hook scoring)
- packages/core/src/templates.ts — video templates
- packages/core/src/ffmpeg.ts — FFmpeg rendering pipeline
- packages/core/src/christian-captions.ts — ASS caption generation
- packages/core/src/db.ts — Drizzle schema + db instance

## Environment variables (see .env.example)
- DEEPSEEK_API_KEY — script generation (can be swapped for any OpenAI-compatible key)
- DEEPSEEK_API_BASE — override to use OmniRoute/FreeBuff fallback
- OPENAI_API_KEY — fallback for script gen
- WHISPER_MODEL — override whisper model (default: medium.en)
- FFMPEG_PATH — override ffmpeg binary path

  **REQUIRED on this machine, and it must be set in the SHELL, not in a root `.env`.**

  Homebrew's default `ffmpeg` is a lite build compiled without `--enable-libass`,
  so the `ass=` / `subtitles=` / `drawtext` filters do not exist and every render
  fails with exit 8, "Error opening output files: Filter not found".

  A root-level `.env` does NOT work: `bun run --filter '*' test` executes each
  package with its own working directory, so the root `.env` is never loaded for
  `packages/api` or `packages/core` (verified — root sees it, packages get
  `undefined`). Set it in your shell instead:

      echo 'export FFMPEG_PATH="/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"' >> ~/.zshrc
      source ~/.zshrc

  Installed via `brew install ffmpeg-full` (the default `ffmpeg` formula has no
  libass). Verify any new machine — including a server or container deploy — with:

      ffmpeg -hide_banner -filters | grep -E "ass|subtitles|drawtext"

  If that returns nothing, rendering will fail there too, for the same reason.

---

## Verify before you claim — the prime rule

Facts come from exit codes, not from your own description of your work.

Run these and read the **exit code**:

- `bun run test` — **not** `bun test`. The root script is `bun run --filter '*' test`. `bun test` alone bypasses per-package setup and can look green while the real suite is broken.
- `bun run typecheck`
- `bun run build`

If any of them fails, the task is **not** done. A confident summary over a failing command is a failure. Report it as a failure.

## How to work
1. Read TASKS.md — find the first task marked `[ ]`
2. Read the relevant files before changing anything
3. Implement it cleanly — no TODOs, no stubs
4. Verify: `bun run typecheck`, then `bun run test`. Both must exit 0.
5. Green → mark the task `[x]` in TASKS.md and commit
6. Red → fix once in the same lane, then verify again
7. Two verified failures on one task → STOP. Do not start the next task. Write the blocker into TASKS.md and summarize.

## Committing — never use `git add -A`

This repo contains other git repos and local scratch directories (`.github-tools/`, `.crayola-backups/`, `.freebuff/`, `.obsidian/`). `git add -A` will commit them.

Stage explicitly:

    git add README.md TASKS.md AGENTS.md .gitignore packages/
    git status --short      # confirm what you staged BEFORE committing
    git commit -m "feat: <task name>"

Never commit with a failing check. Never mark a task done without a passing verification run **in this session**. Never delete, skip, or weaken a failing test to make the suite green.

## Model lane

Work on the default cheap lane. Model selection is a CLI-level flag, not something this file can change mid-run. If a task has failed verification twice, **stop and report** — a human decides whether to escalate to a stronger model. Do not keep retrying the same failure, and do not silently escalate.

## Stop and summarize when
- two verified failures on one task
- a missing env var, broken dependency, or unclear spec
- `df -h /System/Volumes/Data` shows under 5GB free — Codex dies with `os error 28` on a full disk
- all tasks are done

The summary must state: what was completed and committed, what remains, and exactly why it stopped. No hedging, no "should be working".

## Rules
- Never break existing functionality — read before you change
- Keep the SolidJS frontend reactive (use signals, not direct DOM)
- API routes go in packages/api/src/index.ts or a module it imports
- AI functions go in packages/ai/src/
- FFmpeg operations go in packages/core/src/ffmpeg.ts
- New templates go in packages/core/src/templates.ts
- If an env var is missing, throw a clear error message — never silently fail
- The API is local-only by default: it binds to localhost and rejects non-local hosts and origins. Do not weaken the guard in packages/api/src/local-safety.ts without being explicitly asked.

## Christian/Church context
This tool is for churches. The primary use case is:
1. Pastor uploads a sermon video (YouTube URL or local mp4)
2. AI transcribes it with Whisper
3. AI finds the best 3-7 clips (highlight detection)
4. FFmpeg renders each clip with captions
5. Church posts clips to TikTok/Reels/Shorts

Key terms to understand for clip scoring:
- Hook moments: Scripture quotes, personal testimony, altar call, emotional peaks
- High-value moments: Short punchy statements, audience reaction, key illustrations
- Low-value moments: Long pauses, announcements, worship transitions
