import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const dir = mkdtempSync(join(tmpdir(), "crayo-api-test-"));
process.env.CRAYO_DATA_DIR = dir;
process.env.CRAYO_TEST_MODE = "1";
process.env.CRAYO_API_KEY = "test-only-local-key";
process.env.WHISPER_BACKEND = "openai";
const bin = join(dir, "bin"); mkdirSync(bin);
// Deterministic transcription fixture; actual FFmpeg media processing is exercised.
writeFileSync(join(bin, "whisper"), `#!/usr/bin/env bun
import { basename, join } from "path";
const args = process.argv.slice(2);
const out = args[args.indexOf("--output_dir") + 1];
const words = ["God", "gives", "us", "hope.", "We", "still", "need", "context.", "Listen", "to", "the", "conclusion."];
await Bun.write(join(out, basename(args[0]).replace(/\\.[^.]+$/, "") + ".json"), JSON.stringify({segments:[{words:words.map((word,i)=>({word,start:i/2,end:i/2+0.45}))}]}));
`, { mode: 0o755 });
const previousPath = process.env.PATH;
process.env.WHISPER_PATH = join(bin, "whisper");
process.env.PATH = `${bin}:${previousPath}`;
const { app } = await import("./index");
const { db, batch, project, render, caption, availableTemplates } = await import("@crayo/core");
const { eq } = await import("drizzle-orm");
const { processClipBatch, recoverJobs, validateReview, relativeCaptions, batchOutcome, drainClipQueue } = await import("./clip-worker");
const { managedPath, serial } = await import("./local-safety");
const auth = { Authorization: "Bearer test-only-local-key", "Content-Type": "application/json" };
function request(path: string, body?: any, method = "POST") {
  return app.request(`http://localhost:3001${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function settled(id: string) {
  for (let i = 0; i < 600; i++) {
    const row = db.select().from(batch).where(eq(batch.id, id)).get()!;
    if (["review", "done", "partial", "error"].includes(row.status)) return row;
    await Bun.sleep(50);
  }
  throw new Error("Timed out waiting for worker");
}
afterAll(async () => { await drainClipQueue(); process.env.PATH = previousPath; rmSync(dir, { recursive: true, force: true }); });

test("local auth works for API calls and browser cookie downloads", async () => {
  expect((await app.request("http://localhost:3001/api/projects")).status).toBe(401);
  const session = await request("/api/session", { key: "test-only-local-key" });
  expect(session.status).toBe(200);
  const cookie = session.headers.get("set-cookie")!.split(";")[0];
  expect((await app.request("http://localhost:3001/api/projects", { headers: { Cookie: cookie } })).status).toBe(200);
  expect((await app.request("http://localhost:3001/api/projects", { headers: { ...auth, Origin: "https://evil.example" } })).status).toBe(403);
  expect((await app.request("http://evil.example/api/projects", { headers: auth })).status).toBe(403);
});
test("unsupported paths, URLs and limits are rejected before work starts", async () => {
  expect((await request("/api/batch-clip", { localFilePath: "/etc/passwd", templateId: "sermon_clip" })).status).toBe(400);
  expect((await request("/api/batch-clip", { url: "http://127.0.0.1/internal", templateId: "sermon_clip" })).status).toBe(400);
  expect((await request("/api/batch-clip", { url: "https://youtube.com/watch?v=test", clipCount: 200, templateId: "sermon_clip" })).status).toBe(400);
  expect((await request("/api/silence-remove", { inputPath: "/etc/passwd", outputPath: "/tmp/overwrite" })).status).toBe(400);
  symlinkSync("/etc", join(dir, "uploads", "escape"));
  expect(() => managedPath(join(dir, "uploads", "escape", "passwd"))).toThrow();
  expect((await request("/api/post-now", { renderId: "any", platform: "tiktok" })).status).toBe(501);
});
test("exposed templates have explicit supported dispatch", () => {
  const templates = availableTemplates();
  expect(templates.find(t => t.id === "sermon_highlight")?.pipeline).toBe("sermon_clip");
  expect(templates.some(t => t.id === "mission_recap")).toBe(false);
  expect(templates.every(t => !!t.pipeline || ["story", "fake_text", "quiz", "split_screen"].includes(t.defaults.type))).toBe(true);
});
test("review edits validate boundaries and partial results stay truthful", () => {
  const data = { sourcePath: "", workDir: "", candidates: [{ id: "a", startMs: 0, endMs: 2000, text: "Hi", score: 1 }], captions: [{ startMs: 0, endMs: 2000, text: "Hi" }] };
  expect(() => validateReview(data, [{ id: "a", startMs: 1000, endMs: 500 }])).toThrow();
  expect(() => validateReview(data, [{ id: "a", startMs: 0, endMs: 3000 }])).toThrow();
  expect(relativeCaptions(data.captions, 500, 1500)).toEqual([{ text: "Hi", startMs: 0, endMs: 1000 }]);
  expect(batchOutcome([{ error: "failed" }, {}])).toEqual({ succeeded: 1, failed: 1, status: "partial" });
});
test("upload → analyze → review → corrected captions → real MP4 and ZIP", async () => {
  const input = join(dir, "fixture.mp4");
  const p = Bun.spawn([process.env.FFMPEG_PATH || "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-c:a", "aac", "-shortest", input], { stderr: "pipe" });
  const error = await new Response(p.stderr).text(); expect(await p.exited, error).toBe(0);
  const form = new FormData(); form.append("file", new File([await Bun.file(input).arrayBuffer()], "sermon.mp4", { type: "video/mp4" }));
  const upload = await app.request("http://localhost:3001/api/upload", { method: "POST", headers: { Authorization: auth.Authorization }, body: form });
  expect(upload.status).toBe(200);
  const source = await upload.json();
  const queued = await request("/api/batch-clip", { localFilePath: source.path, templateId: "sermon_clip", clipCount: 1, minDuration: 1, maxDuration: 3, quality: "draft", platform: "1:1", smartZoom: false });
  expect(queued.status).toBe(202);
  const { batchId } = await queued.json();
  const review = await settled(batchId);
  expect(review.status, review.error ?? "").toBe("review");
  expect(db.select().from(render).all()).toHaveLength(0);
  const analysis = JSON.parse(review.analysisJson!);
  const preview = await app.request(`http://localhost:3001/api/batch/${batchId}/source`, { headers: { ...auth, Range: "bytes=0-99" } });
  expect(preview.status).toBe(206); expect((await preview.arrayBuffer()).byteLength).toBe(100);
  expect((await request(`/api/batch/${batchId}/approve`, { clips: analysis.candidates })).status).toBe(400);
  const selected = analysis.candidates[0];
  selected.captions = [{ text: "Reviewed caption", startMs: 0, endMs: 800 }];
  selected.note = "Listened to context";
  const approved = await request(`/api/batch/${batchId}/approve`, { clips: [selected], contextConfirmed: true });
  expect(approved.status).toBe(202);
  const done = await settled(batchId);
  expect(done.status, done.error ?? "").toBe("done");
  const result = JSON.parse(done.resultJson!)[0];
  const download = await request(`/api/renders/${result.renderId}/download`, undefined, "GET");
  expect(download.status).toBe(200); expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  const zip = await request(`/api/renders/batch/${batchId}/zip`, undefined, "GET");
  expect(zip.status).toBe(200); expect(new Uint8Array(await zip.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
  expect(db.select().from(caption).where(eq(caption.renderId, result.renderId)).get()?.text).toBe("Reviewed caption");
  expect(existsSync(source.path)).toBe(true);
  expect(existsSync(analysis.workDir)).toBe(false);
}, 60000);
test("restart marks interrupted work, and serialization never overlaps", async () => {
  const id = randomUUID();
  db.insert(batch).values({ id, url: "fixture", templateId: "sermon_clip", status: "rendering", createdAt: new Date() }).run();
  recoverJobs();
  expect(db.select().from(batch).where(eq(batch.id, id)).get()?.status).toBe("interrupted");
  let active = 0, peak = 0;
  await Promise.all([1, 2, 3].map(() => serial(async () => { active++; peak = Math.max(peak, active); await Bun.sleep(5); active--; })));
  expect(peak).toBe(1);
});
test("partial batch ZIP contains successes and retry does not duplicate them", async () => {
  const id = randomUUID();
  const workDir = join(dir, "renders", `.job-${id}`); mkdirSync(workDir);
  const candidates = [
    { id: "good", startMs: 0, endMs: 1000, text: "First", score: 1, approved: true },
    { id: "bad", startMs: 20000, endMs: 21000, text: "Second", score: 1, approved: true },
  ];
  const analysis = { sourcePath: join(dir, "fixture.mp4"), workDir, captions: [{ text: "First", startMs: 0, endMs: 1000 }], candidates };
  db.insert(batch).values({ id, url: "fixture", templateId: "sermon_clip", status: "queued_render", createdAt: new Date(),
    analysisJson: JSON.stringify(analysis), payloadJson: JSON.stringify({ templateId: "sermon_clip", platform: "1:1", quality: "draft" }) }).run();
  await processClipBatch(id);
  const partial = db.select().from(batch).where(eq(batch.id, id)).get()!;
  expect(partial.status).toBe("partial"); expect(partial.completedClips).toBe(1);
  const firstId = JSON.parse(partial.resultJson!).find((r: any) => !r.error).renderId;
  const zip = await request(`/api/renders/batch/${id}/zip`, undefined, "GET");
  expect(zip.status).toBe(200); await zip.arrayBuffer();
  analysis.candidates[1].startMs = 1000; analysis.candidates[1].endMs = 2000;
  db.update(batch).set({ analysisJson: JSON.stringify(analysis) }).where(eq(batch.id, id)).run();
  expect((await request(`/api/batch/${id}/retry`, undefined)).status).toBe(202);
  const done = await settled(id);
  expect(done.status).toBe("done"); expect(done.completedClips).toBe(2);
  expect(JSON.parse(done.resultJson!).filter((r: any) => r.renderId === firstId)).toHaveLength(1);
}, 60000);
