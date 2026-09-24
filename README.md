# Crayola — human-reviewed sermon clips

Crayola is a local development application for finding excerpts in sermon videos, reviewing their context, and rendering captioned clips. It is not yet a hosted, multi-customer SaaS.

## Main workflow

1. Choose an available sermon, podcast, or auto-clip template.
2. Upload a local video or enter a supported HTTPS video URL.
3. Analysis transcribes the source once and proposes excerpts.
4. Review the surrounding transcript and listen to the source. Select excerpts, adjust their boundaries, and correct captions if needed.
5. Confirm your review and render. Download individual MP4s or a ZIP.

Excerpt scoring is heuristic. Human review is required; the software does not certify theological accuracy. Automatic publishing is unavailable. Download and post clips manually.

## Run locally

Prerequisites: Bun, FFmpeg (with libass), Python 3, and Whisper. URL downloads also need yt-dlp. Optional face tracking needs OpenCV; without it the clipping worker warns and uses a centered crop. Some older generation tools use external services and API keys.

From the project directory:

```bash
bun install
bun run dev
```

Open http://localhost:3000. The API listens at 127.0.0.1:3001. Both servers are intended for local use. Keep existing environment settings and media folders when updating.

For Python dependencies, use your preferred Python environment and ensure its executable directory is on PATH before starting Crayola. The original setup.sh is a convenience script; inspect its installation steps before using it.

Optional environment variables:

- `WHISPER_MODEL`: transcription model override.
- `WHISPER_PATH`, `YTDLP_PATH`, `FFMPEG_PATH`: executable overrides.
- `CRAYO_API_KEY`: require a local shared key; the browser asks for it on entry.
- `CRAYO_DATA_DIR`: alternative database/media directory.
- `DEEPSEEK_API_KEY`, `DEEPSEEK_API_BASE`, `OPENAI_API_KEY`: legacy script-generation configuration.

## Reliability and limits

Clip batches are persisted in SQLite. Analysis pauses for approval. Interrupted renders can be retried, and partial retries preserve successful outputs. Finished batch working files are cleaned up; uploaded source videos are retained. Failed/review batches can be discarded. Export ZIPs contain successful clips only.

Unsupported templates are hidden rather than generating placeholder video. Advanced modules remaining in the repository are not all production-validated. This repair does not add billing, customer isolation, a hosted worker system, or platform publishing.

## Verification

```bash
bun run typecheck
bun run test
bun run --filter @crayo/web build
```

Tests use synthetic media and a deterministic transcription fixture for the API workflow, with actual FFmpeg rendering. Live speech/model tests require `CRAYO_LIVE_TESTS=1` and their external dependencies. Run a real sermon through the complete workflow on your Mac before using it for customer delivery.
