import subprocess
import argparse
import sys
from pathlib import Path
from rich.console import Console
from rich.panel import Panel

import json
from schema import (
    CampaignConfig,
    EditingStyle,
    OverlayStyle,
    Transcript,
    Word,
    Segment,
    Platform,
)
from fetch import is_url, download, extract_audio
from script_gen import generate_script
from ffmpeg_compose import compose_all

console = Console()
OUT_DIR = Path("output")
COUNTER_FILE = OUT_DIR / ".counter"


def get_next_number() -> int:
    """
    Get the next clip number for sequential naming.

    Returns:
        Next number in sequence (1 if no counter exists)
    """
    if COUNTER_FILE.exists():
        return int(COUNTER_FILE.read_text().strip()) + 1
    return 1


def save_number(n: int) -> None:
    """
    Save the last used clip number.

    Args:
        n: Number to save
    """
    OUT_DIR.mkdir(exist_ok=True)
    COUNTER_FILE.write_text(str(n))


def parse_whisper_json(json_path: Path) -> Transcript:
    """
    Parse Whisper JSON output into a Transcript object.

    Args:
        json_path: Path to Whisper JSON output file

    Returns:
        Transcript object with word-level timestamps
    """
    try:
        data = json.loads(json_path.read_text())
    except Exception as e:
        console.print(f"[yellow]Warning: Failed to parse Whisper JSON: {e}")
        return Transcript(text="")

    # Extract text
    text = data.get("text", "")

    # Extract segments with word timestamps
    segments = []
    all_words = []

    for seg in data.get("segments", []):
        seg_text = seg.get("text", "").strip()
        seg_start = seg.get("start", 0.0)
        seg_end = seg.get("end", 0.0)

        # Extract words from segment
        words = []
        for w in seg.get("words", []):
            word = Word(
                text=w.get("word", "").strip(),
                start=w.get("start", 0.0),
                end=w.get("end", 0.0),
                probability=w.get("probability", 1.0),
            )
            if word.text:
                words.append(word)
                all_words.append(word)

        if seg_text:
            segments.append(
                Segment(text=seg_text, start=seg_start, end=seg_end, words=words)
            )

    return Transcript(text=text, segments=segments, words=all_words)


def transcribe(audio_path: str) -> Transcript:
    """
    Transcribe audio to text using Whisper with word-level timestamps.

    Args:
        audio_path: Path to audio file

    Returns:
        Transcript object with word-level timestamps, or empty transcript if failed
    """
    import os
    import shutil

    # Find whisper executable
    whisper_path = shutil.which("whisper")
    if not whisper_path:
        console.print("[yellow]Warning: whisper not found, skipping transcription")
        return Transcript(text="")

    env = os.environ.copy()

    try:
        # Use JSON format for word-level timestamps, also save TXT for reference
        result = subprocess.run(
            [
                whisper_path,
                audio_path,
                "--model",
                "medium",  # Better accuracy than base
                "--output_format",
                "all",  # Saves both JSON and TXT
                "--output_dir",
                str(OUT_DIR),
                "--word_timestamps",
                "True",
            ],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )

        # Check for output JSON file
        json_path = Path(audio_path).with_suffix(".json")
        alt_json_path = OUT_DIR / Path(audio_path).with_suffix(".json").name

        for p in [json_path, alt_json_path]:
            if p.exists():
                transcript = parse_whisper_json(p)
                if transcript.text:
                    # Save a copy of the transcript for easy access
                    txt_path = OUT_DIR / "transcript.txt"
                    txt_path.write_text(transcript.text)
                    console.print(f"   [dim]Transcript saved to {txt_path}")
                    return transcript

        return Transcript(text="")

    except subprocess.CalledProcessError as e:
        console.print(f"[red]Warning: Whisper failed: {e.stderr}")
        return Transcript(text="")
    except Exception as e:
        console.print(f"[red]Warning: Transcription error: {e}")
        return Transcript(text="")


