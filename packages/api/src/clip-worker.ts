import { db, batch, project, render, caption, client, ffmpeg, writeASS, mixAudio } from "@crayo/core";
import { autoClip, speechToText, removeSilence, reframeVideo, type Caption } from "@crayo/ai";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { join } from "path";
import { existsSync, mkdirSync, rmSync, renameSync, realpathSync } from "fs";
import { OUTPUT_DIR, serial, managedPath } from "./local-safety";

export interface Candidate {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  score: number;
  approved?: boolean;
  note?: string;
  captions?: Caption[]; // relative to this excerpt, supplied by the reviewer
}
export interface Analysis {
  sourcePath: string;
  workDir: string;
  captions: Caption[];
  candidates: Candidate[];
}

export function validateReview(analysis: Analysis, edits: any[]): Candidate[] {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 20) throw new Error("Select 1–20 excerpts.");
  const duration = analysis.captions.at(-1)?.endMs ?? 0;
  const seen = new Set<string>();
  return edits.map(edit => {
    const original = analysis.candidates.find(c => c.id === edit.id);
    if (!original || seen.has(edit.id)) throw new Error("Unknown or duplicate excerpt.");
    seen.add(edit.id);
    const startMs = Number(edit.startMs);
    const endMs = Number(edit.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs > duration + 100 ||
        endMs <= startMs || endMs - startMs > 180000) throw new Error("Excerpt must be within the source and no longer than 180 seconds.");
    let captions: Caption[] | undefined;
    if (edit.captions !== undefined) {
      if (!Array.isArray(edit.captions) || edit.captions.length > 1000) throw new Error("Invalid captions.");
      captions = edit.captions.map((c: any) => {
        if (typeof c.text !== "string" || c.text.length > 500 || !Number.isFinite(c.startMs) ||
            !Number.isFinite(c.endMs) || c.startMs < 0 || c.endMs <= c.startMs || c.endMs > endMs - startMs) {
          throw new Error("Caption times must be inside the selected excerpt.");
        }
        return { text: c.text, startMs: c.startMs, endMs: c.endMs };
      });
    }
    return { ...original, startMs, endMs, captions, approved: true, note: String(edit.note ?? "").slice(0, 2000),
      text: analysis.captions.filter(c => c.endMs > startMs && c.startMs < endMs).map(c => c.text).join(" ") };
  });
}

export function relativeCaptions(captions: Caption[], start: number, end: number): Caption[] {
  return captions.filter(c => c.endMs > start && c.startMs < end).map(c => ({ ...c,
    startMs: Math.max(0, c.startMs - start), endMs: Math.min(end - start, c.endMs - start) }));
}

function group(captions: Caption[]): Caption[] {
  const result: Caption[] = [];
  for (let i = 0; i < captions.length;) {
    const words = [captions[i++]];
    while (i < captions.length && words.length < 4 && captions[i].startMs - words.at(-1)!.endMs < 700) words.push(captions[i++]);
    result.push({ text: words.map(w => w.text).join(" "), startMs: words[0].startMs, endMs: words.at(-1)!.endMs });
  }
  return result;
}

export function batchOutcome(results: { error?: string }[]) {
  const failed = results.filter(r => r.error).length;
  return { succeeded: results.length - failed, failed, status: failed === 0 ? "done" : failed === results.length ? "error" : "partial" };
}

export function cleanupAnalysis(analysis: Analysis) {
  // Only worker-owned directories are eligible; never remove uploaded sources.
  // managedPath() resolves symlinks (on macOS /var is a symlink to /private/var),
  // so the root has to be resolved the same way before comparing prefixes —
  // otherwise every cleanup throws and .job-* dirs leak.
  const path = managedPath(analysis.workDir, true);
  if (!path.startsWith(join(realpathSync(OUTPUT_DIR), ".job-"))) throw new Error("Invalid job cleanup directory.");
  rmSync(path, { recursive: true, force: true });
}

