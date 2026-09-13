#!/usr/bin/env python3
"""Transcribe audio with faster-whisper and emit OpenAI-Whisper-shaped JSON.

faster-whisper runs the same Whisper weights through CTranslate2 with int8
quantization: roughly 4x faster on about 60% of the memory, same accuracy.
That is what makes the `medium` model usable on a laptop instead of needing
~5GB of RAM.

Output is deliberately identical in shape to `whisper --output_format json`
so the existing TypeScript parser needs no changes:

{
  "text": "full transcript",
  "segments": [
    {
      "start": 0.0,
      "end": 4.2,
      "text": " some words",
      "words": [
        {"word": " some", "start": 0.0, "end": 0.4, "probability": 0.98},
        ...
      ]
    },
    ...
  ]
}

Usage:
  python3 transcribe_fast.py <input_audio> <output_json> [model] [language]
"""

import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print(
            "usage: transcribe_fast.py <input_audio> <output_json> "
            "[model] [language]",
            file=sys.stderr,
        )
        return 2

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    model_size = sys.argv[3] if len(sys.argv) > 3 else "medium.en"
    language = sys.argv[4] if len(sys.argv) > 4 else "en"

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "faster-whisper is not installed. "
            "Install it with: pip install faster-whisper",
            file=sys.stderr,
        )
        return 3

    # int8 on CPU is the memory-efficient path. compute_type="int8" keeps a
    # medium model near ~2GB instead of ~5GB.
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments_iter, _info = model.transcribe(
        input_path,
        language=language,
        beam_size=5,
        word_timestamps=True,
    )

    segments = []
    full_text_parts = []

    # segments_iter is a generator — transcription happens as it is consumed.
    for seg in segments_iter:
        words = []
        for w in seg.words or []:
            words.append(
                {
                    "word": w.word,
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 4),
                }
            )

        segments.append(
            {
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text,
                "words": words,
            }
        )
        full_text_parts.append(seg.text)

    payload = {
        "text": "".join(full_text_parts).strip(),
        "language": language,
        "segments": segments,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f"wrote {len(segments)} segments to {output_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
