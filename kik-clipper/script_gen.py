import os
import time
from typing import Optional
from openai import OpenAI, APIError, APIConnectionError, RateLimitError
from schema import CampaignConfig, GeneratedScript, Transcript

SYSTEM_PROMPT = """You are a world-class short-form video editor who specializes in creating viral clips from livestreams. You have剪刀剪出 over 500M views across TikTok, YouTube Shorts, and Instagram Reels.

Your job: Analyze this stream transcript and find the {max_clips} most VIRAL, CLIPWORTHY moments that will blow up on social media.

## What Makes a Clip VIRAL (in order of importance):

1. **PEAK EMOTION** - The moment has INTENSE feeling: screaming, laughing, rage, disbelief, hype, shock
2. **STORY ARC** - There's a clear beginning, climax, and payoff in under {target_duration} seconds
3. **REWATCHABILITY** - Viewers will watch it twice or share it
4. **RELATABILITY** - Anyone can enjoy it, not just fans of the streamer
5. **PACING** - Fast, no dead air, every second counts

## CLIP STRUCTURE (for each clip):

```json
{
  "title": "short catchy name (3-5 words)",
  "start": 123.4,
  "duration": 35,
  "hook": "4 WORDS MAX - scroll-stopping opener",
  "text_overlay": "2-3 WORDS - massive dramatic text",
  "outro_text": "2 WORDS - call to action"
}
```

## HOOK FORMULAS (pick the best one):

**Pattern Interrupt:** "Wait... what?" / "No way" / "Watch this"
**Curiosity Gap:** "He didn't know..." / "What happens next" / "This changes everything"
**Social Proof:** "1M views for a reason" / "Everyone's talking about this"
**Emotional:** "I can't believe..." / "This is insane" / "My jaw dropped"
**Challenge:** "Can he do it?" / "Will it pay off?" / "One more try"

## TEXT OVERLAY RULES:

- ALL CAPS, 2-3 WORDS MAX
- Must be READABLE in 0.5 seconds
- Examples: "NO WAY" / "HUGE WIN" / "RIP" / "INSANE" / "GREEN!" / "CRASHED" / "10K SKIN" / "GG"

## CLIP PRIORITIZATION (what to look for):

**TIER 1 - CLIP NOW:**
- Peak emotional outbursts (screaming, laughing, rage quits)
- Massive wins or devastating losses
- "Did that just happen?" moments
- Unexpected outcomes
- Near misses that build tension

**TIER 2 - HIGH POTENTIAL:**
- Streaks (winning or losing)
- Big value plays ($1000+ skins)
- Streamer interactions with chat
- Funny reactions or commentary
- Challenge attempts

**TIER 3 - GOOD BACKUP:**
- Clean gameplay moments
- Educational/explainer moments
- Community highlights
- Trending topic reactions

## OUTPUT FORMAT:

Return ONLY valid JSON matching this exact structure:
```json
{{
  "clips": [
    {{
      "title": "string",
      "start": 0.0,
      "duration": 30,
      "hook": "string (4 words max)",
      "text_overlay": "string (3 words max)",
      "outro_text": "string (2 words)"
    }}
  ],
  "caption": "engaging caption for the batch (1 sentence)",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}}
```

## CRITICAL RULES:

1. **NO QUOTES** in any text fields - use only letters, numbers, spaces
2. **TIMESTAMPS MUST BE ACCURATE** - reference the word timestamps provided
3. **DURATION** - Keep clips {target_duration} seconds or shorter
4. **NO FILLER** - Every second must earn its place
5. **VARIETY** - Mix different types of moments (don't give 5 similar clips)

## HASHTAG STRATEGY:

Include 5-8 hashtags mixing:
- Brand: #csgoroll #cs2 #counterstrike
- Game: #casebattle #crash #roulette #unboxing
- Viral: #gambling #bigwin #insane #viral #fyp
- Niche: #skins #csgoskins #knife #gloves

Now analyze the transcript and find the moments that will BREAK the internet."""

