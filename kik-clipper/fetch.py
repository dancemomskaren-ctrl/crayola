import subprocess
import shutil
import time
from pathlib import Path
from typing import Optional

OUT_DIR = Path("output")

# Maximum number of retry attempts for network operations
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds between retries


def find_ffmpeg() -> str:
    """
    Find the ffmpeg binary path dynamically.
    Checks common locations and falls back to system PATH.

    Returns:
        Path to ffmpeg binary

    Raises:
        FileNotFoundError: If ffmpeg is not found
    """
    # Check common installation paths
    common_paths = [
        "/opt/homebrew/bin/ffmpeg",  # macOS Homebrew (Apple Silicon)
        "/usr/local/bin/ffmpeg",  # macOS Homebrew (Intel) or Linux
        "/usr/bin/ffmpeg",  # System ffmpeg
    ]

    for path in common_paths:
        if Path(path).exists():
            return path

    # Fall back to shutil.which to search PATH
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path

    raise FileNotFoundError(
        "ffmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
    )


def is_url(source: str) -> bool:
    """Check if source is a URL (http/https) or local file path."""
    return source.startswith("http://") or source.startswith("https://")


def run_with_retry(
    cmd: list[str], description: str, max_retries: int = MAX_RETRIES
) -> subprocess.CompletedProcess:
    """
    Execute a subprocess command with retry logic for transient failures.

    Args:
        cmd: Command and arguments to execute
        description: Human-readable description for error messages
        max_retries: Maximum number of retry attempts

    Returns:
        CompletedProcess instance

    Raises:
        subprocess.CalledProcessError: If command fails after all retries
    """
    last_error = None

    for attempt in range(max_retries):
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            return result
        except subprocess.CalledProcessError as e:
            last_error = e
            if attempt < max_retries - 1:
                # Wait before retrying, with exponential backoff
                delay = RETRY_DELAY * (2**attempt)
                print(
                    f"Warning: {description} failed (attempt {attempt + 1}/{max_retries}), retrying in {delay}s..."
                )
                time.sleep(delay)
            else:
                print(f"Error: {description} failed after {max_retries} attempts")

    # If we get here, all retries failed
    if last_error:
        raise last_error
    raise RuntimeError(f"{description} failed after {max_retries} attempts")


def download(url: str, output: Optional[str] = None, browser: str = "firefox") -> Path:
    """
    Download a video from URL using yt-dlp.

    Args:
        url: Video URL (Kick.com or other supported platforms)
        output: Output file path (defaults to output/vod.mp4)
        browser: Browser to extract cookies from (firefox, chrome, etc.)

    Returns:
        Path to downloaded file
    """
    OUT_DIR.mkdir(exist_ok=True)
    if output is None:
        output = str(OUT_DIR / "vod.mp4")

    if "kick.com" in url or "kik.com" in url:
        return download_kick(url, output, browser)
    return download_generic(url, output)


def download_kick(url: str, output: str, browser: str = "firefox") -> Path:
    """
    Download from Kick.com using browser cookies for authentication.

    Args:
        url: Kick.com video URL
        output: Output file path
        browser: Browser to extract cookies from (firefox, chrome, etc.)

    Returns:
        Path to downloaded file
    """
    cmd = [
        "yt-dlp",
        "--cookies-from-browser",
        browser,
        "-f",
        "best",
        "-o",
        output,
        "--no-playlist",
        url,
    ]
    run_with_retry(cmd, f"Download from {url}")
    return Path(output)


def download_generic(url: str, output: str) -> Path:
    """
    Download from any supported URL using yt-dlp.

    Args:
        url: Video URL
        output: Output file path

    Returns:
        Path to downloaded file
    """
    cmd = ["yt-dlp", "-f", "best", "-o", output, url]
    run_with_retry(cmd, f"Download from {url}")
    return Path(output)


def extract_audio(vod: str, output: Optional[str] = None) -> Path:
    """
    Extract audio track from video file using ffmpeg.

    Args:
        vod: Path to input video file
        output: Output audio file path (defaults to output/vod_audio.mp3)

    Returns:
        Path to extracted audio file
    """
    if output is None:
        output = str(OUT_DIR / "vod_audio.mp3")
    Path(output).parent.mkdir(parents=True, exist_ok=True)

    ffmpeg = find_ffmpeg()
    cmd = [
        ffmpeg,
        "-y",  # Overwrite output file
        "-i",
        vod,  # Input file
        "-vn",  # No video
        "-acodec",
        "libmp3lame",  # MP3 codec
        "-q:a",
        "4",  # Audio quality (4 = 128-160 kbps)
        output,
    ]
    run_with_retry(cmd, "Extract audio")
    return Path(output)