def run(
    source: str,
    transcript: Transcript | None,
    config: CampaignConfig,
    vertical: bool = True,
    enable_zoom: bool = True,
    browser: str = "firefox",
) -> Path:
    """
    Main pipeline execution.

    Args:
        source: VOD URL or local file path
        transcript: Pre-existing transcript with timestamps (optional)
        config: Campaign configuration
        vertical: Output in 9:16 vertical format
        enable_zoom: Enable Ken Burns zoom effect

    Returns:
        Path to output directory
    """
    OUT_DIR.mkdir(exist_ok=True)
    start_num = get_next_number()

    console.print(
        Panel(f"[bold green]Pipeline: {config.streamer_name} — {config.game}")
    )

    # Download VOD if URL provided
    if is_url(source):
        console.print("[cyan]Downloading VOD...")
        try:
            vod = str(download(source, browser=browser))
        except Exception as e:
            console.print(f"[red]Failed to download VOD: {e}")
            return OUT_DIR
    else:
        # Validate local file exists
        if not Path(source).exists():
            console.print(f"[red]Local file not found: {source}")
            return OUT_DIR
        vod = source

    # Transcribe if not provided
    if transcript is None:
        console.print("[cyan]Transcribing...")
        try:
            audio = str(extract_audio(vod))
            transcript = transcribe(audio)
        except Exception as e:
            console.print(f"[red]Failed to extract audio: {e}")
            return OUT_DIR

    if not transcript or not transcript.text:
        console.print("[red]No transcript. Pass --transcript or install whisper.")
        return OUT_DIR

    # Generate script via AI
    console.print("[cyan]Analyzing highlights via DeepSeek...")
    try:
        script = generate_script(transcript, config)
    except Exception as e:
        console.print(f"[red]Failed to generate script: {e}")
        return OUT_DIR

    console.print(f"   Found {len(script.clips)} clips")

    if not script.clips:
        console.print("[yellow]No clips found. Try different settings.")
        return OUT_DIR

    # Compose clips
    for i, clip in enumerate(script.clips):
        num = start_num + i
        console.print(f"[cyan]Composing clip {num}: {clip.title}")

    try:
        paths = compose_all(
            script,
            vod,
            start_num,
            config.overlay_style,
            config.editing_style,
            transcript,
            vertical,
            enable_zoom,
        )
    except Exception as e:
        console.print(f"[red]Failed to compose clips: {e}")
        return OUT_DIR

    for p in paths:
        console.print(f"   [green]✓ {p}")

    # Save progress and caption
    last_num = start_num + len(script.clips) - 1
    save_number(last_num)

    caption_path = OUT_DIR / f"caption_{start_num:03d}-{last_num:03d}.txt"
    caption_path.write_text(
        f"{script.caption}\n\n{' '.join(script.hashtags)}" if script.caption else ""
    )

    console.print(f"\n[bold green]Done! Clips {start_num} to {last_num} in {OUT_DIR}/")
    if script.caption:
        console.print(f"[dim]{script.caption}")

    return OUT_DIR


