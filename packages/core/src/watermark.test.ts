import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { run, overlayWatermark, getDuration } from "./ffmpeg";

test("renders a watermark in every corner without extending a silent video", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crayola-watermark-"));
  try {
    const input = join(dir, "input.mp4");
    const logoPath = join(dir, "logo.png");
    await run(["-f", "lavfi", "-i", "color=c=black:s=360x640:d=0.5", input]);
    await run(["-f", "lavfi", "-i", "color=c=white:s=40x40", "-frames:v", "1", logoPath]);
    for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const output = join(dir, `${position}.mp4`);
      await overlayWatermark(input, output, { logoPath, position, opacity: 0.5 });
      expect(await getDuration(output)).toBeGreaterThan(0);
      expect(await getDuration(output)).toBeLessThan(1);
    }
    await expect(overlayWatermark(input, join(dir, "bad.mp4"), { logoPath, position: "top-left", opacity: 2 })).rejects.toThrow("Invalid watermark");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 15000);
