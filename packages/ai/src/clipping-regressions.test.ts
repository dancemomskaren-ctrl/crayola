import { test, expect } from "bun:test";
import { detectHighlights, validateClipOptions, removeSilence } from "./index";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

test("tiny/invalid timestamps terminate without selecting too-short clips", () => {
  expect(detectHighlights([{ text: "Amen", startMs: 0, endMs: 50 }])).toEqual([]);
  expect(detectHighlights([{ text: "Amen", startMs: 0, endMs: 8000 }], { minDuration: 15 })).toEqual([]);
  expect(detectHighlights([{ text: "bad", startMs: NaN, endMs: 50 }])).toEqual([]);
});
test("extends whole sentences, keeps matching text and avoids overlapping selections", () => {
  const clips = detectHighlights([
    { text: "God healed me.", startMs: 0, endMs: 5000 },
    { text: "Here is the full explanation.", startMs: 6000, endMs: 16000 },
    { text: "And a conclusion.", startMs: 17000, endMs: 23000 },
  ], { minDuration: 15, maxDuration: 20 });
  expect(clips[0].text).toContain("explanation");
  expect(clips[0].endMs).toBe(16000);
  expect(clips).toHaveLength(1);
});
test("does not cut a long indivisible segment or accept invalid limits", () => {
  expect(detectHighlights([{ text: "A complete argument with a late qualification.", startMs: 0, endMs: 90000 }])).toEqual([]);
  for (const options of [{ clipCount: 0 }, { clipCount: 100 }, { minDuration: -1 }, { maxDuration: NaN }, { minDuration: 30, maxDuration: 10 }]) {
    expect(() => validateClipOptions(options)).toThrow();
  }
});
test("silence removal handles leading silence, middle silence and spaces in paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crayola silence "));
  try {
    for (const formula of ["if(lt(t\\,1)\\,0\\,0.2*sin(2*PI*440*t))", "if(between(t\\,1\\,2)\\,0\\,0.2*sin(2*PI*440*t))"]) {
      const input = join(dir, "input video.mp4"), output = join(dir, "output video.mp4");
      const p = Bun.spawn([process.env.FFMPEG_PATH || "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=160x120:d=4", "-f", "lavfi", "-i", `aevalsrc=${formula}:s=44100:d=4`, "-c:v", "libx264", "-c:a", "aac", "-shortest", input], { stderr: "pipe" });
      const error = await new Response(p.stderr).text();
      expect(await p.exited, error).toBe(0);
      const result = await removeSilence({ inputPath: input, outputPath: output });
      expect(result.removedMs).toBeGreaterThan(800);
      const probe = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", output]);
      const data = await new Response(probe.stdout).json();
      await probe.exited;
      expect(data.streams.map((s: any) => s.codec_type).sort()).toEqual(["audio", "video"]);
      expect(Number(data.streams[0].duration)).toBeLessThan(3.2);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20000);
