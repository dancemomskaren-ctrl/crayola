import { describe, test, expect } from "bun:test";
import { escapeDrawtext, getDuration, run, overlayText } from "../src/ffmpeg";
import { existsSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("escapeDrawtext", () => {
  test("escapes backslashes", () => {
    expect(escapeDrawtext("hello\\world")).toBe("hello\\\\world");
  });

  test("keeps percent signs literal with expansion disabled", () => {
    expect(escapeDrawtext("50%")).toBe("50%");
  });

  test("escapes colons", () => {
    expect(escapeDrawtext("time: 10:30")).toBe("time\\: 10\\:30");
  });

  test("escapes brackets", () => {
    expect(escapeDrawtext("[test]")).toBe("\\[test\\]");
  });

  test("escapes semicolons and commas", () => {
    expect(escapeDrawtext("a;b,c")).toBe("a\\;b\\,c");
  });

  test("replaces newlines with spaces", () => {
    expect(escapeDrawtext("line1\nline2")).toBe("line1 line2");
  });

  test("handles complex mixed text", () => {
    const input = "50% off: [today] only! Price: $10\\$";
    const result = escapeDrawtext(input);
    expect(result).toContain("50%");
    expect(result).toContain("\\:");
    expect(result).toContain("\\[");
    expect(result).toContain("\\]");
    expect(result).toContain("\\\\");
  });
});

describe("getDuration", () => {
  test("returns duration of a valid audio file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crayo-duration-"));
    try {
      const input = join(dir, "fixture.mp4");
      await run(["-f", "lavfi", "-i", "color=c=black:s=320x240:d=1", input]);
      expect(await getDuration(input)).toBeGreaterThan(0.9);
      const output = join(dir, "caption.mp4");
      await overlayText(input, [{ text: "50%", startMs: 0, endMs: 1000 }], output);
      async function frame(path: string) {
        const p = Bun.spawn([process.env.FFMPEG_PATH || "ffmpeg", "-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { stdout: "pipe", stderr: "ignore" });
        const bytes = new Uint8Array(await new Response(p.stdout).arrayBuffer());
        expect(await p.exited).toBe(0);
        return bytes.reduce((a, b) => a + b, 0);
      }
      expect(await frame(output)).toBeGreaterThan(await frame(input));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("returns 0 for non-existent file", async () => {
    const dur = await getDuration("/nonexistent/file.mp4");
    expect(dur).toBe(0);
  });
});

describe("ffmpeg.run", () => {
  test("generates a test video", async () => {
    const outPath = join(import.meta.dir, "../../../data/renders/test-gen.mp4");
    await run([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x240:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-shortest",
      outPath,
    ]);
    expect(existsSync(outPath)).toBe(true);
    const dur = await getDuration(outPath);
    expect(dur).toBeGreaterThan(0.5);
    expect(dur).toBeLessThan(2);
    unlinkSync(outPath);
  });
});