# Global client instance (singleton pattern)
_client: Optional[OpenAI] = None

# Retry configuration for API calls
MAX_API_RETRIES = 3
API_RETRY_DELAY = 1  # seconds between retries


def get_client() -> OpenAI:
    """
    Get or create the OpenAI client singleton.

    Returns:
        Configured OpenAI client instance

    Raises:
        RuntimeError: If DEEPSEEK_API_KEY environment variable is not set
    """
    global _client
    if _client is None:
        key = os.environ.get("DEEPSEEK_API_KEY")
        if not key:
            raise RuntimeError(
                "Set DEEPSEEK_API_KEY env var first: export DEEPSEEK_API_KEY=your-key"
            )
        # Create client with timeout and retry configuration
        _client = OpenAI(
            base_url="https://api.deepseek.com",
            api_key=key,
            timeout=60.0,  # 60 second timeout for long transcripts
            max_retries=0,  # We handle retries ourselves for better control
        )
    return _client


def generate_script(transcript: Transcript, config: CampaignConfig) -> GeneratedScript:
    """
    Generate a clipping script from transcript using DeepSeek AI.

    Args:
        transcript: Video transcript with word-level timestamps
        config: Campaign configuration with streamer info and preferences

    Returns:
        GeneratedScript with clips, caption, and hashtags

    Raises:
        RuntimeError: If API returns no valid content
        RateLimitError: If rate limited by API (after retries)
        APIConnectionError: If cannot connect to API
    """
    client = get_client()

    # Prepare the prompt with config values
    system_content = SYSTEM_PROMPT.format(
        max_clips=config.max_clips,
        target_duration=config.target_duration,
    )

    # Include timestamp information in the prompt for better clip selection
    timestamp_info = ""
    if transcript.words:
        # Add word-level timestamps to help AI select precise moments
        # Send ALL words for full context (DeepSeek handles long context well)
        timestamp_info = "\n\nWord timestamps (word: start-end seconds):\n"
        for word in transcript.words:
            timestamp_info += f'"{word.text}": {word.start:.1f}-{word.end:.1f}\n'

    user_content = (
        f"Streamer: {config.streamer_name}\n"
        f"Platform: CSGORoll\n"
        f"Tone: {config.tone}\n\n"
        f"Transcript:\n{transcript.text}"
        f"{timestamp_info}"
    )

    # Retry logic for transient errors
    last_error = None
    for attempt in range(MAX_API_RETRIES):
        try:
            resp = client.chat.completions.create(
                model="deepseek-chat",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": user_content},
                ],
            )

            # Validate response
            if not resp.choices:
                raise RuntimeError("DeepSeek returned no choices")

            content = resp.choices[0].message.content
            if not content:
                raise RuntimeError("DeepSeek returned empty content")

            # Parse and validate JSON response
            return GeneratedScript.model_validate_json(content)

        except RateLimitError as e:
            last_error = e
            if attempt < MAX_API_RETRIES - 1:
                delay = API_RETRY_DELAY * (2**attempt)  # Exponential backoff
                print(
                    f"Warning: Rate limited, retrying in {delay}s (attempt {attempt + 1}/{MAX_API_RETRIES})..."
                )
                time.sleep(delay)
            else:
                print("Error: Rate limited after all retries")
                raise

        except APIConnectionError as e:
            last_error = e
            if attempt < MAX_API_RETRIES - 1:
                delay = API_RETRY_DELAY * (2**attempt)
                print(
                    f"Warning: Connection error, retrying in {delay}s (attempt {attempt + 1}/{MAX_API_RETRIES})..."
                )
                time.sleep(delay)
            else:
                print("Error: Cannot connect to API after all retries")
                raise

        except APIError as e:
            # For other API errors, don't retry (likely a permanent error)
            print(f"Error: API error: {e}")
            raise

        except Exception as e:
            # Catch-all for unexpected errors
            print(f"Error: Unexpected error: {e}")
            raise

    # This should not be reached, but just in case
    raise last_error or RuntimeError("Failed to generate script")