def main():
    """
    CLI entry point for the clip generator.
    """
    parser = argparse.ArgumentParser(description="Kik Stream Clip Generator")
    parser.add_argument("--vod", help="Kik VOD URL or local file")
    parser.add_argument(
        "--transcript", default=None, help="Transcript file (auto if omitted)"
    )
    parser.add_argument("--streamer", help="Streamer name")
    parser.add_argument("--game", help="Game")
    parser.add_argument("--tone", default="hype", help="hype, chill, funny")
    parser.add_argument("--duration", type=int, default=40, help="Target clip length")
    parser.add_argument("--clips", type=int, default=3, help="Number of clips")

    # Get all available styles from the enum
    available_styles = [s.value for s in OverlayStyle]
    parser.add_argument(
        "--style",
        default="bold",
        choices=available_styles,
        help=f"Overlay text style. Available: {', '.join(available_styles)}",
    )
    parser.add_argument(
        "--horizontal",
        action="store_true",
        help="Output in 16:9 horizontal format (default: 9:16 vertical)",
    )
    parser.add_argument(
        "--no-zoom",
        action="store_true",
        help="Disable Ken Burns zoom effect",
    )
    available_editing_styles = [s.value for s in EditingStyle]
    parser.add_argument(
        "--editing-style",
        default="clean",
        choices=available_editing_styles,
        help=f"Video editing style for effects. Available: {', '.join(available_editing_styles)}",
    )
    parser.add_argument(
        "--list-styles",
        action="store_true",
        help="List all available overlay styles and exit",
    )
    parser.add_argument(
        "--list-editing-styles",
        action="store_true",
        help="List all available editing styles and exit",
    )
    parser.add_argument(
        "--browser",
        default="firefox",
        help="Browser to extract cookies from for Kick downloads (default: firefox)",
    )
    args = parser.parse_args()

    # Handle --list-styles
    if args.list_styles:
        console.print("\n[bold]Available Overlay Styles:[/bold]\n")
        style_descriptions = {
            "bold": "Large white text with black stroke (default)",
            "minimal": "Smaller text, clean look, no stroke",
            "gambling": "Green/gold theme for casino/gambling content",
            "dramatic": "Red/white for intense moments",
            "gaming": "Neon cyan/purple for gaming content",
            "sports": "Bold orange/blue for sports highlights",
            "podcast": "Clean white on dark for podcast clips",
            "reaction": "Fun yellow/pink for reaction videos",
            "news": "Professional blue/white for news clips",
            "viral": "Trendy gradient-style for viral content",
            "horror": "Dark red/black for spooky content",
            "retro": "Pixel-art style green/amber for nostalgia",
            "neon": "Bright neon colors on dark background",
            "pastel": "Soft pastel colors for lifestyle content",
            "fire": "Orange/red gradient for hype moments",
            "ice": "Blue/cyan for cool/calm moments",
            "gold": "Premium gold/black for luxury content",
        }
        for style in OverlayStyle:
            desc = style_descriptions.get(style.value, "")
            console.print(f"  [cyan]{style.value:12}[/cyan] - {desc}")
        console.print()
        sys.exit(0)

    # Handle --list-editing-styles
    if args.list_editing_styles:
        console.print("\n[bold]Available Editing Styles:[/bold]\n")
        editing_descriptions = {
            "none": "No post-processing effects",
            "minimal": "No effects, clean output",
            "clean": "Subtle grade, sharpen, no grain",
            "cinematic": "S-curve contrast, warm tones, vignette, subtle grain",
            "dramatic": "High contrast, desaturated, heavy vignette",
            "film": "Film emulation: S-curve, grain, letterbox feel",
            "viral_hype": "High contrast, saturated, sharpened",
            "gaming": "Neon boost, high saturation, edge enhancement",
            "retro": "VHS look: color shift, grain, soft focus",
            "sports": "High contrast, saturated, sharp",
            "podcast": "Warm tones, subtle grain, clean",
            "reaction": "Bright, saturated, energetic",
            "dark": "Desaturated, high contrast, moody",
            "vintage": "Faded, warm, grain, light leak feel",
            "neon": "High saturation, color boost, glow feel",
        }
        for style in EditingStyle:
            desc = editing_descriptions.get(style.value, "")
            console.print(f"  [cyan]{style.value:12}[/cyan] - {desc}")
        console.print()
        sys.exit(0)

    # Validate required arguments
    if not args.vod or not args.streamer or not args.game:
        parser.error(
            "--vod, --streamer, and --game are required (except with --list-styles)"
        )

    # Load transcript from file if provided
    transcript = None
    if args.transcript:
        try:
            transcript_path = Path(args.transcript)
            # Check if it's a JSON file (with timestamps) or plain text
            if transcript_path.suffix == ".json":
                transcript = parse_whisper_json(transcript_path)
            else:
                # Plain text transcript - wrap in Transcript object
                text = transcript_path.read_text()
                transcript = Transcript(text=text)
        except Exception as e:
            console.print(f"[red]Failed to read transcript file: {e}")
            sys.exit(1)

    # Create campaign config
    config = CampaignConfig(
        streamer_name=args.streamer,
        game=args.game,
        tone=args.tone,
        target_duration=args.duration,
        max_clips=args.clips,
        overlay_style=OverlayStyle(args.style),
        editing_style=EditingStyle(args.editing_style),
    )

    vertical = not args.horizontal
    enable_zoom = not args.no_zoom
    run(args.vod, transcript, config, vertical, enable_zoom, args.browser)


if __name__ == "__main__":
    main()
