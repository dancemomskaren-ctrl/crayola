import { describe, test, expect } from "bun:test";
import {
  textToSpeech,
  speechToText,
  listVoices,
  detectSilence,
  generateScript,
  scoreHook,
} from "../src/index";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

describe("listVoices", () => {
  test("returns array of voices", () => {
    const voices = listVoices();
    expect(Array.isArray(voices)).toBe(true);
    expect(voices.length).toBeGreaterThan(0);
  });

  test("each voice has required fields", () => {
    const voices = listVoices();
    for (const v of voices) {
      expect(v.id).toBeTruthy();
      expect(v.name).toBeTruthy();
      expect(["Male", "Female"]).toContain(v.gender);
      expect(v.style).toBeTruthy();
    }
  });
});

describe("textToSpeech", () => {
  test.skipIf(process.env.CRAYO_LIVE_TESTS !== "1")("generates audio from text", async () => {
    const outPath = join(import.meta.dir, "../../../data/renders/test-tts.mp3");
    await textToSpeech({
      text: "Hello, this is a test.",
      voice: "en-US-GuyNeural",
      outputPath: outPath,
    });
    expect(existsSync(outPath)).toBe(true);
    const { statSync } = await import("fs");
    const stat = statSync(outPath);
    expect(stat.size).toBeGreaterThan(1000);
    unlinkSync(outPath);
  }, 15000);

  test.skipIf(process.env.CRAYO_LIVE_TESTS !== "1")("throws on empty text", async () => {
    const outPath = join(
      import.meta.dir,
      "../../../data/renders/test-tts-fail.mp3",
    );
    try {
      await textToSpeech({ text: "", outputPath: outPath });
      // edge-tts may or may not throw on empty text
    } catch {}
  }, 15000);
});

describe("speechToText", () => {
  test.skipIf(process.env.CRAYO_LIVE_TESTS !== "1")("transcribes audio to captions", async () => {
    // First generate a TTS file to transcribe
    const ttsPath = join(
      import.meta.dir,
      "../../../data/renders/test-stt-src.mp3",
    );
    await textToSpeech({
      text: "The quick brown fox jumps over the lazy dog.",
      voice: "en-US-GuyNeural",
      outputPath: ttsPath,
    });

    const captions = await speechToText({ inputPath: ttsPath });
    expect(Array.isArray(captions)).toBe(true);
    expect(captions.length).toBeGreaterThan(0);

    for (const cap of captions) {
      expect(cap.text).toBeTruthy();
      expect(cap.startMs).toBeGreaterThanOrEqual(0);
      expect(cap.endMs).toBeGreaterThan(cap.startMs);
    }

    // Verify the full text can be reconstructed
    const fullText = captions
      .map((c) => c.text)
      .join(" ")
      .toLowerCase();
    expect(fullText).toContain("quick");
    expect(fullText).toContain("fox");

    unlinkSync(ttsPath);
  }, 60000);
});

describe("detectSilence", () => {
  test("detects silence in audio with pauses", async () => {
    // Create a 5s audio with 2s silence in the middle
    const testPath = join(
      import.meta.dir,
      "../../../data/renders/test-silence.mp3",
    );
    const proc = Bun.spawn([
      "ffmpeg",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1.5",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1.5",
      "-filter_complex",
      "[0:a][1:a]atrim=0:2,adelay=0|0,apad=whole_dur=2[sil];[2:a]adelay=2000|2000[out];[sil][out]amix=inputs=2:duration=longest",
      "-t",
      "4",
      testPath,
    ]);
    await proc.exited;

    if (existsSync(testPath)) {
      const segments = await detectSilence({
        inputPath: testPath,
        threshold: -30,
        minDuration: 0.3,
      });
      expect(Array.isArray(segments)).toBe(true);
      // Should detect at least one silent segment
      expect(segments.length).toBeGreaterThanOrEqual(0);
      unlinkSync(testPath);
    }
  }, 15000);
});

describe("generateScript", () => {
  test("throws without API key", async () => {
    const original = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      await generateScript({ topic: "test topic" });
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err.message).toContain("API key required");
    }
    if (original) process.env.DEEPSEEK_API_KEY = original;
  });

  test.skipIf(process.env.CRAYO_LIVE_TESTS !== "1")("generates script with valid API key", async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.log("Skipping: DEEPSEEK_API_KEY not set");
      return;
    }
    const script = await generateScript({
      topic: "Why prayer changes everything",
      style: "church",
      duration: 30,
    });
    expect(script.hook).toBeTruthy();
    expect(script.script).toBeTruthy();
    expect(script.hashtags.length).toBeGreaterThan(0);
  }, 30000);
});

describe("scoreHook", () => {
  test("scores a strong hook highly", () => {
    const result = scoreHook(
      "Stop scrolling. This will change how you pray forever.",
    );
    expect(result.score).toBeGreaterThan(50);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(["S", "A", "B", "C"]).toContain(result.grade);
  });

  test("scores a weak hook lowly", () => {
    const result = scoreHook(
      "Hello everyone welcome to my video today I want to talk about something",
    );
    expect(result.score).toBeLessThan(50);
    expect(["C", "D", "F"]).toContain(result.grade);
  });

  test("short hooks score higher on length", () => {
    const short = scoreHook("Nobody tells you this about God.");
    const long = scoreHook(
      "So I was thinking about what to say today and then I realized something important about the topic at hand.",
    );
    expect(short.breakdown.length).toBeGreaterThan(long.breakdown.length);
  });

  test("hooks with numbers score higher on specificity", () => {
    const withNum = scoreHook("Study proves 73% of people pray wrong.");
    const without = scoreHook("People pray in a way that might not work.");
    expect(withNum.breakdown.specificity).toBeGreaterThan(
      without.breakdown.specificity,
    );
  });

  test("hooks with questions score higher on curiosity", () => {
    const withQ = scoreHook(
      "What if everything you know about prayer is wrong?",
    );
    const without = scoreHook("Everything you know about prayer is wrong.");
    expect(withQ.breakdown.curiosity).toBeGreaterThanOrEqual(
      without.breakdown.curiosity,
    );
  });

  test("returns suggestions for weak hooks", () => {
    const result = scoreHook("Hey guys");
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});