export async function processClipBatch(id: string) {
  const row = db.select().from(batch).where(eq(batch.id, id)).get();
  if (!row?.payloadJson) throw new Error("Batch payload is missing; create a new batch.");
  const body = JSON.parse(row.payloadJson);
  const update = (patch: Partial<typeof batch.$inferInsert>) => db.update(batch).set(patch).where(eq(batch.id, id)).run();
  if (row.status === "queued") {
    update({ status: "analyzing", error: null });
    const workDir = join(OUTPUT_DIR, `.job-${id}`);
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
    const result = await autoClip({ ...body, workDir, extractClips: false });
    const analysis: Analysis = { sourcePath: result.sourcePath, workDir, captions: result.allCaptions ?? [],
      candidates: result.clips.map(c => ({ id: randomUUID(), startMs: c.startMs, endMs: c.endMs, text: c.text, score: c.score })) };
    update({ status: "review", analysisJson: JSON.stringify(analysis), totalClips: analysis.candidates.length, completedClips: 0 });
    return;
  }
  if (row.status !== "queued_render" || !row.analysisJson) return;
  const analysis: Analysis = JSON.parse(row.analysisJson);
  const approved = analysis.candidates.filter(c => c.approved);
  if (!approved.length) throw new Error("Approve at least one excerpt before rendering.");
  update({ status: "rendering", error: null, totalClips: approved.length });
  let results: any[] = JSON.parse(row.resultJson || "[]").filter((r: any) => !r.error);
  // Retry keeps completed clips, but re-renders missing/deleted outputs.
  results = results.filter(r => {
    const saved = db.select().from(render).where(eq(render.id, r.renderId)).get();
    return saved?.status === "done" && saved.outputPath && existsSync(saved.outputPath);
  });
  for (const clip of approved) {
    if (results.some(r => r.candidateId === clip.id)) continue;
    const projId = randomUUID();
    const renderId = randomUUID();
    const tempDir = join(analysis.workDir, `render-${renderId}`);
    const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
    mkdirSync(tempDir, { recursive: true });
    const warnings: string[] = [];
    try {
      const segPath = join(tempDir, "segment.mp4");
      // Re-encode to make the approved boundaries frame-accurate.
      await ffmpeg.run(["-ss", String(clip.startMs / 1000), "-i", analysis.sourcePath,
        "-t", String((clip.endMs - clip.startMs) / 1000), "-map", "0:v:0", "-map", "0:a:0",
        "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", "-avoid_negative_ts", "make_zero", segPath]);
      let source = segPath;
      let captions = clip.captions ?? relativeCaptions(analysis.captions, clip.startMs, clip.endMs);
      if (body.silenceRemoval && !clip.captions) {
        const trimmed = join(tempDir, "speech.mp4");
        const removed = await removeSilence({ inputPath: source, outputPath: trimmed });
        source = trimmed;
        if (removed.removedMs > 0) captions = await speechToText({ inputPath: source, language: body.language });
      } else if (body.silenceRemoval && clip.captions) {
        warnings.push("Silence removal skipped to preserve your edited caption timing.");
      }
      const duration = await ffmpeg.getDuration(source);
      const framed = join(tempDir, "framed.mp4");
      const aspect = body.platform ?? "9:16";
      const quality = body.quality ?? "standard";
      if (body.smartZoom && aspect !== "16:9") {
        try {
          const tracked = join(tempDir, "tracked.mp4");
          await reframeVideo({ inputPath: source, outputPath: tracked, targetAspect: aspect });
          await ffmpeg.toAspect(tracked, framed, aspect, quality);
        } catch (error: any) {
          warnings.push(`Face tracking unavailable; center crop used. ${String(error.message).slice(0, 120)}`);
          await ffmpeg.centerCrop(source, framed, aspect, quality);
        }
      } else await ffmpeg.toAspect(source, framed, aspect, quality);
      let visual = framed;
      const voiceVolume = body.voiceVolume ?? 1;
      if (voiceVolume !== 1) {
        const mixed = join(tempDir, "audio.m4a");
        await mixAudio({ tracks: [{ path: source, volume: voiceVolume }], duration, sfx: [], output: mixed });
        visual = join(tempDir, "mixed.mp4");
        await ffmpeg.addAudio(framed, mixed, visual);
      }
      const grouped = group(captions);
      const assPath = join(tempDir, "captions.ass");
      const styles: Record<string, string> = { holy_glow: "scripture", cross_bold: "scripture", worship_purple: "testimony", bold_pop: "word_by_word" };
      const style = styles[body.captionStyle] ?? body.captionStyle ?? "scripture";
      const { ASPECTS } = await import("@crayo/core");
      const dimensions = ASPECTS[aspect as keyof typeof ASPECTS];
      writeASS(grouped.map(c => ({ ...c, reference: body.scriptureReference ?? "" })), style, assPath, dimensions.width, dimensions.height);
      await ffmpeg.renderASS(visual, assPath, outPath, quality);
      if (body.clientId) {
        const customer = db.select().from(client).where(eq(client.id, body.clientId)).get();
        if (!customer) throw new Error("Client no longer exists.");
        if (customer.branding) {
          const branded = join(tempDir, "branded.mp4");
          await ffmpeg.overlayWatermark(outPath, branded, customer.branding);
          renameSync(branded, outPath);
        }
      }
      db.transaction(tx => {
        tx.insert(project).values({ id: projId, clientId: body.clientId ?? null, name: clip.text.slice(0, 80),
          type: body.templateId, status: "done", script: clip.text, url: body.url ?? null, createdAt: new Date() }).run();
        tx.insert(render).values({ id: renderId, projectId: projId, status: "done", outputPath: outPath,
          settings: JSON.stringify({ ...body, batchId: id, candidateId: clip.id, startMs: clip.startMs, endMs: clip.endMs,
            reviewedAt: body.reviewedAt, reviewNote: clip.note, warnings }), createdAt: new Date() }).run();
        for (const c of grouped) tx.insert(caption).values({ id: randomUUID(), renderId, ...c, style }).run();
        results.push({ candidateId: clip.id, projectId: projId, renderId, text: clip.text,
          startMs: clip.startMs, endMs: clip.endMs, score: clip.score, warnings });
        tx.update(batch).set({ resultJson: JSON.stringify(results), completedClips: results.filter(r => !r.error).length }).where(eq(batch.id, id)).run();
      });
    } catch (error: any) {
      rmSync(outPath, { force: true });
      results.push({ candidateId: clip.id, text: clip.text, error: error.message });
      update({ resultJson: JSON.stringify(results), completedClips: results.filter(r => !r.error).length });
    } finally { rmSync(tempDir, { recursive: true, force: true }); }
  }
  const outcome = batchOutcome(results);
  update({ status: outcome.status, completedClips: outcome.succeeded,
    error: outcome.failed ? `${outcome.failed} clip(s) failed. Retry keeps successful clips.` : null, resultJson: JSON.stringify(results) });
  if (outcome.status === "done") {
    try { cleanupAnalysis(analysis); } catch (error) { console.error("Job cleanup failed:", error); }
  }
}

let running = false;
export async function drainClipQueue() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const row = db.select().from(batch).all().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .find(b => b.status === "queued" || b.status === "queued_render");
      if (!row) break;
      try { await serial(() => processClipBatch(row.id)); }
      catch (error: any) { db.update(batch).set({ status: "error", error: error.message }).where(eq(batch.id, row.id)).run(); }
    }
  } finally { running = false; }
}

export function recoverJobs() {
  for (const row of db.select().from(batch).all()) {
    if (row.status === "analyzing") db.update(batch).set({ status: "queued" }).where(eq(batch.id, row.id)).run();
    if (["rendering", "processing"].includes(row.status)) db.update(batch).set({ status: "interrupted", error: "Server restarted. Retry to continue; completed clips are retained." }).where(eq(batch.id, row.id)).run();
  }
  for (const row of db.select().from(render).all()) {
    if (["processing", "pending"].includes(row.status)) {
      db.update(render).set({ status: "error", error: "Server restarted during rendering. Start a new render." }).where(eq(render.id, row.id)).run();
      db.update(project).set({ status: "error" }).where(eq(project.id, row.projectId)).run();
    }
  }
}
