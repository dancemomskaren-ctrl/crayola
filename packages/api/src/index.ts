import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  db,
  client,
  project,
  render,
  asset,
  caption,
  batch,
  analytics,
  postQueue,
} from "@crayo/core";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { join } from "path";
import {
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
  statSync,
  renameSync,
  writeFileSync,
} from "fs";

const app = new Hono();
app.use("/*", cors());

// ─── API Key Auth (opt-in) ───
// Off by default so a solo/localhost setup keeps working with zero
// config. Set CRAYO_API_KEY in the environment to require every request
// to send `Authorization: Bearer <key>` — do this before letting anyone
// else (a VA, editor, or a machine other than your own laptop) reach
// this server. /api/health is always open so uptime checks don't need
// the key.
const API_KEY = process.env.CRAYO_API_KEY;
if (API_KEY) {
  const { bearerAuth } = await import("hono/bearer-auth");
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    return bearerAuth({ token: API_KEY })(c, next);
  });
  console.log("CRAYO_API_KEY is set — all /api/* routes require Bearer auth (except /api/health).");
} else {
  console.log("CRAYO_API_KEY not set — API is open, no auth required. Set it before exposing this server beyond your own machine.");
}

const ROOT = join(import.meta.dir, "../../..");
const OUTPUT_DIR = join(ROOT, "data/renders");
const ASSETS_DIR = join(ROOT, "assets");
const UPLOADS_DIR = join(ROOT, "data/uploads");
const DELIVERY_DIR = join(ROOT, "data/delivery");
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
if (!existsSync(DELIVERY_DIR)) mkdirSync(DELIVERY_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4GB — covers a full-length standup special/sermon/podcast at decent bitrate

app.get("/api/health", (c) => c.json({ ok: true }));

// ─── Upload: local mp4 → usable file path for auto-clip ───

app.post("/api/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || !(file instanceof File)) {
    return c.json({ error: "file is required (multipart form field 'file')" }, 400);
  }
  if (!file.type.startsWith("video/") && !file.name.toLowerCase().endsWith(".mp4")) {
    return c.json({ error: "only video files (.mp4) are accepted" }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(
      { error: `file too large (${(file.size / 1e9).toFixed(2)}GB, max 2GB)` },
      400,
    );
  }

  const id = randomUUID();
  const outPath = join(UPLOADS_DIR, `${id}.mp4`);
  await Bun.write(outPath, file);

  return c.json({ id, path: outPath, size: file.size, name: file.name });
});

// ─── Clients ───
// A "client" is who a project's work is for (e.g. a specific church).
// clientId on a project is optional — internal/test projects can have
// none. This is intentionally simple: no auth-scoping per client here,
// just a tag for organizing and filtering your own work.

app.get("/api/clients", async (c) => {
  const rows = db.select().from(client).all();
  return c.json(rows);
});

app.post("/api/clients", async (c) => {
  const body = await c.req.json();
  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required" }, 400);
  }
  const id = randomUUID();
  db.insert(client)
    .values({
      id,
      name: body.name,
      notes: body.notes ?? null,
      createdAt: new Date(),
    })
    .run();
  return c.json({ id });
});

app.get("/api/clients/:id", async (c) => {
  const row = db
    .select()
    .from(client)
    .where(eq(client.id, c.req.param("id")))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/api/clients/:id", async (c) => {
  const id = c.req.param("id");
  const row = db.select().from(client).where(eq(client.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);
  // Unassign this client from any projects rather than deleting their
  // history — losing render/project records when a client relationship
  // ends is more destructive than anyone asked for.
  db.update(project)
    .set({ clientId: null })
    .where(eq(project.clientId, id))
    .run();
  db.delete(client).where(eq(client.id, id)).run();
  return c.json({ ok: true });
});

// ─── Delivery ───
// "Deliver" = copy all undelivered finished renders for a client into
// `data/delivery/<client-name>/<timestamp>/`, then mark them delivered
// so they don't ship twice. Use this when a batch of clips is done and
// ready for the client to review or for you to upload to their Drive.

app.post("/api/deliver/:clientId", async (c) => {
  const clientId = c.req.param("clientId");
  const clientRow = db
    .select()
    .from(client)
    .where(eq(client.id, clientId))
    .get();
  if (!clientRow) return c.json({ error: "client not found" }, 404);

  // Find all done renders for this client that haven't been delivered yet
  const projects = db
    .select()
    .from(project)
    .where(eq(project.clientId, clientId))
    .all();
  if (projects.length === 0) {
    return c.json({ delivered: 0, message: "No projects for this client" });
  }
  const projectIds = projects.map((p) => p.id);

  const renders = db
    .select()
    .from(render)
    .where(eq(render.status, "done"))
    .all()
    .filter((r) => projectIds.includes(r.projectId) && !r.deliveredAt);

  if (renders.length === 0) {
    return c.json({
      delivered: 0,
      message: "No undelivered renders for this client",
    });
  }

  // Create a timestamped delivery folder for this batch
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const clientSlug = clientRow.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const deliveryFolder = join(DELIVERY_DIR, clientSlug, timestamp);
  mkdirSync(deliveryFolder, { recursive: true });

  const delivered: string[] = [];
  for (const r of renders) {
    if (!r.outputPath || !existsSync(r.outputPath)) continue;
    const filename = r.outputPath.split("/").pop() || `${r.id}.mp4`;
    const destPath = join(deliveryFolder, filename);
    try {
      const { copyFileSync } = await import("fs");
      copyFileSync(r.outputPath, destPath);
      db.update(render)
        .set({ deliveredAt: new Date() })
        .where(eq(render.id, r.id))
        .run();
      delivered.push(filename);
    } catch (err: any) {
      console.error(`Failed to deliver ${r.id}:`, err.message);
    }
  }

  return c.json({
    delivered: delivered.length,
    folder: deliveryFolder,
    files: delivered,
  });
});

// ─── Projects ───

app.get("/api/projects", async (c) => {
  const clientId = c.req.query("clientId");
  const rows = clientId
    ? db.select().from(project).where(eq(project.clientId, clientId)).all()
    : db.select().from(project).all();
  return c.json(rows);
});

app.post("/api/projects", async (c) => {
  const body = await c.req.json();
  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required" }, 400);
  }
  if (
    !body.type ||
    ![
      "story",
      "fake_text",
      "split_screen",
      "quiz",
      "sermon_clip",
      "podcast_clip",
      "reaction",
      "top_list",
    ].includes(body.type)
  ) {
    return c.json(
      {
        error:
          "type must be story, fake_text, split_screen, quiz, sermon_clip, podcast_clip, reaction, or top_list",
      },
      400,
    );
  }
  // clientId is optional. When provided, it must reference a real client
  // so projects can't silently point at a typo'd/nonexistent client.
  if (body.clientId) {
    const clientRow = db
      .select()
      .from(client)
      .where(eq(client.id, body.clientId))
      .get();
    if (!clientRow) {
      return c.json({ error: "clientId does not match an existing client" }, 400);
    }
  }
  const id = randomUUID();
  db.insert(project)
    .values({
      id,
      name: body.name,
      type: body.type,
      script: body.script,
      url: body.url,
      clientId: body.clientId ?? null,
      createdAt: new Date(),
    })
    .run();
  return c.json({ id });
});

app.get("/api/projects/:id", async (c) => {
  const row = db
    .select()
    .from(project)
    .where(eq(project.id, c.req.param("id")))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.get("/api/projects/:id/renders", async (c) => {
  const rows = db
    .select()
    .from(render)
    .where(eq(render.projectId, c.req.param("id")))
    .all();
  return c.json(rows);
});

app.delete("/api/projects/:id", async (c) => {
  const id = c.req.param("id");
  const row = db.select().from(project).where(eq(project.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);

  // Delete associated renders and their files
  const renders = db
    .select()
    .from(render)
    .where(eq(render.projectId, id))
    .all();
  for (const r of renders) {
    if (r.outputPath) {
      try {
        unlinkSync(r.outputPath);
      } catch {}
    }
    // Delete associated captions
    db.delete(caption).where(eq(caption.renderId, r.id)).run();
  }
  db.delete(render).where(eq(render.projectId, id)).run();
  db.delete(asset).where(eq(asset.projectId, id)).run();
  db.delete(project).where(eq(project.id, id)).run();

  return c.json({ ok: true });
});

// ─── Renders ───

app.post("/api/renders", async (c) => {
  const body = await c.req.json();
  if (!body.projectId || typeof body.projectId !== "string") {
    return c.json({ error: "projectId is required" }, 400);
  }
  const id = randomUUID();
  const proj = db
    .select()
    .from(project)
    .where(eq(project.id, body.projectId))
    .get();
  if (!proj) return c.json({ error: "project not found" }, 404);

  db.insert(render)
    .values({
      id,
      projectId: body.projectId,
      settings: JSON.stringify(body.settings ?? {}),
      createdAt: new Date(),
    })
    .run();

  renderVideo(id, proj, body.settings ?? {}).catch(console.error);

  return c.json({ id });
});

app.get("/api/renders/:id", async (c) => {
  const row = db
    .select()
    .from(render)
    .where(eq(render.id, c.req.param("id")))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.get("/api/renders/:id/download", async (c) => {
  const row = db
    .select()
    .from(render)
    .where(eq(render.id, c.req.param("id")))
    .get();
  if (!row || !row.outputPath) return c.json({ error: "not ready" }, 404);
  if (!existsSync(row.outputPath))
    return c.json({ error: "file missing" }, 404);
  const file = Bun.file(row.outputPath);
  return new Response(file, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="crayo-${row.id}.mp4"`,
    },
  });
});

app.delete("/api/renders/:id", async (c) => {
  const id = c.req.param("id");
  const row = db.select().from(render).where(eq(render.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.outputPath && existsSync(row.outputPath)) {
    try {
      unlinkSync(row.outputPath);
    } catch {}
  }
  db.delete(caption).where(eq(caption.renderId, id)).run();
  db.delete(render).where(eq(render.id, id)).run();
  return c.json({ ok: true });
});

// ─── TTS (Text-to-Speech) ───

app.get("/api/voices", async (c) => {
  const { listVoices } = await import("@crayo/ai");
  return c.json(listVoices());
});

app.post("/api/tts", async (c) => {
  const body = await c.req.json();
  if (!body.text || typeof body.text !== "string") {
    return c.json({ error: "text is required" }, 400);
  }
  const id = randomUUID();
  const outPath = join(OUTPUT_DIR, `${id}.mp3`);
  try {
    const { textToSpeech } = await import("@crayo/ai");
    await textToSpeech({
      text: body.text,
      voice: body.voice,
      outputPath: outPath,
    });
    return c.json({ id, path: `/renders/${id}.mp3` });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── STT (Speech-to-Text) ───

app.post("/api/stt", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  const inputPath = body.inputPath.startsWith("/")
    ? body.inputPath
    : join(ROOT, body.inputPath);
  try {
    const { speechToText } = await import("@crayo/ai");
    const captions = await speechToText({
      inputPath,
      language: body.language,
    });
    return c.json({ captions });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Script Generation ───

app.post("/api/generate-script", async (c) => {
  const body = await c.req.json();
  if (!body.topic || typeof body.topic !== "string") {
    return c.json({ error: "topic is required" }, 400);
  }
  // ragebaitHook is opt-in only: must be explicitly `true` in the request
  // body. Any other value (missing, false, truthy string, etc.) is off.
  const ragebaitHook = body.ragebaitHook === true;
  try {
    const { generateScript } = await import("@crayo/ai");
    const script = await generateScript({
      topic: body.topic,
      style: body.style,
      duration: body.duration,
      platform: body.platform,
      ragebaitHook,
    });
    return c.json(script);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Hook Scorer ───

app.post("/api/score-hook", async (c) => {
  const body = await c.req.json();
  if (!body.hook || typeof body.hook !== "string") {
    return c.json({ error: "hook is required" }, 400);
  }
  try {
    const { scoreHook } = await import("@crayo/ai");
    return c.json(scoreHook(body.hook));
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Script Variations ───

app.post("/api/generate-variations", async (c) => {
  const body = await c.req.json();
  if (!body.topic || typeof body.topic !== "string") {
    return c.json({ error: "topic is required" }, 400);
  }
  try {
    const { generateVariations } = await import("@crayo/ai");
    const variations = await generateVariations({
      topic: body.topic,
      style: body.style,
      count: body.count,
      angle: body.angle,
    });
    return c.json({ variations });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Analytics ───

app.get("/api/analytics", async (c) => {
  const rows = db.select().from(analytics).all();
  return c.json(rows);
});

app.post("/api/analytics", async (c) => {
  const body = await c.req.json();
  if (!body.renderId || typeof body.renderId !== "string") {
    return c.json({ error: "renderId is required" }, 400);
  }
  if (!body.platform || typeof body.platform !== "string") {
    return c.json({ error: "platform is required" }, 400);
  }
  const id = randomUUID();
  db.insert(analytics)
    .values({
      id,
      renderId: body.renderId,
      platform: body.platform,
      postUrl: body.postUrl,
      views: body.views ?? 0,
      likes: body.likes ?? 0,
      comments: body.comments ?? 0,
      shares: body.shares ?? 0,
      saves: body.saves ?? 0,
      watchTimeMs: body.watchTimeMs ?? 0,
      hookRetention: body.hookRetention ?? 0,
      avgWatchPercent: body.avgWatchPercent ?? 0,
      fetchedAt: new Date(),
      createdAt: new Date(),
    })
    .run();
  return c.json({ id });
});

app.get("/api/analytics/summary", async (c) => {
  const rows = db.select().from(analytics).all();
  const total = rows.reduce(
    (acc, r) => ({
      views: acc.views + r.views,
      likes: acc.likes + r.likes,
      comments: acc.comments + r.comments,
      shares: acc.shares + r.shares,
      saves: acc.saves + r.saves,
    }),
    { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
  );
  const byPlatform: Record<string, { views: number; posts: number }> = {};
  for (const r of rows) {
    if (!byPlatform[r.platform])
      byPlatform[r.platform] = { views: 0, posts: 0 };
    byPlatform[r.platform].views += r.views;
    byPlatform[r.platform].posts += 1;
  }
  return c.json({ total, byPlatform, postCount: rows.length });
});

// ─── Posting Queue ───

app.get("/api/post-queue", async (c) => {
  const rows = db.select().from(postQueue).all();
  return c.json(rows);
});

app.post("/api/post-queue", async (c) => {
  const body = await c.req.json();
  if (!body.renderId || typeof body.renderId !== "string") {
    return c.json({ error: "renderId is required" }, 400);
  }
  if (!body.platform || typeof body.platform !== "string") {
    return c.json({ error: "platform is required" }, 400);
  }
  const id = randomUUID();
  db.insert(postQueue)
    .values({
      id,
      renderId: body.renderId,
      platform: body.platform,
      caption: body.caption,
      hashtags: body.hashtags ? JSON.stringify(body.hashtags) : null,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      createdAt: new Date(),
    })
    .run();
  return c.json({ id });
});

app.delete("/api/post-queue/:id", async (c) => {
  const id = c.req.param("id");
  const row = db.select().from(postQueue).where(eq(postQueue.id, id)).get();
  if (!row) return c.json({ error: "not found" }, 404);
  db.delete(postQueue).where(eq(postQueue.id, id)).run();
  return c.json({ ok: true });
});

// ─── Post Now ───

app.post("/api/post-now", async (c) => {
  const body = await c.req.json();
  if (!body.renderId || typeof body.renderId !== "string") {
    return c.json({ error: "renderId is required" }, 400);
  }
  if (!body.platform || typeof body.platform !== "string") {
    return c.json({ error: "platform is required" }, 400);
  }

  // Get the render to find the video file
  const renderRow = db
    .select()
    .from(render)
    .where(eq(render.id, body.renderId))
    .get();
  if (!renderRow) return c.json({ error: "render not found" }, 404);
  if (!renderRow.outputPath)
    return c.json({ error: "render has no output" }, 400);

  // In a real implementation, this would call the platform's API:
  // - Instagram Graph API for Reels
  // - TikTok API for videos
  // - YouTube Data API for Shorts
  // For now, we just mark it as posted with a placeholder URL

  const id = randomUUID();
  const postUrl = `https://${body.platform}.com/watch/${id.slice(0, 8)}`;

  db.insert(postQueue)
    .values({
      id,
      renderId: body.renderId,
      platform: body.platform,
      status: "posted",
      caption: body.caption,
      hashtags: body.hashtags ? JSON.stringify(body.hashtags) : null,
      postedAt: new Date(),
      postUrl,
      createdAt: new Date(),
    })
    .run();

  return c.json({
    id,
    postUrl,
    message: `Queued for ${body.platform}. Connect platform API keys in .env to auto-post.`,
  });
});

// ─── Phase 4: Background removal ───

app.post("/api/remove-bg", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  const inputPath = body.inputPath.startsWith("/")
    ? body.inputPath
    : join(ROOT, body.inputPath);
  const id = randomUUID();
  const outPath = join(OUTPUT_DIR, `${id}.png`);
  try {
    const { removeBackground } = await import("@crayo/ai");
    await removeBackground({ inputPath, outputPath: outPath });
    return c.json({ id, path: `/renders/${id}.png` });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Phase 4: Audio tools ───

app.post("/api/audio/remove-vocals", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  const inputPath = body.inputPath.startsWith("/")
    ? body.inputPath
    : join(ROOT, body.inputPath);
  const id = randomUUID();
  const outPath = join(OUTPUT_DIR, `${id}-instrumental.mp3`);
  try {
    const { removeVocals } = await import("@crayo/ai");
    await removeVocals({ inputPath, outputPath: outPath });
    return c.json({ id, path: `/renders/${id}-instrumental.mp3` });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/audio/enhance", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  const inputPath = body.inputPath.startsWith("/")
    ? body.inputPath
    : join(ROOT, body.inputPath);
  const id = randomUUID();
  const outPath = join(OUTPUT_DIR, `${id}-enhanced.mp3`);
  try {
    const { enhanceAudio } = await import("@crayo/ai");
    await enhanceAudio({ inputPath, outputPath: outPath });
    return c.json({ id, path: `/renders/${id}-enhanced.mp3` });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Templates ───

app.get("/api/templates", async (c) => {
  const { TEMPLATES } = await import("@crayo/core");
  return c.json(TEMPLATES);
});

app.get("/api/templates/:id", async (c) => {
  const { getTemplate } = await import("@crayo/core");
  const tpl = getTemplate(c.req.param("id"));
  if (!tpl) return c.json({ error: "template not found" }, 404);
  return c.json(tpl);
});

// ─── YouTube/TikTok downloader ───

app.post("/api/download", async (c) => {
  const body = await c.req.json();
  if (!body.url || typeof body.url !== "string") {
    return c.json({ error: "url is required" }, 400);
  }
  const url = body.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    return c.json({ error: "url must start with http:// or https://" }, 400);
  }
  const id = randomUUID();
  const outPath = join(OUTPUT_DIR, `${id}.mp4`);

  try {
    await downloadVideo(url, outPath);
    return c.json({ id, path: `/renders/${id}.mp4` });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Auto Clip: YouTube → highlight clips ───

app.post("/api/auto-clip", async (c) => {
  const body = await c.req.json();
  const hasUrl = body.url && typeof body.url === "string";
  const hasLocalFile =
    body.localFilePath && typeof body.localFilePath === "string";
  if (!hasUrl && !hasLocalFile) {
    return c.json(
      { error: "either url or localFilePath is required (localFilePath comes from /api/upload)" },
      400,
    );
  }

  const { autoClip, detectFaces } = await import("@crayo/ai");
  const { ASPECTS, QUALITY, ffmpeg, writeASS } = await import(
    "@crayo/core"
  );

  try {
    const result = await autoClip({
      url: hasUrl ? body.url : undefined,
      localFilePath: hasLocalFile ? body.localFilePath : undefined,
      clipCount: Number(body.clipCount ?? 5),
      minDuration: Number(body.minDuration ?? 15),
      maxDuration: Number(body.maxDuration ?? 60),
      language: body.language ?? "en",
    });

    if (result.clips.length === 0) {
      return c.json({ error: "No highlights detected" }, 400);
    }

    // Resolve settings
    const validPlatforms = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
    const platformKey = String(body.platform ?? "9:16");
    const platform = validPlatforms.includes(platformKey as any)
      ? (platformKey as keyof typeof ASPECTS)
      : "9:16";
    const aspect = ASPECTS[platform];

    const validQualities = Object.keys(QUALITY) as (keyof typeof QUALITY)[];
    const qualityKey = String(body.quality ?? "standard");
    const quality = validQualities.includes(qualityKey as any)
      ? (qualityKey as keyof typeof QUALITY)
      : "standard";
    const qual = QUALITY[quality];

    const captionStyleName = String(body.captionStyle ?? "bold_pop");
    // premium = 60fps motion interpolation via FFmpeg minterpolate.
    // Off by default: it multiplies render time.
    const usePremium = body.premium === true;
    const bgClips = listStockClips();

    const ASS_STYLES = new Set([
      "typewriter",
      "bounce",
      "shake",
      "zoom",
      "colorful",
      "word_by_word",
      "glow",
      "neon",
    ]);

    // Render each clip with captions, title, smart zoom
    const projects: any[] = [];
    for (let i = 0; i < result.clips.length; i++) {
      const clip = result.clips[i];
      const projId = randomUUID();
      const renderId = randomUUID();
      const clipDur = (clip.endMs - clip.startMs) / 1000;
      const clipStartSec = clip.startMs / 1000;

      try {
        const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
        const tempFiles: string[] = [];

        // Extract clip segment from source
        const segPath = join(OUTPUT_DIR, `${renderId}-seg.mp4`);
        tempFiles.push(segPath);
        await ffmpeg.run([
          "-y",
          "-ss",
          String(clipStartSec),
          "-i",
          result.sourcePath,
          "-t",
          String((clip.endMs - clip.startMs) / 1000),
          "-c",
          "copy",
          segPath,
        ]);

        // Reformat to target aspect ratio (e.g. 9:16 for TikTok)
        const fmtPath = join(OUTPUT_DIR, `${renderId}-fmt.mp4`);
        tempFiles.push(fmtPath);
        await ffmpeg.run([
          "-y",
          "-i",
          segPath,
          "-vf",
          `scale=${aspect.width}:${aspect.height}:force_original_aspect_ratio=decrease,pad=${aspect.width}:${aspect.height}:(ow-iw)/2:(oh-ih)/2:black`,
          "-c:v",
          "libx264",
          "-preset",
          qual.preset,
          "-crf",
          String(qual.crf),
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          fmtPath,
        ]);

        // Get captions for this clip
        const clipCaptions = clip.captions || [];

        // Detect faces for smart zoom
        let faceData: any = null;
        if (body.smartZoom !== false) {
          try {
            const faceOutPath = join(OUTPUT_DIR, `${renderId}-faces.json`);
            tempFiles.push(faceOutPath);
            faceData = await detectFaces({
              inputPath: segPath,
              outputPath: faceOutPath,
              sampleFps: 2,
            });
          } catch (e) {
            console.warn("Face detection failed:", e);
          }
        }

        // Build background
        let renderPath = fmtPath;
        if (bgClips.length > 0 && body.bgVideo !== false) {
          const bgPath = join(OUTPUT_DIR, `${renderId}-bg.mp4`);
          tempFiles.push(bgPath);
          const bg = bgClips[i % bgClips.length];
          await ffmpeg.trim({ input: bg, end: clipDur + 2, output: bgPath });
          const compositedPath = join(OUTPUT_DIR, `${renderId}-comp.mp4`);
          tempFiles.push(compositedPath);
          await ffmpeg.composeSplitScreen(fmtPath, bg, compositedPath, {
            bgPosition: body.bgPosition ?? "right",
          });
          renderPath = compositedPath;
        }

        // Generate title overlay (clickbait style)
        const titleText = clip.suggestedTitle || clip.text.slice(0, 50) + "...";

        // Route caption generation based on style
        let vf = ""; // video filter string
        
        if (captionStyleName === "none") {
          // No captions, just title
          const titleY = Math.floor(aspect.height * 0.12);
          vf = `drawtext=text='${titleText.replace(/'/g, "'\\''")}':fontsize=${Math.floor(aspect.height / 20)}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${titleY}`;
        } else if (captionStyleName.startsWith("viral_")) {
          // Viral ASS captions (MrBeast, Hormozi, etc.)
          const { generateViralASS } = await import("@crayo/core");
          const viralStyleId = captionStyleName.replace("viral_", ""); // e.g. "mrbeast"
          
          const assPath = join(OUTPUT_DIR, `${renderId}-viral.ass`);
          tempFiles.push(assPath);
          
          const assContent = generateViralASS(
            clipCaptions.map(c => ({ text: c.text, startMs: c.startMs, endMs: c.endMs })),
            viralStyleId,
            aspect.width,
            aspect.height,
            10, // position from bottom (%)
          );
          
          writeFileSync(assPath, assContent);
          
          // Title + viral ASS captions
          const titleY = Math.floor(aspect.height * 0.12);
          vf = `ass=${assPath},drawtext=text='${titleText.replace(/'/g, "'\\''")}':fontsize=${Math.floor(aspect.height / 20)}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${titleY}`;
        } else if (captionStyleName.startsWith("scattered_")) {
          // Scattered word captions (aesthetic edit style)
          const { buildScatteredWordFilterComplex } = await import("@crayo/core");
          const scatteredStyleId = captionStyleName.replace("scattered_", ""); // e.g. "clean", "neon"
          
          const scatteredFilter = buildScatteredWordFilterComplex({
            words: clipCaptions.map(c => ({ text: c.text, startMs: c.startMs, endMs: c.endMs })),
            videoWidth: aspect.width,
            videoHeight: aspect.height,
            style: scatteredStyleId as any,
            minFontSize: 60,
            maxFontSize: 100,
            safeMargin: 50,
          });
          
          // Scattered words (no title needed, words are the aesthetic)
          vf = scatteredFilter;
        } else {
          // Traditional ASS styles (bold_pop, typewriter, bounce, etc.)
          const assPath = join(OUTPUT_DIR, `${renderId}-captions.ass`);
          tempFiles.push(assPath);
          writeASS(
            clipCaptions.map((c) => ({
              text: c.text,
              startMs: c.startMs,
              endMs: c.endMs,
            })),
            captionStyleName,
            assPath,
            aspect.width,
            aspect.height,
          );

          // Title + traditional ASS captions
          const titleY = Math.floor(aspect.height * 0.12);
          vf = `ass=${assPath},drawtext=text='${titleText.replace(/'/g, "'\\''")}':fontsize=${Math.floor(aspect.height / 20)}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${titleY}`;
        }

        // Render with chosen caption style.
        // Premium mode appends FFmpeg's minterpolate filter, which
        // synthesises in-between frames for 60fps motion. It is slow
        // (roughly 3-5x a normal render) so it stays opt-in per request.
        const vfChain = usePremium
          ? `${vf},minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:vsbmc=1`
          : vf;

        await ffmpeg.run([
          "-y",
          "-i",
          renderPath,
          "-vf",
          vfChain,
          "-c:v",
          "libx264",
          "-preset",
          qual.preset,
          "-crf",
          String(qual.crf),
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-shortest",
          outPath,
        ]);

        db.insert(project)
          .values({
            id: projId,
            name: `Auto-clip: ${clip.text.slice(0, 40)}...`,
            type: "story",
            script: clip.text,
            createdAt: new Date(),
          })
          .run();

        db.insert(render)
          .values({
            id: renderId,
            projectId: projId,
            status: "done",
            outputPath: outPath,
            settings: JSON.stringify({
              autoClip: true,
              startMs: clip.startMs,
              endMs: clip.endMs,
              score: clip.score,
              sourceUrl: hasUrl ? body.url : undefined,
              sourceUpload: hasLocalFile ? body.localFilePath : undefined,
            }),
            createdAt: new Date(),
          })
          .run();

        projects.push({
          projectId: projId,
          renderId,
          text: clip.text,
          startMs: clip.startMs,
          endMs: clip.endMs,
          score: clip.score,
        });

        // Cleanup temp files
        for (const f of tempFiles) {
          try {
            unlinkSync(f);
          } catch {}
        }
      } catch (err: any) {
        console.error(`Failed to render clip ${i}:`, err.message);
        // Still create a project record with the raw clip as fallback
        const projId = randomUUID();
        const renderId = randomUUID();
        db.insert(project)
          .values({
            id: projId,
            name: `Auto-clip: ${clip.text.slice(0, 40)}...`,
            type: "story",
            script: clip.text,
            createdAt: new Date(),
          })
          .run();
        db.insert(render)
          .values({
            id: renderId,
            projectId: projId,
            status: "done",
            outputPath: clip.path,
            settings: JSON.stringify({
              autoClip: true,
              startMs: clip.startMs,
              endMs: clip.endMs,
              score: clip.score,
              sourceUrl: hasUrl ? body.url : undefined,
              sourceUpload: hasLocalFile ? body.localFilePath : undefined,
            }),
            createdAt: new Date(),
          })
          .run();

        projects.push({
          projectId: projId,
          renderId,
          text: clip.text,
          startMs: clip.startMs,
          endMs: clip.endMs,
          score: clip.score,
        });
      }
    }

    return c.json({ clips: projects });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Sermon Clip: YouTube sermon → captioned highlight clips ───

app.post("/api/sermon-clip", async (c) => {
  const body = await c.req.json();
  if (!body.url || typeof body.url !== "string") {
    return c.json({ error: "url is required" }, 400);
  }

  try {
    const { autoClip, speechToText } = await import("@crayo/ai");
    const { ASPECTS, QUALITY, ffmpeg, writeASS, mixAudio } = await import(
      "@crayo/core"
    );

    // Step 1: Download + transcribe + detect highlights
    const result = await autoClip({
      url: body.url,
      clipCount: Number(body.clipCount ?? 5),
      minDuration: Number(body.minDuration ?? 15),
      maxDuration: Number(body.maxDuration ?? 60),
      language: body.language ?? "en",
    });

    if (result.clips.length === 0) {
      return c.json({ error: "No highlights detected" }, 400);
    }

    // Step 2: Transcribe full sermon for caption generation
    const audioPath = join(OUTPUT_DIR, `.sermon-audio-${randomUUID()}.mp3`);
    const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
    const audioProc = Bun.spawn(
      [
        ffmpegBin,
        "-y",
        "-i",
        result.sourcePath,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4",
        audioPath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if ((await audioProc.exited) !== 0) {
      throw new Error("Failed to extract sermon audio");
    }

    const fullCaptions = await speechToText({
      inputPath: audioPath,
      language: body.language ?? "en",
    });

    // Resolve settings
    const validPlatforms = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
    const platformKey = String(body.platform ?? "9:16");
    const platform = validPlatforms.includes(platformKey as any)
      ? (platformKey as keyof typeof ASPECTS)
      : "9:16";
    const aspect = ASPECTS[platform];

    const validQualities = Object.keys(QUALITY) as (keyof typeof QUALITY)[];
    const qualityKey = String(body.quality ?? "standard");
    const quality = validQualities.includes(qualityKey as any)
      ? (qualityKey as keyof typeof QUALITY)
      : "standard";
    const qual = QUALITY[quality];

    const hookIntro = String(body.hookIntro ?? "Watch this...");
    const captionStyleName = String(body.captionStyle ?? "bold_pop");
    const transitionType = String(body.transition ?? "crossfade");
    const bgClips = listStockClips();

    const ASS_STYLES = new Set([
      "typewriter",
      "bounce",
      "shake",
      "zoom",
      "colorful",
      "word_by_word",
      "glow",
      "neon",
    ]);

    // Step 3: Render each clip
    const projects: any[] = [];
    for (let i = 0; i < result.clips.length; i++) {
      const clip = result.clips[i];
      const projId = randomUUID();
      const renderId = randomUUID();
      const clipDur = (clip.endMs - clip.startMs) / 1000;
      const clipStartSec = clip.startMs / 1000;

      try {
        const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
        const tempFiles: string[] = [];

        // Extract clip segment from source
        const segPath = join(OUTPUT_DIR, `${renderId}-seg.mp4`);
        tempFiles.push(segPath);
        await ffmpeg.run([
          "-y",
          "-ss",
          String(clipStartSec),
          "-i",
          result.sourcePath,
          "-t",
          String(clipDur),
          "-c",
          "copy",
          segPath,
        ]);

        // Get captions for this clip's time range
        const clipCaptions = fullCaptions.filter(
          (cap) =>
            cap.startMs >= clip.startMs - 500 && cap.endMs <= clip.endMs + 500,
        );
        const relativeCaptions = clipCaptions.map((cap) => ({
          text: cap.text,
          startMs: Math.max(0, cap.startMs - clip.startMs),
          endMs: Math.min(clip.endMs - clip.startMs, cap.endMs - clip.startMs),
        }));
        const grouped = groupCaptions(relativeCaptions, 4);

        // Build background: use gameplay if available
        let renderPath = segPath;
        if (bgClips.length > 0 && body.bgVideo !== false) {
          const bgPath = join(OUTPUT_DIR, `${renderId}-bg.mp4`);
          tempFiles.push(bgPath);
          const bg = bgClips[i % bgClips.length];
          await ffmpeg.trim({ input: bg, end: clipDur + 2, output: bgPath });
          const compositedPath = join(OUTPUT_DIR, `${renderId}-comp.mp4`);
          tempFiles.push(compositedPath);
          await ffmpeg.composeSplitScreen(segPath, bg, compositedPath, {
            bgPosition: "right",
          });
          renderPath = compositedPath;
        }

        // Format to aspect ratio
        const aspectPath = join(OUTPUT_DIR, `${renderId}-aspect.mp4`);
        tempFiles.push(aspectPath);
        await ffmpeg.toAspect(renderPath, aspectPath, platform, quality);
        renderPath = aspectPath;

        // Smart zoom
        if (body.smartZoom && bgClips.length > 0) {
          try {
            const { detectFaces } = await import("@crayo/ai");
            const faceDataPath = join(OUTPUT_DIR, `${renderId}-faces.json`);
            tempFiles.push(faceDataPath);
            await detectFaces({
              inputPath: renderPath,
              outputPath: faceDataPath,
            });
            const zoomedPath = join(OUTPUT_DIR, `${renderId}-zoomed.mp4`);
            tempFiles.push(zoomedPath);
            await ffmpeg.smartZoom(renderPath, {
              faceDataPath,
              output: zoomedPath,
              quality,
            });
            renderPath = zoomedPath;
          } catch {}
        }

        // Mix audio (sermon audio + optional bg music)
        const voiceVol = Number(body.voiceVolume ?? 1.0);
        const musicVol = Number(body.musicVolume ?? 0.15);
        const hasMusic =
          body.bgMusic !== false && listBgMusic().length > 0 && musicVol > 0;
        if (voiceVol > 0 || hasMusic) {
          const mixedAudioPath = join(
            OUTPUT_DIR,
            `${renderId}-mixed-audio.m4a`,
          );
          tempFiles.push(mixedAudioPath);
          const mixedPath = join(OUTPUT_DIR, `${renderId}-mixed.mp4`);
          tempFiles.push(mixedPath);

          const tracks: any[] = [];
          if (voiceVol > 0) {
            tracks.push({ path: segPath, volume: voiceVol });
          }
          if (hasMusic) {
            const bgMusic =
              listBgMusic()[Math.floor(Math.random() * listBgMusic().length)];
            tracks.push({ path: bgMusic, volume: musicVol, loop: true });
          }
          await mixAudio({
            tracks,
            sfx: [],
            duration: clipDur,
            output: mixedAudioPath,
          });
          await ffmpeg.addAudio(renderPath, mixedAudioPath, mixedPath);
          renderPath = mixedPath;
        }

        // Apply captions
        if (grouped.length > 0) {
          if (ASS_STYLES.has(captionStyleName)) {
            const assPath = join(OUTPUT_DIR, `${renderId}-captions.ass`);
            tempFiles.push(assPath);
            writeASS(
              grouped.map((t) => ({
                text: t.text,
                startMs: t.startMs,
                endMs: t.endMs,
              })),
              captionStyleName,
              assPath,
              aspect.width,
              aspect.height,
            );
            await ffmpeg.renderASS(renderPath, assPath, outPath, quality);
          } else {
            const captionStyle = buildCaptionStyle(captionStyleName);
            await ffmpeg.overlayText(
              renderPath,
              grouped.map((t) => ({ ...t, style: captionStyle })),
              outPath,
            );
          }
        } else {
          // No captions — just copy
          await ffmpeg.run(["-y", "-i", renderPath, "-c", "copy", outPath]);
        }

        // Hook intro overlay (text at the start)
        if (hookIntro) {
          const withHookPath = join(OUTPUT_DIR, `${renderId}-hook.mp4`);
          tempFiles.push(withHookPath);
          await ffmpeg.overlayText(
            outPath,
            [
              {
                text: hookIntro,
                startMs: 0,
                endMs: 3000,
                style: {
                  fontSize: 56,
                  fontColor: "white",
                  position: "center",
                  outline: true,
                  outlineColor: "black",
                },
              },
            ],
            withHookPath,
          );
          unlinkSync(outPath);
          renameSync(withHookPath, outPath);
        }

        db.insert(project)
          .values({
            id: projId,
            name: `Sermon: ${clip.text.slice(0, 40)}...`,
            type: "sermon_clip",
            script: clip.text,
            url: body.url,
            createdAt: new Date(),
          })
          .run();

        db.insert(render)
          .values({
            id: renderId,
            projectId: projId,
            status: "done",
            outputPath: outPath,
            settings: JSON.stringify({
              sermonClip: true,
              startMs: clip.startMs,
              endMs: clip.endMs,
              score: clip.score,
              sourceUrl: body.url,
              captionStyle: captionStyleName,
              platform,
              quality,
              hookIntro,
            }),
            createdAt: new Date(),
          })
          .run();

        // Store captions
        for (const cap of grouped) {
          db.insert(caption)
            .values({
              id: randomUUID(),
              renderId,
              text: cap.text,
              startMs: cap.startMs + clip.startMs,
              endMs: cap.endMs + clip.startMs,
              style: JSON.stringify(captionStyleName),
            })
            .run();
        }

        // Cleanup temp files
        for (const f of tempFiles) {
          try {
            unlinkSync(f);
          } catch {}
        }

        projects.push({
          projectId: projId,
          renderId,
          text: clip.text,
          startMs: clip.startMs,
          endMs: clip.endMs,
          score: clip.score,
        });
      } catch (err: any) {
        db.insert(project)
          .values({
            id: projId,
            name: `Sermon (failed): ${clip.text.slice(0, 30)}...`,
            type: "sermon_clip",
            script: clip.text,
            url: body.url,
            status: "error",
            createdAt: new Date(),
          })
          .run();
        db.insert(render)
          .values({
            id: renderId,
            projectId: projId,
            status: "error",
            error: err.message,
            createdAt: new Date(),
          })
          .run();
      }
    }

    // Cleanup source audio
    try {
      unlinkSync(audioPath);
    } catch {}

    return c.json({ clips: projects });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Podcast Clip: YouTube podcast → captioned highlight clips ───

app.post("/api/podcast-clip", async (c) => {
  const body = await c.req.json();
  if (!body.url || typeof body.url !== "string") {
    return c.json({ error: "url is required" }, 400);
  }

  try {
    const { autoClip, speechToText } = await import("@crayo/ai");
    const { ASPECTS, QUALITY, ffmpeg, writeASS, mixAudio } = await import(
      "@crayo/core"
    );

    const result = await autoClip({
      url: body.url,
      clipCount: Number(body.clipCount ?? 5),
      minDuration: Number(body.minDuration ?? 15),
      maxDuration: Number(body.maxDuration ?? 60),
      language: body.language ?? "en",
    });

    if (result.clips.length === 0) {
      return c.json({ error: "No highlights detected" }, 400);
    }

    // Transcribe full audio for captions
    const audioPath = join(OUTPUT_DIR, `.podcast-audio-${randomUUID()}.mp3`);
    const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
    const audioProc = Bun.spawn(
      [
        ffmpegBin,
        "-y",
        "-i",
        result.sourcePath,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4",
        audioPath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if ((await audioProc.exited) !== 0) {
      throw new Error("Failed to extract audio");
    }

    const fullCaptions = await speechToText({
      inputPath: audioPath,
      language: body.language ?? "en",
    });

    const validPlatforms = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
    const platformKey = String(body.platform ?? "9:16");
    const platform = validPlatforms.includes(platformKey as any)
      ? (platformKey as keyof typeof ASPECTS)
      : "9:16";
    const aspect = ASPECTS[platform];

    const validQualities = Object.keys(QUALITY) as (keyof typeof QUALITY)[];
    const qualityKey = String(body.quality ?? "standard");
    const quality = validQualities.includes(qualityKey as any)
      ? (qualityKey as keyof typeof QUALITY)
      : "standard";
    const qual = QUALITY[quality];

    const captionStyleName = String(body.captionStyle ?? "bold_pop");
    const transitionType = String(body.transition ?? "crossfade");
    const bgClips = listStockClips();

    const ASS_STYLES = new Set([
      "typewriter",
      "bounce",
      "shake",
      "zoom",
      "colorful",
      "word_by_word",
      "glow",
      "neon",
    ]);

    const projects: any[] = [];
    for (let i = 0; i < result.clips.length; i++) {
      const clip = result.clips[i];
      const projId = randomUUID();
      const renderId = randomUUID();
      const clipDur = (clip.endMs - clip.startMs) / 1000;
      const clipStartSec = clip.startMs / 1000;

      try {
        const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
        const tempFiles: string[] = [];

        // Extract clip
        const segPath = join(OUTPUT_DIR, `${renderId}-seg.mp4`);
        tempFiles.push(segPath);
        await ffmpeg.run([
          "-y",
          "-ss",
          String(clipStartSec),
          "-i",
          result.sourcePath,
          "-t",
          String(clipDur),
          "-c",
          "copy",
          segPath,
        ]);

        // Get captions for this clip
        const clipCaptions = fullCaptions.filter(
          (cap) =>
            cap.startMs >= clip.startMs - 500 && cap.endMs <= clip.endMs + 500,
        );
        const relativeCaptions = clipCaptions.map((cap) => ({
          text: cap.text,
          startMs: Math.max(0, cap.startMs - clip.startMs),
          endMs: Math.min(clipDur * 1000, cap.endMs - clip.startMs),
        }));
        const grouped = groupCaptions(relativeCaptions, 4);

        // Background: crop source to 9:16 (zoomed on speaker) or use gameplay
        let renderPath = segPath;
        const cropPath = join(OUTPUT_DIR, `${renderId}-crop.mp4`);
        tempFiles.push(cropPath);
        await ffmpeg.toAspect(segPath, cropPath, platform, quality);
        renderPath = cropPath;

        // Optional gameplay overlay
        if (bgClips.length > 0 && body.bgVideo !== false) {
          const bgPath = join(OUTPUT_DIR, `${renderId}-bg.mp4`);
          tempFiles.push(bgPath);
          const bg = bgClips[i % bgClips.length];
          await ffmpeg.trim({ input: bg, end: clipDur + 2, output: bgPath });
          const compPath = join(OUTPUT_DIR, `${renderId}-comp.mp4`);
          tempFiles.push(compPath);
          await ffmpeg.composeSplitScreen(renderPath, bg, compPath, {
            bgPosition: "right",
          });
          renderPath = compPath;
        }

        // Smart zoom
        if (body.smartZoom) {
          try {
            const { detectFaces } = await import("@crayo/ai");
            const faceDataPath = join(OUTPUT_DIR, `${renderId}-faces.json`);
            tempFiles.push(faceDataPath);
            await detectFaces({
              inputPath: renderPath,
              outputPath: faceDataPath,
            });
            const zoomedPath = join(OUTPUT_DIR, `${renderId}-zoomed.mp4`);
            tempFiles.push(zoomedPath);
            await ffmpeg.smartZoom(renderPath, {
              faceDataPath,
              output: zoomedPath,
              quality,
            });
            renderPath = zoomedPath;
          } catch {}
        }

        // Mix audio
        const voiceVol = Number(body.voiceVolume ?? 1.0);
        const musicVol = Number(body.musicVolume ?? 0.1);
        const hasMusic =
          body.bgMusic !== false && listBgMusic().length > 0 && musicVol > 0;
        if (voiceVol > 0 || hasMusic) {
          const mixedAudioPath = join(
            OUTPUT_DIR,
            `${renderId}-mixed-audio.m4a`,
          );
          tempFiles.push(mixedAudioPath);
          const mixedPath = join(OUTPUT_DIR, `${renderId}-mixed.mp4`);
          tempFiles.push(mixedPath);
          const tracks: any[] = [];
          if (voiceVol > 0) tracks.push({ path: segPath, volume: voiceVol });
          if (hasMusic) {
            const bgMusic =
              listBgMusic()[Math.floor(Math.random() * listBgMusic().length)];
            tracks.push({ path: bgMusic, volume: musicVol, loop: true });
          }
          await mixAudio({
            tracks,
            sfx: [],
            duration: clipDur,
            output: mixedAudioPath,
          });
          await ffmpeg.addAudio(renderPath, mixedAudioPath, mixedPath);
          renderPath = mixedPath;
        }

        // Apply captions
        if (grouped.length > 0) {
          if (ASS_STYLES.has(captionStyleName)) {
            const assPath = join(OUTPUT_DIR, `${renderId}-captions.ass`);
            tempFiles.push(assPath);
            writeASS(
              grouped.map((t) => ({
                text: t.text,
                startMs: t.startMs,
                endMs: t.endMs,
              })),
              captionStyleName,
              assPath,
              aspect.width,
              aspect.height,
            );
            await ffmpeg.renderASS(renderPath, assPath, outPath, quality);
          } else {
            const captionStyle = buildCaptionStyle(captionStyleName);
            await ffmpeg.overlayText(
              renderPath,
              grouped.map((t) => ({ ...t, style: captionStyle })),
              outPath,
            );
          }
        } else {
          await ffmpeg.run(["-y", "-i", renderPath, "-c", "copy", outPath]);
        }

        db.insert(project)
          .values({
            id: projId,
            name: `Podcast: ${clip.text.slice(0, 40)}...`,
            type: "podcast_clip",
            script: clip.text,
            url: body.url,
            createdAt: new Date(),
          })
          .run();

        db.insert(render)
          .values({
            id: renderId,
            projectId: projId,
            status: "done",
            outputPath: outPath,
            settings: JSON.stringify({
              podcastClip: true,
              startMs: clip.startMs,
              endMs: clip.endMs,
              score: clip.score,
              sourceUrl: body.url,
              captionStyle: captionStyleName,
              platform,
              quality,
            }),
            createdAt: new Date(),
          })
          .run();

        for (const cap of grouped) {
          db.insert(caption)
            .values({
              id: randomUUID(),
              renderId,
              text: cap.text,
              startMs: cap.startMs + clip.startMs,
              endMs: cap.endMs + clip.startMs,
              style: JSON.stringify(captionStyleName),
            })
            .run();
        }

        for (const f of tempFiles) {
          try {
            unlinkSync(f);
          } catch {}
        }

        projects.push({
          projectId: projId,
          renderId,
          text: clip.text,
          startMs: clip.startMs,
          endMs: clip.endMs,
          score: clip.score,
        });
      } catch (err: any) {
        db.insert(project)
          .values({
            id: projId,
            name: `Podcast (failed): ${clip.text.slice(0, 30)}...`,
            type: "podcast_clip",
            script: clip.text,
            url: body.url,
            status: "error",
            createdAt: new Date(),
          })
          .run();
        db.insert(render)
          .values({
            id: renderId,
            projectId: projId,
            status: "error",
            error: err.message,
            createdAt: new Date(),
          })
          .run();
      }
    }

    try {
      unlinkSync(audioPath);
    } catch {}

    return c.json({ clips: projects });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Standup Comedy: YouTube special / local mp4 → comedy-optimized highlight clips ───
// This is like auto-clip but with comedy-specific post-processing:
//   • Extends clip end to capture audience laughter after each punchline
//   • Smart zoom on comedians' faces (zoom cuts for reaction shots)
//   • Punch-up title + word-by-word captions (tiktok-style "title + captions")
//   • Comedy-specific caption style defaults (bold pop, lower-third placement)

// ─── Music Edit: Beat-Synced Aesthetic Edits ───

app.post("/api/music-edit", async (c) => {
  const body = await c.req.json();
  
  // Validate inputs
  if (!body.audioFile || typeof body.audioFile !== "string") {
    return c.json({ error: "audioFile is required" }, 400);
  }
  if (!body.sourceVideos || !Array.isArray(body.sourceVideos) || body.sourceVideos.length === 0) {
    return c.json({ error: "sourceVideos array is required (min 1 video)" }, 400);
  }

  const renderId = randomUUID();
  const projId = randomUUID();
  const tempFiles: string[] = [];

  try {
    const { ASPECTS, QUALITY, ffmpeg, buildScatteredWordFilterComplex, generateViralASS } = await import("@crayo/core");
    const { detectBeats, snapToBeat, getBeatsInRange, calculateCutDensity } = await import("@crayo/ai");

    const aspect = ASPECTS[body.platform || "9:16"];
    const qual = QUALITY[body.quality || "high"];
    const cutDensity = body.cutDensity || "auto";
    const minClipLength = Number(body.minClipLength || 0.5);
    const maxClipLength = Number(body.maxClipLength || 4);
    const transitionStyle = body.transitionStyle || "cut";
    const captionStyle = body.captionStyle || "none";

    // Step 1: Detect beats in music track
    console.log("[music-edit] Detecting beats...");
    const beatGrid = await detectBeats({
      audioPath: body.audioFile,
      minBPM: 60,
      maxBPM: 200,
      threshold: 0.6,
    });

    console.log(`[music-edit] Found ${beatGrid.beats.length} beats, BPM: ${beatGrid.bpm}`);

    // Step 1.5: Analyze source videos (scene-aware selection)
    console.log("[music-edit] Analyzing source videos...");
    const { analyzeAllVideos, findBestSceneForSection } = await import("@crayo/ai");
    const { analyzeStemEnergy, matchCameraToStem } = await import("@crayo/ai");
    
    const sceneMap = await analyzeAllVideos(
      body.sourceVideos,
      5, // sample keyframe every 5 seconds
    );
    
    // Flatten all scenes into a single array
    const allScenes: Array<any> = [];
    for (const [videoPath, scenes] of sceneMap.entries()) {
      allScenes.push(...scenes);
    }
    
    console.log(`[music-edit] Analyzed ${allScenes.length} total scenes`);

    // Step 1.75: Analyze audio stems for camera switching
    console.log("[music-edit] Analyzing audio stems for camera switching...");
    const stemAnalysis = await analyzeStemEnergy(body.audioFile);
    console.log(`[music-edit] Stem analysis complete — vocals: ${stemAnalysis.vocals.energy.toFixed(2)}, drums: ${stemAnalysis.drums.energy.toFixed(2)}, bass: ${stemAnalysis.bass.energy.toFixed(2)}`);

    // Step 2: Generate cut timeline (scene-aware)
    console.log("[music-edit] Generating cut timeline...");
    const timeline: Array<{
      sourceVideo: string;
      sourceStartMs: number;
      durationMs: number;
      beatTimestamp: number;
    }> = [];

    let currentTime = 0;
    const usedScenes = new Set<number>();

    for (const section of beatGrid.sections) {
      const sectionBeats = getBeatsInRange(beatGrid, section.startMs, section.endMs);
      
      // Determine cut frequency based on energy
      let targetCutDensity: number;
      if (cutDensity === "auto") {
        targetCutDensity = calculateCutDensity(section.energy);
      } else if (cutDensity === "low") {
        targetCutDensity = 0.5;
      } else if (cutDensity === "medium") {
        targetCutDensity = 1.0;
      } else {
        targetCutDensity = 2.0; // high
      }

      // Generate cuts for this section
      const beatInterval = 1 / targetCutDensity; // seconds between cuts
      let lastCutTime = section.startMs / 1000;

      for (const beat of sectionBeats) {
        const beatSec = beat.timeMs / 1000;
        
        // Only cut if enough time has passed
        if (beatSec - lastCutTime < beatInterval) continue;

        // Calculate clip duration (time to next cut or max length)
        let clipDuration = beatInterval;
        clipDuration = Math.max(minClipLength, Math.min(maxClipLength, clipDuration));

        // SCENE-AWARE SELECTION: Find best matching scene for this section
        // Use stem analysis to determine desired camera angle
        const stemAtBeat = stemAnalysis.timeline.find(
          (s: any) => beat.timeMs >= s.startMs && beat.timeMs < s.endMs,
        );
        const dominantStem = stemAtBeat?.dominantStem || "other";
        const desiredCamera = matchCameraToStem(dominantStem);

        const bestScene = findBestSceneForSection(
          allScenes,
          section.energy,
          section.type === "chorus" ? "intense" : section.type === "intro" ? "calm" : undefined,
          usedScenes,
          desiredCamera, // NEW: pass desired camera angle
        );

        let sourceVideo: string;
        let sourceStartMs: number;

        if (bestScene) {
          // Use the best matching scene
          sourceVideo = bestScene.sourceVideo;
          sourceStartMs = bestScene.startMs;
          
          // Mark this scene as used
          const sceneIdx = allScenes.indexOf(bestScene);
          if (sceneIdx >= 0) usedScenes.add(sceneIdx);
        } else {
          // Fallback: round-robin if no good match found
          sourceVideo = body.sourceVideos[timeline.length % body.sourceVideos.length];
          sourceStartMs = Math.random() * 30000;
        }

        timeline.push({
          sourceVideo,
          sourceStartMs,
          durationMs: clipDuration * 1000,
          beatTimestamp: beat.timeMs,
        });

        currentTime += clipDuration * 1000;
        lastCutTime = beatSec;
      }
    }

    console.log(`[music-edit] Generated ${timeline.length} clips`);

    // Step 3: Extract and render segments
    console.log("[music-edit] Extracting segments...");
    const segmentPaths: string[] = [];

    for (let i = 0; i < timeline.length; i++) {
      const seg = timeline[i];
      const segPath = join(OUTPUT_DIR, `${renderId}-seg-${i}.mp4`);
      tempFiles.push(segPath);

      const startSec = seg.sourceStartMs / 1000;
      const durSec = seg.durationMs / 1000;

      // Extract segment from source video with aspect ratio conversion
      await ffmpeg.run([
        "-y",
        "-ss", String(startSec),
        "-i", seg.sourceVideo,
        "-t", String(durSec),
        "-vf", `scale=${aspect.width}:${aspect.height}:force_original_aspect_ratio=decrease,pad=${aspect.width}:${aspect.height}:(ow-iw)/2:(oh-ih)/2:black`,
        "-c:v", "libx264",
        "-preset", qual.preset,
        "-crf", String(qual.crf),
        "-c:a", "aac",
        "-b:a", "128k",
        segPath,
      ]);

      segmentPaths.push(segPath);
    }

    // Step 4: Concatenate segments with transitions
    console.log("[music-edit] Concatenating segments with transitions...");
    const concatPath = join(OUTPUT_DIR, `${renderId}-concat.mp4`);
    tempFiles.push(concatPath);

    const { concatWithTransitions, selectTransitionForEnergy, TRANSITION_PRESETS } = await import("@crayo/ai");

    // Determine transition config
    let transitionConfig;
    if (transitionStyle === "cut") {
      transitionConfig = TRANSITION_PRESETS.cut;
    } else {
      // Use energy-aware transition duration (faster on drops, slower on verses)
      // Use the overall song energy to pick a base, but individual transitions
      // will be adjusted per-section
      const avgEnergy = beatGrid.sections.length > 0
        ? (beatGrid.sections.filter((s: any) => s.energy === "high").length / beatGrid.sections.length > 0.5 ? "high" : "medium")
        : "medium";
      transitionConfig = selectTransitionForEnergy(avgEnergy as any, transitionStyle as any);
    }

    await concatWithTransitions(
      segmentPaths,
      concatPath,
      transitionConfig,
      ffmpeg.run.bind(ffmpeg),
    );

    // Step 5: Add music track
    console.log("[music-edit] Adding music track...");
    const withMusicPath = join(OUTPUT_DIR, `${renderId}-with-music.mp4`);
    tempFiles.push(withMusicPath);

    await ffmpeg.run([
      "-y",
      "-i", concatPath,
      "-i", body.audioFile,
      "-map", "0:v", // video from concat
      "-map", "1:a", // audio from music
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest", // stop when shortest input ends
      withMusicPath,
    ]);

    // Step 5.5: B-Roll Injection (if enabled)
    let brollOutputPath = withMusicPath;
    if (body.enableBroll && body.brollClips && body.brollClips.length > 0) {
      console.log("[music-edit] Injecting B-roll...");
      const { generateBRollEvents, buildBRollFilter, selectBRollBeats } = await import("@crayo/ai");

      // Select which beats get B-roll (highest energy beats)
      const brollBeats = selectBRollBeats(
        beatGrid.beats,
        body.brollRate ?? 0.2, // default 20% of beats get B-roll
      );

      // Generate B-roll events
      const brollEvents = generateBRollEvents({
        beatTimestamps: brollBeats,
        brollClips: body.brollClips.map((p: string) => ({ path: p, durationMs: 5000 })),
        injectionRate: 1.0, // we already filtered beats above
        style: body.brollStyle ?? "flash",
        maxDurationMs: 500,
        minDurationMs: 100,
      });

      if (brollEvents.length > 0) {
        console.log(`[music-edit] Injecting ${brollEvents.length} B-roll events...`);
        
        // Build B-roll filter (simple mode: flash/zoom effects on beats)
        const brollFilter = buildBRollFilter(brollEvents, aspect.width, aspect.height);

        if (brollFilter) {
          const brollPath = join(OUTPUT_DIR, `${renderId}-broll.mp4`);
          tempFiles.push(brollPath);

          await ffmpeg.run([
            "-y",
            "-i", withMusicPath,
            "-vf", brollFilter,
            "-c:v", "libx264",
            "-preset", qual.preset,
            "-crf", String(qual.crf),
            "-c:a", "copy",
            brollPath,
          ]);

          brollOutputPath = brollPath;
        }
      }
    }

    // Step 6: Add captions (if requested)
    const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
    
    if (captionStyle === "none") {
      // No captions, just rename final file
      if (brollOutputPath !== outPath) renameSync(brollOutputPath, outPath);
    } else {
      console.log("[music-edit] Adding captions...");
      
      // TODO: Add Whisper transcription for scattered captions
      // For now, skip captions if not implemented yet
      
      // If viral or scattered style, would generate here
      // For now, just copy the file
      if (brollOutputPath !== outPath) renameSync(brollOutputPath, outPath);
    }

    // Save to database
    db.insert(project)
      .values({
        id: projId,
        name: `Music Edit: ${beatGrid.bpm} BPM`,
        type: "story",
        script: `Beat-synced edit with ${timeline.length} clips`,
        createdAt: new Date(),
      })
      .run();

    db.insert(render)
      .values({
        id: renderId,
        projectId: projId,
        status: "done",
        outputPath: outPath,
        settings: JSON.stringify({
          musicEdit: true,
          bpm: beatGrid.bpm,
          clipCount: timeline.length,
          cutDensity,
          sections: beatGrid.sections,
        }),
        createdAt: new Date(),
      })
      .run();

    // Cleanup temp files
    for (const f of tempFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }

    return c.json({
      success: true,
      projectId: projId,
      renderId,
      outputPath: `/renders/${renderId}.mp4`,
      metadata: {
        bpm: beatGrid.bpm,
        sections: beatGrid.sections,
        totalClips: timeline.length,
        durationMs: timeline.reduce((sum, t) => sum + t.durationMs, 0),
      },
    });

  } catch (err: any) {
    console.error("[music-edit] Error:", err);
    
    // Cleanup on error
    for (const f of tempFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }
    
    return c.json({ error: err.message, stack: err.stack }, 500);
  }
});

app.post("/api/standup-clip", async (c) => {
  const body = await c.req.json();
  const hasUrl = body.url && typeof body.url === "string";
  const hasLocalFile =
    body.localFilePath && typeof body.localFilePath === "string";
  if (!hasUrl && !hasLocalFile) {
    return c.json(
      { error: "either url or localFilePath is required" },
      400,
    );
  }

  const { autoClip, detectFaces } = await import("@crayo/ai");
  const { ASPECTS, QUALITY, ffmpeg, writeASS } = await import(
    "@crayo/core"
  );

  try {
    const result = await autoClip({
      url: hasUrl ? body.url : undefined,
      localFilePath: hasLocalFile ? body.localFilePath : undefined,
      clipCount: Number(body.clipCount ?? 5),
      minDuration: Number(body.minDuration ?? 30),
      maxDuration: Number(body.maxDuration ?? 90),
      language: body.language ?? "en",
    });

    if (result.clips.length === 0) {
      return c.json({ error: "No highlights detected" }, 400);
    }

    // Resolve settings
    const validPlatforms = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
    const platformKey = String(body.platform ?? "9:16");
    const platform = validPlatforms.includes(platformKey as any)
      ? (platformKey as keyof typeof ASPECTS)
      : "9:16";
    const aspect = ASPECTS[platform];

    const validQualities = Object.keys(QUALITY) as (keyof typeof QUALITY)[];
    const qualityKey = String(body.quality ?? "standard");
    const quality = validQualities.includes(qualityKey as any)
      ? (qualityKey as keyof typeof QUALITY)
      : "standard";
    const qual = QUALITY[quality];

    const captionStyleName = String(body.captionStyle ?? "bold_pop");
    const titleStyle = String(body.titleStyle ?? "bold_pop");
    const hookIntro = String(body.hookIntro ?? "Wait... until you hear this");
    const extendLaughter = body.extendForLaughter !== false;
    const zoomOnLaughter = body.zoomOnLaughter !== false;

    const bgClips = listStockClips();

    const projects: any[] = [];
    for (let i = 0; i < result.clips.length; i++) {
      const clip = result.clips[i];
      const projId = randomUUID();
      const renderId = randomUUID();
      const clipDur = (clip.endMs - clip.startMs) / 1000;
      const clipStartSec = clip.startMs / 1000;

      try {
        const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
        const tempFiles: string[] = [];

        // Extract clip segment from source
        const segPath = join(OUTPUT_DIR, `${renderId}-seg.mp4`);
        tempFiles.push(segPath);
        await ffmpeg.run([
          "-y",
          "-ss",
          String(clipStartSec),
          "-i",
          result.sourcePath,
          "-t",
          String((clip.endMs - clip.startMs) / 1000),
          "-c",
          "copy",
          segPath,
        ]);

        // Comedy tweak #1: extend for laughter via speech-gap detection
        let actualEndMs = clip.endMs;
        let actualEndSec = clipDur;
        let actualDur = clipDur;
        if (extendLaughter) {
          // Find the next speech segment after this clip ends
          const allCaps = result.allCaptions || [];
          const nextSpeech = allCaps.find(
            (cap: any) => cap.startMs > clip.endMs + 500,
          );
          const gapToNext = nextSpeech
            ? nextSpeech.startMs - clip.endMs
            : Infinity;

          // Extend to capture audience laughter, but:
          // - only up to 10s max (avoid dead air)
          // - only if the gap is < 5s (crowd laughing, not end of show)
          // - if next speech resumes quickly (gap < 2s) and the new
          //   caption is a continuation of the same joke, merge it into
          //   this clip (related jokes stay together)
          let extension = 0;
          if (gapToNext > 500 && gapToNext < 5000) {
            // Audience pause (laughter) between punchline and next line
            extension = Math.min(gapToNext, 10000);
          } else if (gapToNext >= 0 && gapToNext < 2000) {
            // Very short gap — likely a continuation of the same bit.
            // Extend to the end of the next speech + its trailing gap.
            let curEnd = nextSpeech.endMs;
            let curCap = nextSpeech;
            // Keep chaining subsequent sentences that follow with < 2s gaps
            // (same joke/story thread)
            while (curEnd < clip.endMs + 12000) {
              const after = allCaps.find(
                (cap: any) => cap.startMs > curEnd + 500,
              );
              if (!after) break;
              const nextGap = after.startMs - curEnd;
              if (nextGap > 2000) break; // new joke topic — stop
              curEnd = after.endMs;
              curCap = after;
            }
            extension = Math.min(curCap.endMs - clip.endMs, 10000);
          }

          if (extension > 500) {
            actualEndMs = clip.endMs + extension;
            const extDur = (actualEndMs - clip.startMs) / 1000;
            // Re-extract with extended duration
            await ffmpeg.run([
              "-y",
              "-ss",
              String(clipStartSec),
              "-i",
              result.sourcePath,
              "-t",
              String(extDur),
              "-c",
              "copy",
              segPath,
            ]);
            actualEndSec = extDur;
            actualDur = extDur;
          }
        }

        // Reformat to target aspect ratio (e.g. 9:16 for TikTok)
        const fmtPath = join(OUTPUT_DIR, `${renderId}-fmt.mp4`);
        tempFiles.push(fmtPath);
        await ffmpeg.run([
          "-y",
          "-i",
          segPath,
          "-vf",
          `scale=${aspect.width}:${aspect.height}:force_original_aspect_ratio=decrease,pad=${aspect.width}:${aspect.height}:(ow-iw)/2:(oh-ih)/2:black`,
          "-c:v",
          "libx264",
          "-preset",
          qual.preset,
          "-crf",
          String(qual.crf),
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          fmtPath,
        ]);

        // Detect faces for smart zoom
        let faceData: any = null;
        let faceKeyframes: any[] = [];
        if (zoomOnLaughter) {
          try {
            const faceOutPath = join(OUTPUT_DIR, `${renderId}-faces.json`);
            tempFiles.push(faceOutPath);
            faceData = await detectFaces({
              inputPath: fmtPath,
              outputPath: faceOutPath,
              sampleFps: 3,
            });
            faceKeyframes = faceData?.keyframes || [];
          } catch (e) {
            console.warn("Face detection failed:", e);
          }
        }

        // Build background
        let renderPath = fmtPath;
        if (bgClips.length > 0 && body.bgVideo !== false) {
          const bgPath = join(OUTPUT_DIR, `${renderId}-bg.mp4`);
          tempFiles.push(bgPath);
          const bg = bgClips[i % bgClips.length];
          await ffmpeg.trim({
            input: bg,
            end: actualDur + 2,
            output: bgPath,
          });
          const compositedPath = join(OUTPUT_DIR, `${renderId}-comp.mp4`);
          tempFiles.push(compositedPath);
          await ffmpeg.composeSplitScreen(fmtPath, bg, compositedPath, {
            bgPosition: "right",
          });
          renderPath = compositedPath;
        }

        // Comedy tweaks #2 & #3: title overlay + captions + smart zoom
        const titleText = clip.suggestedTitle || hookIntro;
        const captionText = clip.captions || [];

        if (faceKeyframes.length > 0 && zoomOnLaughter) {
          // Smart zoom + captions + title
          // Build captions ASS
          const assPath = join(OUTPUT_DIR, `${renderId}-captions.ass`);
          tempFiles.push(assPath);
          writeASS(
            captionText.map((c) => ({
              text: c.text,
              startMs: c.startMs,
              endMs: c.endMs,
            })),
            captionStyleName,
            assPath,
            aspect.width,
            aspect.height,
          );

          // Use smart zoom with face tracking then overlay captions + title
          const zoomedPath = join(OUTPUT_DIR, `${renderId}-zoomed.mp4`);
          tempFiles.push(zoomedPath);

          const cropW = Math.round(aspect.width * 0.55);
          const cropH = Math.round(aspect.height * 0.55);
          const facePoints = faceKeyframes.map((kf: any) => {
            const faceCx = kf.x + kf.w / 2;
            const faceCy = kf.y + kf.h / 2;
            return {
              t: kf.t,
              cx: Math.max(cropW / 2, Math.min(aspect.width - cropW / 2, faceCx * (aspect.width / faceData.width))),
              cy: Math.max(cropH / 2, Math.min(aspect.height - cropH / 2, faceCy * (aspect.height / faceData.height))),
            };
          });

          // Build zoom expressions
          const buildExpr = (dim: "cx" | "cy", cropDim: number, srcDim: number) => {
            const segs: { t0: number; t1: number; expr: string }[] = [];
            for (let i = 0; i < facePoints.length - 1; i++) {
              const t0 = facePoints[i].t;
              const t1 = facePoints[i + 1].t;
              const v0 = facePoints[i][dim] - cropDim / 2;
              const v1 = facePoints[i + 1][dim] - cropDim / 2;
              const dt = t1 - t0;
              if (dt <= 0) continue;
              const val = `clip(${v0.toFixed(1)}+(${(v1 - v0).toFixed(1)})*(t-${t0.toFixed(3)})/${dt.toFixed(3)},0,${(srcDim - cropDim).toFixed(1)})`;
              segs.push({ t0, t1, expr: val });
            }
            if (segs.length === 0) return "0";
            let expr = segs[segs.length - 1].expr;
            for (let i = segs.length - 2; i >= 0; i--) {
              expr = `if(gte(t,${segs[i].t0}),${segs[i].expr},${expr})`;
            }
            return expr;
          };

          const xExpr = buildExpr("cx", cropW, aspect.width);
          const yExpr = buildExpr("cy", cropH, aspect.height);

          await ffmpeg.run([
            "-y",
            "-i",
            renderPath,
            "-vf",
            `crop=${cropW}:${cropH}:${xExpr}:${yExpr},scale=${aspect.width}:${aspect.height}`,
            "-c:v",
            "libx264",
            "-preset",
            qual.preset,
            "-crf",
            String(qual.crf),
            "-c:a",
            "copy",
            zoomedPath,
          ]);

          // Apply captions + title on the zoomed video
          const titleY = Math.floor(aspect.height * 0.1);
          const captionY = Math.floor(aspect.height * 0.72);
          await ffmpeg.run([
            "-y",
            "-i",
            zoomedPath,
            "-vf",
            `ass=${assPath},drawtext=text='${titleText.replace(/'/g, "'\\''")}':fontsize=${Math.floor(aspect.height / 20)}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${titleY}`,
            "-c:v",
            "libx264",
            "-preset",
            qual.preset,
            "-crf",
            String(qual.crf),
            "-c:a",
            "copy",
            outPath,
          ]);
        } else {
          // Standard render with title + captions (no zoom)
          const assPath = join(OUTPUT_DIR, `${renderId}-captions.ass`);
          tempFiles.push(assPath);
          writeASS(
            captionText.map((c) => ({
              text: c.text,
              startMs: c.startMs,
              endMs: c.endMs,
            })),
            captionStyleName,
            assPath,
            aspect.width,
            aspect.height,
          );

          const titleY = Math.floor(aspect.height * 0.1);
          await ffmpeg.run([
            "-y",
            "-i",
            renderPath,
            "-vf",
            `ass=${assPath},drawtext=text='${titleText.replace(/'/g, "'\\''")}':fontsize=${Math.floor(aspect.height / 20)}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${titleY}`,
            "-c:v",
            "libx264",
            "-preset",
            qual.preset,
            "-crf",
            String(qual.crf),
            "-c:a",
            "copy",
            outPath,
          ]);
        }

        // Record project + render
        db.insert(project)
          .values({
            id: projId,
            name: `Standup clip: ${clip.text.slice(0, 40)}...`,
            type: "story",
            script: clip.text,
            clientId: body.clientId ?? undefined,
            createdAt: new Date(),
          })
          .run();

        db.insert(render)
          .values({
            id: renderId,
            projectId: projId,
            status: "done",
            outputPath: outPath,
            settings: JSON.stringify({
              standupClip: true,
              startMs: clip.startMs,
              endMs: actualEndMs,
              score: clip.score,
              sourceUrl: hasUrl ? body.url : undefined,
              sourceUpload: hasLocalFile ? body.localFilePath : undefined,
              smartZoom: zoomOnLaughter,
              extendedForLaughter: extendLaughter && actualEndMs > clip.endMs,
            }),
            createdAt: new Date(),
          })
          .run();

        projects.push({
          projectId: projId,
          renderId,
          text: clip.text,
          startMs: clip.startMs,
          endMs: actualEndMs > clip.endMs ? actualEndMs : clip.endMs,
          score: clip.score,
        });

        // Cleanup
        for (const f of tempFiles) {
          try {
            const { unlinkSync } = await import("fs");
            unlinkSync(f);
          } catch {}
        }
      } catch (err: any) {
        console.error(`Failed to render standup clip ${i}:`, err.message);
        const projId = randomUUID();
        const renderId = randomUUID();
        db.insert(project)
          .values({
            id: projId,
            name: `Standup clip: ${clip.text.slice(0, 40)}...`,
            type: "story",
            script: clip.text,
            createdAt: new Date(),
          })
          .run();
        db.insert(render)
          .values({
            id: renderId,
            projectId: projId,
            status: "done",
            outputPath: clip.path,
            settings: JSON.stringify({
              standupClip: true,
              startMs: clip.startMs,
              endMs: clip.endMs,
              score: clip.score,
            }),
            createdAt: new Date(),
          })
          .run();
        projects.push({
          projectId: projId,
          renderId,
          text: clip.text,
          startMs: clip.startMs,
          endMs: clip.endMs,
          score: clip.score,
        });
      }
    }

    return c.json({ clips: projects });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Reaction: picture-in-picture compositing ───

app.post("/api/reaction", async (c) => {
  const body = await c.req.json();
  if (!body.mainUrl || typeof body.mainUrl !== "string") {
    return c.json({ error: "mainUrl is required" }, 400);
  }
  if (!body.reactionUrl || typeof body.reactionUrl !== "string") {
    return c.json({ error: "reactionUrl is required" }, 400);
  }

  try {
    const { ASPECTS, QUALITY, ffmpeg } = await import("@crayo/core");

    const validPlatforms = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
    const platformKey = String(body.platform ?? "9:16");
    const platform = validPlatforms.includes(platformKey as any)
      ? (platformKey as keyof typeof ASPECTS)
      : "9:16";
    const aspect = ASPECTS[platform];

    const validQualities = Object.keys(QUALITY) as (keyof typeof QUALITY)[];
    const qualityKey = String(body.quality ?? "standard");
    const quality = validQualities.includes(qualityKey as any)
      ? (qualityKey as keyof typeof QUALITY)
      : "standard";
    const qual = QUALITY[quality];

    const projId = randomUUID();
    const renderId = randomUUID();
    const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
    const tempFiles: string[] = [];

    // Download main video
    const mainPath = join(OUTPUT_DIR, `${renderId}-main.mp4`);
    tempFiles.push(mainPath);
    await downloadVideo(body.mainUrl, mainPath);

    // Download reaction video
    const reactionPath = join(OUTPUT_DIR, `${renderId}-reaction.mp4`);
    tempFiles.push(reactionPath);
    await downloadVideo(body.reactionUrl, reactionPath);

    // Get main video duration
    const mainDur = await ffmpeg.getDuration(mainPath);

    // Format main video to target aspect
    const mainFormatted = join(OUTPUT_DIR, `${renderId}-main-fmt.mp4`);
    tempFiles.push(mainFormatted);
    await ffmpeg.toAspect(mainPath, mainFormatted, platform, quality);

    // PiP settings
    const pipPos = String(body.pipPosition ?? "bottom-right");
    const pipSize = Number(body.pipSize ?? 0.3);

    // PiP overlay using ffmpeg filter_complex
    const pipW = Math.round(aspect.width * pipSize);
    const pipH = Math.round(aspect.height * pipSize);
    const margin = 20;

    let xExpr: string;
    let yExpr: string;
    switch (pipPos) {
      case "top-left":
        xExpr = String(margin);
        yExpr = String(margin);
        break;
      case "top-right":
        xExpr = `${aspect.width}-${pipW}-${margin}`;
        yExpr = String(margin);
        break;
      case "bottom-left":
        xExpr = String(margin);
        yExpr = `${aspect.height}-${pipH}-${margin}`;
        break;
      default:
        xExpr = `${aspect.width}-${pipW}-${margin}`;
        yExpr = `${aspect.height}-${pipH}-${margin}`;
    }

    const filterComplex = [
      `[1:v]scale=${pipW}:${pipH},format=yuv420p[pip]`,
      `[0:v][pip]overlay=${xExpr}:${yExpr}`,
    ].join(";");

    const compProc = Bun.spawn(
      [
        "ffmpeg",
        "-y",
        "-i",
        mainFormatted,
        "-i",
        reactionPath,
        "-filter_complex",
        filterComplex,
        "-t",
        String(mainDur),
        "-c:v",
        "libx264",
        "-preset",
        qual.preset,
        "-crf",
        String(qual.crf),
        "-c:a",
        "copy",
        outPath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const compErr = await new Response(compProc.stderr).text();
    if ((await compProc.exited) !== 0) {
      throw new Error(`PiP composition failed: ${compErr.slice(-500)}`);
    }

    db.insert(project)
      .values({
        id: projId,
        name: `Reaction: ${body.mainUrl.slice(0, 50)}...`,
        type: "reaction",
        url: body.mainUrl,
        createdAt: new Date(),
      })
      .run();

    db.insert(render)
      .values({
        id: renderId,
        projectId: projId,
        status: "done",
        outputPath: outPath,
        settings: JSON.stringify({
          reaction: true,
          mainUrl: body.mainUrl,
          reactionUrl: body.reactionUrl,
          pipPosition: pipPos,
          pipSize,
          platform,
          quality,
        }),
        createdAt: new Date(),
      })
      .run();

    for (const f of tempFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }

    return c.json({
      projectId: projId,
      renderId,
      status: "done",
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Top List: countdown list with dramatic reveals ───

app.post("/api/top-list", async (c) => {
  const body = await c.req.json();
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: "items array is required" }, 400);
  }

  try {
    const { ASPECTS, QUALITY, ffmpeg, writeASS, mixAudio } = await import(
      "@crayo/core"
    );
    const { textToSpeech } = await import("@crayo/ai");

    const validPlatforms = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
    const platformKey = String(body.platform ?? "9:16");
    const platform = validPlatforms.includes(platformKey as any)
      ? (platformKey as keyof typeof ASPECTS)
      : "9:16";
    const aspect = ASPECTS[platform];

    const validQualities = Object.keys(QUALITY) as (keyof typeof QUALITY)[];
    const qualityKey = String(body.quality ?? "standard");
    const quality = validQualities.includes(qualityKey as any)
      ? (qualityKey as keyof typeof QUALITY)
      : "standard";
    const qual = QUALITY[quality];

    const title = String(body.title ?? "Top List");
    const items: string[] = body.items;
    const revealDur = Number(body.revealDuration ?? 3);
    const captionStyleName = String(body.captionStyle ?? "bold_pop");
    const voice = body.voice ?? "en-US-GuyNeural";
    const voiceVol = Number(body.voiceVolume ?? 1.0);
    const musicVol = Number(body.musicVolume ?? 0.15);

    const projId = randomUUID();
    const renderId = randomUUID();
    const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
    const tempFiles: string[] = [];

    // Title card (3s) + each item (revealDur) + outro (2s)
    const titleDur = 3;
    const outroDur = 2;
    const totalDur = titleDur + items.length * revealDur + outroDur;

    // Generate narration for each item
    let narrationPath: string | null = null;
    if (voiceVol > 0) {
      const narrationText = [
        title + ".",
        ...items.map((item, i) => `Number ${items.length - i}. ${item}.`),
      ].join("\n\n");
      narrationPath = join(OUTPUT_DIR, `${renderId}-narration.mp3`);
      tempFiles.push(narrationPath);
      await textToSpeech({
        text: narrationText,
        voice,
        outputPath: narrationPath,
      });
    }

    // Build text overlays for each section
    const overlays: {
      text: string;
      startMs: number;
      endMs: number;
      style: any;
    }[] = [];

    const titleStyle = {
      fontSize: 56,
      fontColor: "white",
      position: "center" as const,
      outline: true,
      outlineColor: "black",
    };
    const numStyle = {
      fontSize: 80,
      fontColor: "#e63946",
      position: "center" as const,
      outline: true,
      outlineColor: "black",
    };
    const itemStyle = {
      fontSize: 42,
      fontColor: "white",
      position: "bottom" as const,
      outline: true,
      outlineColor: "black",
    };

    // Title card
    overlays.push({
      text: title,
      startMs: 0,
      endMs: titleDur * 1000,
      style: titleStyle,
    });

    // Items
    for (let i = 0; i < items.length; i++) {
      const itemStartMs = (titleDur + i * revealDur) * 1000;
      const itemEndMs = itemStartMs + revealDur * 1000;
      const num = items.length - i;

      // Number reveal (first half)
      overlays.push({
        text: `#${num}`,
        startMs: itemStartMs,
        endMs: itemStartMs + 1000,
        style: numStyle,
      });

      // Item text (after number)
      overlays.push({
        text: items[i],
        startMs: itemStartMs + 800,
        endMs: itemEndMs,
        style: itemStyle,
      });
    }

    // Create background
    const bgPath = join(OUTPUT_DIR, `${renderId}-bg.mp4`);
    tempFiles.push(bgPath);

    const bgClips = listStockClips();
    if (bgClips.length > 0 && body.bgVideo !== false) {
      const bg = bgClips[Math.floor(Math.random() * bgClips.length)];
      await ffmpeg.trim({ input: bg, end: totalDur + 2, output: bgPath });
      await ffmpeg.toAspect(bgPath, bgPath, platform, quality);
    } else {
      await ffmpeg.run([
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=${aspect.width}x${aspect.height}:d=${totalDur}`,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        String(totalDur),
        "-c:v",
        "libx264",
        "-preset",
        qual.preset,
        "-crf",
        String(qual.crf),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        bgPath,
      ]);
    }

    // Overlay text
    const withTextPath = join(OUTPUT_DIR, `${renderId}-text.mp4`);
    tempFiles.push(withTextPath);
    await ffmpeg.overlayText(bgPath, overlays, withTextPath);

    // Mix audio
    if (narrationPath || (body.bgMusic !== false && listBgMusic().length > 0)) {
      const mixedAudioPath = join(OUTPUT_DIR, `${renderId}-mixed-audio.m4a`);
      tempFiles.push(mixedAudioPath);
      const mixedPath = join(OUTPUT_DIR, `${renderId}-mixed.mp4`);
      tempFiles.push(mixedPath);

      const tracks: any[] = [];
      if (narrationPath && voiceVol > 0) {
        tracks.push({ path: narrationPath, volume: voiceVol });
      }
      if (body.bgMusic !== false && listBgMusic().length > 0 && musicVol > 0) {
        const bgMusic =
          listBgMusic()[Math.floor(Math.random() * listBgMusic().length)];
        tracks.push({ path: bgMusic, volume: musicVol, loop: true });
      }
      await mixAudio({
        tracks,
        sfx: [],
        duration: totalDur,
        output: mixedAudioPath,
      });
      await ffmpeg.addAudio(withTextPath, mixedAudioPath, outPath);
    } else {
      await ffmpeg.run(["-y", "-i", withTextPath, "-c", "copy", outPath]);
    }

    db.insert(project)
      .values({
        id: projId,
        name: `${title} (${items.length} items)`,
        type: "top_list",
        script: items.join("\n"),
        createdAt: new Date(),
      })
      .run();

    db.insert(render)
      .values({
        id: renderId,
        projectId: projId,
        status: "done",
        outputPath: outPath,
        settings: JSON.stringify({
          topList: true,
          title,
          itemCount: items.length,
          platform,
          quality,
        }),
        createdAt: new Date(),
      })
      .run();

    for (const f of tempFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }

    return c.json({
      projectId: projId,
      renderId,
      status: "done",
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Silence Removal ───

app.post("/api/remove-silence", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  const inputPath = body.inputPath.startsWith("/")
    ? body.inputPath
    : join(ROOT, body.inputPath);
  const id = randomUUID();
  const outPath = join(OUTPUT_DIR, `${id}-no-silence.mp4`);

  try {
    const { removeSilence } = await import("@crayo/ai");
    const result = await removeSilence({
      inputPath,
      outputPath: outPath,
      threshold: Number(body.threshold ?? -30),
      minDuration: Number(body.minDuration ?? 0.5),
    });
    return c.json({
      id,
      path: `/renders/${id}-no-silence.mp4`,
      removedMs: result.removedMs,
      segments: result.segments,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Batch Clip: process multiple clips with progress tracking ───

app.post("/api/batch-clip", async (c) => {
  const body = await c.req.json();
  if (!body.url || typeof body.url !== "string") {
    return c.json({ error: "url is required" }, 400);
  }
  if (
    !body.templateId ||
    !["sermon_clip", "podcast_clip"].includes(body.templateId)
  ) {
    return c.json(
      { error: "templateId must be sermon_clip or podcast_clip" },
      400,
    );
  }

  const batchId = randomUUID();

  db.insert(batch)
    .values({
      id: batchId,
      url: body.url,
      templateId: body.templateId,
      status: "processing",
      totalClips: 0,
      completedClips: 0,
      createdAt: new Date(),
    })
    .run();

  // Process in background — don't await
  processBatch(batchId, body).catch((err) => {
    db.update(batch)
      .set({ status: "error", error: err.message })
      .where(eq(batch.id, batchId))
      .run();
  });

  return c.json({ batchId, status: "processing" });
});

app.get("/api/batch/:id/status", async (c) => {
  const row = db
    .select()
    .from(batch)
    .where(eq(batch.id, c.req.param("id")))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({
    id: row.id,
    url: row.url,
    templateId: row.templateId,
    status: row.status,
    totalClips: row.totalClips,
    completedClips: row.completedClips,
    error: row.error,
    clips: row.resultJson ? JSON.parse(row.resultJson) : null,
    createdAt: row.createdAt,
  });
});

async function processBatch(batchId: string, body: any) {
  const { autoClip, speechToText } = await import("@crayo/ai");
  const { ASPECTS, QUALITY, ffmpeg, writeASS, mixAudio } = await import(
    "@crayo/core"
  );

  // Step 1: Download + detect highlights
  const result = await autoClip({
    url: body.url,
    clipCount: Number(body.clipCount ?? 5),
    minDuration: Number(body.minDuration ?? 15),
    maxDuration: Number(body.maxDuration ?? 60),
    language: body.language ?? "en",
  });

  if (result.clips.length === 0) {
    throw new Error("No highlights detected");
  }

  // Update total clips
  db.update(batch)
    .set({ totalClips: result.clips.length })
    .where(eq(batch.id, batchId))
    .run();

  // Step 2: Transcribe full audio
  const audioPath = join(OUTPUT_DIR, `.batch-audio-${randomUUID()}.mp3`);
  const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
  const audioProc = Bun.spawn(
    [
      ffmpegBin,
      "-y",
      "-i",
      result.sourcePath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "4",
      audioPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if ((await audioProc.exited) !== 0) {
    throw new Error("Failed to extract audio");
  }

  const fullCaptions = await speechToText({
    inputPath: audioPath,
    language: body.language ?? "en",
  });

  // Resolve settings
  const validPlatforms = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
  const platformKey = String(body.platform ?? "9:16");
  const platform = validPlatforms.includes(platformKey as any)
    ? (platformKey as keyof typeof ASPECTS)
    : "9:16";
  const aspect = ASPECTS[platform];

  const validQualities = Object.keys(QUALITY) as (keyof typeof QUALITY)[];
  const qualityKey = String(body.quality ?? "standard");
  const quality = validQualities.includes(qualityKey as any)
    ? (qualityKey as keyof typeof QUALITY)
    : "standard";
  const qual = QUALITY[quality];

  const captionStyleName = String(body.captionStyle ?? "bold_pop");
  const hookIntro = String(body.hookIntro ?? "");
  const bgClips = listStockClips();

  const ASS_STYLES = new Set([
    "typewriter",
    "bounce",
    "shake",
    "zoom",
    "colorful",
    "word_by_word",
    "glow",
    "neon",
  ]);

  // Step 3: Render each clip
  const projects: any[] = [];
  for (let i = 0; i < result.clips.length; i++) {
    const clip = result.clips[i];
    const projId = randomUUID();
    const renderId = randomUUID();
    const clipDur = (clip.endMs - clip.startMs) / 1000;
    const clipStartSec = clip.startMs / 1000;

    try {
      const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);
      const tempFiles: string[] = [];

      // Extract clip
      const segPath = join(OUTPUT_DIR, `${renderId}-seg.mp4`);
      tempFiles.push(segPath);
      await ffmpeg.run([
        "-y",
        "-ss",
        String(clipStartSec),
        "-i",
        result.sourcePath,
        "-t",
        String(clipDur),
        "-c",
        "copy",
        segPath,
      ]);

      // Silence removal: trim silent parts from clip
      let clipSourcePath = segPath;
      let clipDurationMult = 1;
      if (body.silenceRemoval) {
        try {
          const { removeSilence } = await import("@crayo/ai");
          const noSilencePath = join(OUTPUT_DIR, `${renderId}-nosilence.mp4`);
          tempFiles.push(noSilencePath);
          const silenceResult = await removeSilence({
            inputPath: segPath,
            outputPath: noSilencePath,
          });
          if (silenceResult.removedMs > 0) {
            clipSourcePath = noSilencePath;
            const newDur = await ffmpeg.getDuration(noSilencePath);
            clipDurationMult = newDur / clipDur;
          }
        } catch {}
      }

      // Get captions for this clip
      const clipCaptions = fullCaptions.filter(
        (cap) =>
          cap.startMs >= clip.startMs - 500 && cap.endMs <= clip.endMs + 500,
      );
      const relativeCaptions = clipCaptions.map((cap) => ({
        text: cap.text,
        startMs: Math.max(0, cap.startMs - clip.startMs),
        endMs: Math.min(clipDur * 1000, cap.endMs - clip.startMs),
      }));
      const grouped = groupCaptions(relativeCaptions, 4);

      // Background
      let renderPath = clipSourcePath;
      if (bgClips.length > 0 && body.bgVideo !== false) {
        const bgPath = join(OUTPUT_DIR, `${renderId}-bg.mp4`);
        tempFiles.push(bgPath);
        const bg = bgClips[i % bgClips.length];
        const bgDur =
          clipDurationMult > 1 ? clipDur * clipDurationMult + 2 : clipDur + 2;
        await ffmpeg.trim({ input: bg, end: bgDur, output: bgPath });
        const compPath = join(OUTPUT_DIR, `${renderId}-comp.mp4`);
        tempFiles.push(compPath);
        await ffmpeg.composeSplitScreen(clipSourcePath, bg, compPath, {
          bgPosition: "right",
        });
        renderPath = compPath;
      }

      // Format to aspect
      const aspectPath = join(OUTPUT_DIR, `${renderId}-aspect.mp4`);
      tempFiles.push(aspectPath);
      await ffmpeg.toAspect(renderPath, aspectPath, platform, quality);
      renderPath = aspectPath;

      // Smart zoom
      if (body.smartZoom && bgClips.length > 0) {
        try {
          const { detectFaces } = await import("@crayo/ai");
          const faceDataPath = join(OUTPUT_DIR, `${renderId}-faces.json`);
          tempFiles.push(faceDataPath);
          await detectFaces({
            inputPath: renderPath,
            outputPath: faceDataPath,
          });
          const zoomedPath = join(OUTPUT_DIR, `${renderId}-zoomed.mp4`);
          tempFiles.push(zoomedPath);
          await ffmpeg.smartZoom(renderPath, {
            faceDataPath,
            output: zoomedPath,
            quality,
          });
          renderPath = zoomedPath;
        } catch {}
      }

      // Mix audio
      const voiceVol = Number(body.voiceVolume ?? 1.0);
      const musicVol = Number(body.musicVolume ?? 0.15);
      const hasMusic =
        body.bgMusic !== false && listBgMusic().length > 0 && musicVol > 0;
      if (voiceVol > 0 || hasMusic) {
        const mixedAudioPath = join(OUTPUT_DIR, `${renderId}-mixed-audio.m4a`);
        tempFiles.push(mixedAudioPath);
        const mixedPath = join(OUTPUT_DIR, `${renderId}-mixed.mp4`);
        tempFiles.push(mixedPath);
        const tracks: any[] = [];
        if (voiceVol > 0)
          tracks.push({ path: clipSourcePath, volume: voiceVol });
        if (hasMusic) {
          const bgMusic =
            listBgMusic()[Math.floor(Math.random() * listBgMusic().length)];
          tracks.push({ path: bgMusic, volume: musicVol, loop: true });
        }
        await mixAudio({
          tracks,
          sfx: [],
          duration: clipDur,
          output: mixedAudioPath,
        });
        await ffmpeg.addAudio(renderPath, mixedAudioPath, mixedPath);
        renderPath = mixedPath;
      }

      // Apply captions
      if (grouped.length > 0) {
        if (ASS_STYLES.has(captionStyleName)) {
          const assPath = join(OUTPUT_DIR, `${renderId}-captions.ass`);
          tempFiles.push(assPath);
          writeASS(
            grouped.map((t) => ({
              text: t.text,
              startMs: t.startMs,
              endMs: t.endMs,
            })),
            captionStyleName,
            assPath,
            aspect.width,
            aspect.height,
          );
          await ffmpeg.renderASS(renderPath, assPath, outPath, quality);
        } else {
          const captionStyle = buildCaptionStyle(captionStyleName);
          await ffmpeg.overlayText(
            renderPath,
            grouped.map((t) => ({ ...t, style: captionStyle })),
            outPath,
          );
        }
      } else {
        await ffmpeg.run(["-y", "-i", renderPath, "-c", "copy", outPath]);
      }

      // Hook intro overlay
      if (hookIntro && body.templateId === "sermon_clip") {
        const withHookPath = join(OUTPUT_DIR, `${renderId}-hook.mp4`);
        tempFiles.push(withHookPath);
        await ffmpeg.overlayText(
          outPath,
          [
            {
              text: hookIntro,
              startMs: 0,
              endMs: 3000,
              style: {
                fontSize: 56,
                fontColor: "white",
                position: "center",
                outline: true,
                outlineColor: "black",
              },
            },
          ],
          withHookPath,
        );
        const { renameSync } = await import("fs");
        unlinkSync(outPath);
        renameSync(withHookPath, outPath);
      }

      db.insert(project)
        .values({
          id: projId,
          name: `Batch: ${clip.text.slice(0, 40)}...`,
          type: body.templateId,
          script: clip.text,
          url: body.url,
          createdAt: new Date(),
        })
        .run();

      db.insert(render)
        .values({
          id: renderId,
          projectId: projId,
          status: "done",
          outputPath: outPath,
          settings: JSON.stringify({
            batchId,
            startMs: clip.startMs,
            endMs: clip.endMs,
            score: clip.score,
            sourceUrl: body.url,
            captionStyle: captionStyleName,
            platform,
            quality,
          }),
          createdAt: new Date(),
        })
        .run();

      for (const cap of grouped) {
        db.insert(caption)
          .values({
            id: randomUUID(),
            renderId,
            text: cap.text,
            startMs: cap.startMs + clip.startMs,
            endMs: cap.endMs + clip.startMs,
            style: JSON.stringify(captionStyleName),
          })
          .run();
      }

      for (const f of tempFiles) {
        try {
          unlinkSync(f);
        } catch {}
      }

      projects.push({
        projectId: projId,
        renderId,
        text: clip.text,
        startMs: clip.startMs,
        endMs: clip.endMs,
        score: clip.score,
      });
    } catch (err: any) {
      projects.push({
        projectId: projId,
        renderId,
        text: clip.text,
        startMs: clip.startMs,
        endMs: clip.endMs,
        score: clip.score,
        error: err.message,
      });
    }

    // Update progress
    db.update(batch)
      .set({ completedClips: i + 1 })
      .where(eq(batch.id, batchId))
      .run();
  }

  // Cleanup
  try {
    unlinkSync(audioPath);
  } catch {}

  // Mark done
  db.update(batch)
    .set({
      status: "done",
      completedClips: result.clips.length,
      resultJson: JSON.stringify(projects),
    })
    .where(eq(batch.id, batchId))
    .run();
}

// ─── Reddit scraper ───

app.post("/api/reddit", async (c) => {
  const body = await c.req.json();
  if (!body.url || typeof body.url !== "string") {
    return c.json({ error: "url is required" }, 400);
  }
  const url = body.url.trim();
  if (!/^https?:\/\/(www\.)?reddit\.com\/.+/i.test(url)) {
    return c.json({ error: "not a valid Reddit URL" }, 400);
  }
  try {
    const result = await scrapeReddit(url);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Stock footage & background music lists ───

app.get("/api/stocks", async (c) => {
  const clips = listStockClips();
  return c.json(
    clips.map((f) => {
      const name = f.split("/").pop() ?? "";
      let size = 0;
      try {
        size = statSync(f).size;
      } catch {}
      return { name, path: f, size };
    }),
  );
});

app.delete("/api/stocks/:name", async (c) => {
  const name = c.req.param("name");
  if (!name || name.includes("..") || name.includes("/")) {
    return c.json({ error: "invalid name" }, 400);
  }
  const filePath = join(ASSETS_DIR, "stocks", name);
  if (!existsSync(filePath)) return c.json({ error: "not found" }, 404);
  try {
    unlinkSync(filePath);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "delete failed" }, 500);
  }
});

app.get("/api/music", async (c) => {
  const tracks = listBgMusic();
  return c.json(
    tracks.map((f) => {
      const name = f.split("/").pop() ?? "";
      let size = 0;
      try {
        size = statSync(f).size;
      } catch {}
      return { name, path: f, size };
    }),
  );
});

app.delete("/api/music/:name", async (c) => {
  const name = c.req.param("name");
  if (!name || name.includes("..") || name.includes("/")) {
    return c.json({ error: "invalid name" }, 400);
  }
  const filePath = join(ASSETS_DIR, "styles", name);
  if (!existsSync(filePath)) return c.json({ error: "not found" }, 404);
  try {
    unlinkSync(filePath);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "delete failed" }, 500);
  }
});

// ─── Background render worker ───

async function renderVideo(renderId: string, proj: any, settings: any) {
  const { generateFakeText, ffmpeg } = await import("@crayo/core");
  const updateRender = (patch: any) =>
    db.update(render).set(patch).where(eq(render.id, renderId)).run();
  const updateProject = (status: string) =>
    db.update(project).set({ status }).where(eq(project.id, proj.id)).run();

  const tempFiles: string[] = [];

  try {
    updateRender({ status: "processing" });
    updateProject("rendering");
    const outPath = join(OUTPUT_DIR, `${renderId}.mp4`);

    // Resolve aspect ratio from platform setting
    const { ASPECTS } = await import("@crayo/core");
    const validPlatforms = Object.keys(ASPECTS) as (keyof typeof ASPECTS)[];
    const platformKey = String(settings.platform ?? "9:16");
    const platform = validPlatforms.includes(platformKey as any)
      ? (platformKey as keyof typeof ASPECTS)
      : "9:16";
    const aspect = ASPECTS[platform];

    // Resolve quality preset
    const { QUALITY } = await import("@crayo/core");
    const validQualities = Object.keys(QUALITY) as (keyof typeof QUALITY)[];
    const qualityKey = String(settings.quality ?? "standard");
    const quality = validQualities.includes(qualityKey as any)
      ? (qualityKey as keyof typeof QUALITY)
      : "standard";
    const qual = QUALITY[quality];

    if (proj.type === "story" && proj.script) {
      // Step 1: Generate TTS audio if voiceover enabled
      let audioPath: string | null = null;
      if (settings.voiceover && settings.voice) {
        audioPath = join(OUTPUT_DIR, `${renderId}-voiceover.mp3`);
        tempFiles.push(audioPath);
        const { textToSpeech } = await import("@crayo/ai");
        await textToSpeech({
          text: proj.script,
          voice: settings.voice,
          outputPath: audioPath,
        });
      }

      // Step 2: Create background video (black or gameplay)
      const tempPath = join(OUTPUT_DIR, `${renderId}-raw.mp4`);
      tempFiles.push(tempPath);

      let duration = settings.duration ?? 60;
      if (audioPath) {
        const audioDur = await ffmpeg.getDuration(audioPath);
        if (audioDur > 0) duration = Math.ceil(audioDur) + 2;
      }

      // Use random stock clip as background if available, else black
      const bgClips = listStockClips();
      const transitionType = String(settings.transition ?? "none");
      if (bgClips.length > 0 && settings.bgVideo !== false) {
        // Use multiple clips with transitions if available
        const clipCount = Math.min(
          bgClips.length,
          duration > 30 ? 4 : duration > 15 ? 3 : 2,
        );
        const shuffled = [...bgClips].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, clipCount);
        const segDur = duration / clipCount;

        if (clipCount > 1 && transitionType !== "none") {
          const segPaths: string[] = [];
          for (let i = 0; i < clipCount; i++) {
            const segPath = join(OUTPUT_DIR, `${renderId}-bg-seg${i}.mp4`);
            tempFiles.push(segPath);
            await ffmpeg.trim({
              input: selected[i],
              end: segDur,
              output: segPath,
            });
            segPaths.push(segPath);
          }
          const concatPath = join(OUTPUT_DIR, `${renderId}-bg-concat.mp4`);
          tempFiles.push(concatPath);
          await ffmpeg.concatTransitions(segPaths, concatPath, {
            transition: transitionType as any,
            quality,
          });
          await ffmpeg.toAspect(concatPath, tempPath, platform, quality);
        } else {
          const clip = selected[0];
          const trimmedPath = join(OUTPUT_DIR, `${renderId}-bg-trimmed.mp4`);
          tempFiles.push(trimmedPath);
          await ffmpeg.trim({
            input: clip,
            end: duration,
            output: trimmedPath,
          });
          await ffmpeg.toAspect(trimmedPath, tempPath, platform, quality);
        }
      } else {
        await ffmpeg.run([
          "-f",
          "lavfi",
          "-i",
          `color=c=black:s=${aspect.width}x${aspect.height}:d=${duration}`,
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=44100:cl=stereo",
          "-t",
          String(duration),
          "-c:v",
          "libx264",
          "-preset",
          qual.preset,
          "-crf",
          String(qual.crf),
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-shortest",
          tempPath,
        ]);
      }

      // Step 2.5: Smart zoom (face tracking) on background video
      if (
        settings.smartZoom &&
        bgClips.length > 0 &&
        settings.bgVideo !== false
      ) {
        const { detectFaces } = await import("@crayo/ai");
        const faceDataPath = join(OUTPUT_DIR, `${renderId}-faces.json`);
        tempFiles.push(faceDataPath);
        try {
          await detectFaces({ inputPath: tempPath, outputPath: faceDataPath });
          const zoomedPath = join(OUTPUT_DIR, `${renderId}-zoomed.mp4`);
          tempFiles.push(zoomedPath);
          await ffmpeg.smartZoom(tempPath, {
            faceDataPath,
            output: zoomedPath,
            quality,
          });
          // Replace tempPath with zoomed version
          const idx = tempFiles.indexOf(tempPath);
          if (idx >= 0) tempFiles.splice(idx, 1);
          tempFiles.push(tempPath);
          const { renameSync } = await import("fs");
          renameSync(zoomedPath, tempPath);
        } catch (err: any) {
          // Face detection can fail on some videos — just skip smart zoom
          console.warn("smart zoom skipped:", err.message);
        }
      }

      // Step 3: Mix audio tracks (voiceover + bg music + sfx)
      let audioMixPath = tempPath;
      const hasAudio =
        audioPath ||
        (settings.bgMusic !== false && listBgMusic().length > 0) ||
        (settings.sfx && settings.sfx.length > 0);
      if (hasAudio) {
        const mixedAudioPath = join(OUTPUT_DIR, `${renderId}-mixed-audio.m4a`);
        tempFiles.push(mixedAudioPath);
        const mixedPath = join(OUTPUT_DIR, `${renderId}-mixed.mp4`);
        tempFiles.push(mixedPath);

        const { mixAudio } = await import("@crayo/core");
        const tracks: any[] = [];
        const voiceVol = Number(settings.voiceVolume ?? 1.0);
        const musicVol = Number(settings.musicVolume ?? 0.15);

        if (audioPath && voiceVol > 0) {
          tracks.push({ path: audioPath, volume: voiceVol });
        }
        if (
          settings.bgMusic !== false &&
          listBgMusic().length > 0 &&
          musicVol > 0
        ) {
          const bgMusic =
            listBgMusic()[Math.floor(Math.random() * listBgMusic().length)];
          tracks.push({ path: bgMusic, volume: musicVol, loop: true });
        }

        const sfxEntries = (settings.sfx ?? []).map((s: any) => ({
          path: s.path,
          timeMs: Number(s.timeMs ?? 0),
          volume: Number(s.volume ?? 0.5),
        }));

        await mixAudio({
          tracks,
          sfx: sfxEntries,
          duration,
          output: mixedAudioPath,
        });
        await ffmpeg.addAudio(tempPath, mixedAudioPath, mixedPath);
        audioMixPath = mixedPath;
      }

      // Step 4: Captions — custom if provided, else auto-generate
      let texts: { text: string; startMs: number; endMs: number }[];
      if (settings.customCaptions && settings.customCaptions.length > 0) {
        texts = settings.customCaptions.map((c: any) => ({
          text: String(c.text ?? ""),
          startMs: Number(c.startMs ?? 0),
          endMs: Number(c.endMs ?? 0),
        }));
        for (const cap of texts) {
          db.insert(caption)
            .values({
              id: randomUUID(),
              renderId,
              text: cap.text,
              startMs: cap.startMs,
              endMs: cap.endMs,
              style: JSON.stringify(settings.captionStyle ?? "bold_pop"),
            })
            .run();
        }
      } else if (audioPath) {
        const { speechToText } = await import("@crayo/ai");
        const sttResult = await speechToText({ inputPath: audioPath });
        texts = groupCaptions(sttResult, 4);
        for (const cap of texts) {
          db.insert(caption)
            .values({
              id: randomUUID(),
              renderId,
              text: cap.text,
              startMs: cap.startMs,
              endMs: cap.endMs,
              style: JSON.stringify(settings.captionStyle ?? "bold_pop"),
            })
            .run();
        }
      } else {
        texts = splitIntoCaptions(proj.script);
      }

      // Step 5: Apply captions (ASS for animated styles, drawtext fallback)
      const captionStyleName = settings.captionStyle ?? "bold_pop";
      const ASS_STYLES = new Set([
        "typewriter",
        "bounce",
        "shake",
        "zoom",
        "colorful",
        "word_by_word",
        "glow",
        "neon",
      ]);

      if (ASS_STYLES.has(captionStyleName) && texts.length > 0) {
        const { writeASS } = await import("@crayo/core");
        const assPath = join(OUTPUT_DIR, `${renderId}-captions.ass`);
        tempFiles.push(assPath);
        writeASS(
          texts.map((t) => ({
            text: t.text,
            startMs: t.startMs,
            endMs: t.endMs,
          })),
          captionStyleName,
          assPath,
          aspect.width,
          aspect.height,
        );
        await ffmpeg.renderASS(audioMixPath, assPath, outPath, quality);
      } else {
        const captionStyle = buildCaptionStyle(captionStyleName);
        await ffmpeg.overlayText(
          audioMixPath,
          texts.map((t) => ({ ...t, style: captionStyle })),
          outPath,
        );
      }
    } else if (proj.type === "fake_text") {
      const messages =
        settings.messages ?? parseFakeTextScript(proj.script ?? "");
      await generateFakeText({
        messages,
        bgVideo: settings.bgVideo,
        bgImage: settings.bgImage,
        output: outPath,
        senderName: settings.senderName ?? "Contact",
        fontSize: settings.fontSize ?? 32,
      });
    } else if (proj.type === "quiz" || settings.template === "quiz") {
      // Quiz template: question → options → countdown → answer reveal
      const question =
        settings.question ?? proj.script ?? "What is the answer?";
      const answer = settings.answer ?? "The answer";
      const options = settings.options ?? [
        "Option A",
        "Option B",
        "Option C",
        "Option D",
      ];
      const timer = Number(settings.timer ?? 5);

      const optList =
        typeof options === "string"
          ? options.split(",").map((o: string) => o.trim())
          : options;
      const totalDur = timer + 5; // timer + reveal

      // Create black background
      const bgPath = join(OUTPUT_DIR, `${renderId}-quiz-bg.mp4`);
      tempFiles.push(bgPath);
      await ffmpeg.run([
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=${aspect.width}x${aspect.height}:d=${totalDur}`,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        String(totalDur),
        "-c:v",
        "libx264",
        "-preset",
        qual.preset,
        "-crf",
        String(qual.crf),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        bgPath,
      ]);

      // Build text overlays: question, options, countdown, answer
      const quizTexts: {
        text: string;
        startMs: number;
        endMs: number;
        style?: any;
      }[] = [];
      const qStyle = {
        fontSize: 48,
        fontColor: "white",
        position: "top" as const,
        outline: true,
        outlineColor: "black",
      };
      const optStyle = {
        fontSize: 36,
        fontColor: "white",
        position: "center" as const,
        outline: true,
        outlineColor: "black",
      };
      const ansStyle = {
        fontSize: 56,
        fontColor: "yellow",
        position: "center" as const,
        outline: true,
        outlineColor: "black",
      };

      // Question shows for entire duration
      quizTexts.push({
        text: question,
        startMs: 0,
        endMs: totalDur * 1000,
        style: qStyle,
      });

      // Options show after 1s
      for (let i = 0; i < Math.min(optList.length, 4); i++) {
        const y = 500 + i * 120;
        quizTexts.push({
          text: `${String.fromCharCode(65 + i)}) ${optList[i]}`,
          startMs: 1000,
          endMs: (timer + 3) * 1000,
          style: { ...optStyle, position: "center" as const },
        });
      }

      // Answer reveal at timer mark
      quizTexts.push({
        text: `Answer: ${answer}`,
        startMs: (timer + 1) * 1000,
        endMs: totalDur * 1000,
        style: ansStyle,
      });

      await ffmpeg.overlayText(bgPath, quizTexts, outPath);
    } else if (proj.type === "split_screen" && proj.url) {
      const bgClips = listStockClips();
      if (bgClips.length > 0) {
        const bg = bgClips[Math.floor(Math.random() * bgClips.length)];
        await ffmpeg.composeSplitScreen(proj.url, bg, outPath, {
          bgPosition: settings.bgPosition ?? "left",
        });
      } else {
        await ffmpeg.trim({ input: proj.url, output: outPath });
      }
    } else {
      await ffmpeg.run([
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=${aspect.width}x${aspect.height}:d=10`,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        "10",
        "-c:v",
        "libx264",
        "-preset",
        qual.preset,
        "-crf",
        String(qual.crf),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        outPath,
      ]);
    }

    updateRender({ status: "done", outputPath: outPath });
    updateProject("done");
  } catch (err: any) {
    updateRender({ status: "error", error: err.message });
    updateProject("error");
  } finally {
    for (const f of tempFiles) {
      try {
        unlinkSync(f);
      } catch {}
    }
  }
}

// ─── Reddit scraper ───

async function scrapeReddit(url: string) {
  // Convert reddit URL to JSON API
  const jsonUrl = url.endsWith(".json") ? url : url + ".json";
  const res = await fetch(jsonUrl, {
    headers: { "User-Agent": "CrayoLocal/1.0" },
  });
  if (!res.ok) throw new Error(`Reddit returned ${res.status}`);
  const data = await res.json();

  const post = data[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error("Could not parse Reddit post");

  return {
    title: post.title ?? "",
    selftext: post.selftext ?? "",
    author: post.author ?? "",
    subreddit: post.subreddit ?? "",
    score: post.score ?? 0,
    url: post.url ?? "",
  };
}

// ─── Helpers ───

function parseFakeTextScript(script: string) {
  const lines = script.split("\n").filter((l) => l.trim());
  const messages: { sender: string; text: string; isMe?: boolean }[] = [];
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)/);
    if (match) {
      const sender = match[1];
      const isMe = sender.toLowerCase() === "me";
      messages.push({ sender, text: match[2].trim(), isMe });
    } else if (line.trim()) {
      messages.push({ sender: "Them", text: line.trim(), isMe: false });
    }
  }
  return messages;
}

async function downloadVideo(url: string, output: string) {
  const proc = Bun.spawn(
    ["yt-dlp", "-f", "best[ext=mp4]/best", "--no-playlist", "-o", output, url],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`Download failed: ${stderr.slice(-500)}`);
  }
}

function splitIntoCaptions(text: string, maxLen = 50) {
  const words = text.split(/\s+/);
  const captions: { text: string; startMs: number; endMs: number }[] = [];
  let i = 0;
  let ms = 0;
  while (i < words.length) {
    let chunk = "";
    while (i < words.length && chunk.length + words[i].length < maxLen) {
      chunk += (chunk ? " " : "") + words[i];
      i++;
    }
    const dur = Math.max(chunk.length * 60, 2000);
    captions.push({ text: chunk, startMs: ms, endMs: ms + dur });
    ms += dur;
  }
  return captions;
}

function groupCaptions(
  captions: { text: string; startMs: number; endMs: number }[],
  maxWords: number,
) {
  const groups: { text: string; startMs: number; endMs: number }[] = [];
  let i = 0;
  while (i < captions.length) {
    let j = i;
    const words: string[] = [];
    while (j < captions.length && words.length < maxWords) {
      words.push(captions[j].text);
      j++;
    }
    groups.push({
      text: words.join(" "),
      startMs: captions[i].startMs,
      endMs: captions[j - 1].endMs,
    });
    i = j;
  }
  return groups;
}

function buildCaptionStyle(style: string): any {
  const styles: Record<string, any> = {
    bold_pop: {
      fontSize: 52,
      fontColor: "white",
      position: "bottom",
      outline: true,
      outlineColor: "black",
    },
    word_by_word: {
      fontSize: 56,
      fontColor: "yellow",
      position: "center",
      outline: true,
      outlineColor: "black",
    },
    colorful: {
      fontSize: 48,
      fontColor: "cyan",
      position: "bottom",
      outline: true,
      outlineColor: "black",
    },
    minimal: {
      fontSize: 36,
      fontColor: "white",
      position: "bottom",
      outline: false,
    },
  };
  return styles[style] ?? styles.bold_pop;
}

function listStockClips(): string[] {
  const dir = join(ASSETS_DIR, "stocks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".mp4") || f.endsWith(".mov"))
    .map((f: string) => join(dir, f));
}

function listBgMusic(): string[] {
  const dir = join(ASSETS_DIR, "styles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".mp3") || f.endsWith(".wav"))
    .map((f: string) => join(dir, f));
}

const port = Number(process.env.PORT ?? 3001);
console.log(`crayo API running on http://localhost:${port}`);

// ─── Enhancement 5: Multi-Stem Analysis Endpoint ───

app.post("/api/stem-analysis", async (c) => {
  const body = await c.req.json();
  if (!body.audioFile || typeof body.audioFile !== "string") {
    return c.json({ error: "audioFile path is required" }, 400);
  }

  if (!existsSync(body.audioFile)) {
    return c.json({ error: `Audio file not found: ${body.audioFile}` }, 404);
  }

  try {
    const { isDemucsAvailable, analyzeMultiStem, analyzeStemEnergy } =
      await import("@crayo/ai");

    const useDemucs = await isDemucsAvailable();

    if (useDemucs) {
      const analysis = await analyzeMultiStem({
        audioPath: body.audioFile,
        model: body.model ?? "htdemucs",
        shifts: body.shifts ?? 1,
        device: body.device ?? "cpu",
      });

      return c.json({
        mode: "demucs",
        model: body.model ?? "htdemucs",
        bpm: analysis.bpm,
        hasSinging: analysis.hasSinging,
        energy: {
          vocals: analysis.energy.vocals.averageEnergy,
          drums: analysis.energy.drums.averageEnergy,
          bass: analysis.energy.bass.averageEnergy,
          other: analysis.energy.other.averageEnergy,
        },
        dominantTimeline: analysis.dominantTimeline,
        stems: analysis.stems, // paths to WAV files
      });
    } else {
      // Fallback to frequency-band estimation
      const analysis = await analyzeStemEnergy(body.audioFile);
      return c.json({
        mode: "frequency-band-fallback",
        note: "Install demucs for real stem separation: pip install demucs",
        energy: {
          vocals: analysis.vocals.energy,
          drums: analysis.drums.energy,
          bass: analysis.bass.energy,
          other: analysis.other.energy,
        },
        timeline: analysis.timeline,
      });
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Enhancement 6: Silence Removal Endpoint ───

app.post("/api/silence-detect", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  if (!existsSync(body.inputPath)) {
    return c.json({ error: `File not found: ${body.inputPath}` }, 404);
  }

  try {
    const { detectSilence } = await import("@crayo/ai");
    const analysis = await detectSilence({
      inputPath: body.inputPath,
      threshold: body.threshold,
      minSilenceMs: body.minSilenceMs,
      minSpeechMs: body.minSpeechMs,
      method: body.method,
      motionThreshold: body.motionThreshold,
    });
    return c.json(analysis);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/silence-remove", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  if (!body.outputPath || typeof body.outputPath !== "string") {
    return c.json({ error: "outputPath is required" }, 400);
  }
  if (!existsSync(body.inputPath)) {
    return c.json({ error: `File not found: ${body.inputPath}` }, 404);
  }

  const mode = body.mode ?? "cut";
  if (!["cut", "speed", "margin"].includes(mode)) {
    return c.json({ error: "mode must be cut, speed, or margin" }, 400);
  }

  try {
    const { removeSilence } = await import("@crayo/ai");
    const result = await removeSilence({
      inputPath: body.inputPath,
      outputPath: body.outputPath,
      mode,
      threshold: body.threshold,
      minSilenceMs: body.minSilenceMs,
      marginMs: body.marginMs,
      silenceSpeed: body.silenceSpeed,
      maxSilenceMs: body.maxSilenceMs,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Enhancement 7: Face Reframe Endpoint ───

app.post("/api/reframe", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  if (!body.outputPath || typeof body.outputPath !== "string") {
    return c.json({ error: "outputPath is required" }, 400);
  }
  if (!existsSync(body.inputPath)) {
    return c.json({ error: `File not found: ${body.inputPath}` }, 404);
  }

  try {
    const { reframeVideo } = await import("@crayo/ai");
    const result = await reframeVideo({
      inputPath: body.inputPath,
      outputPath: body.outputPath,
      targetAspect: body.targetAspect ?? "9:16",
      sampleFps: body.sampleFps,
      smoothing: body.smoothing,
      padding: body.padding,
      fallback: body.fallback,
      outputWidth: body.outputWidth,
      multiSpeaker: body.multiSpeaker,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Enhancement 8: Speech Enhancement Endpoint ───

app.post("/api/speech-enhance", async (c) => {
  const body = await c.req.json();
  if (!body.inputPath || typeof body.inputPath !== "string") {
    return c.json({ error: "inputPath is required" }, 400);
  }
  if (!body.outputPath || typeof body.outputPath !== "string") {
    return c.json({ error: "outputPath is required" }, 400);
  }
  if (!existsSync(body.inputPath)) {
    return c.json({ error: `File not found: ${body.inputPath}` }, 404);
  }

  try {
    const { enhanceSpeech } = await import("@crayo/ai");
    const result = await enhanceSpeech({
      inputPath: body.inputPath,
      outputPath: body.outputPath,
      method: body.method,
      model: body.model,
      postFilter: body.postFilter,
      noiseReduction: body.noiseReduction,
      highpass: body.highpass,
      lowpass: body.lowpass,
      deesser: body.deesser,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Enhancement 10: Stock Footage Endpoint ───

app.post("/api/stock-search", async (c) => {
  const body = await c.req.json();
  if (!body.query || typeof body.query !== "string") {
    return c.json({ error: "query is required" }, 400);
  }

  try {
    const { searchStockFootage } = await import("@crayo/ai");
    const result = await searchStockFootage({
      query: body.query,
      count: body.count,
      orientation: body.orientation,
      minDuration: body.minDuration,
      maxDuration: body.maxDuration,
      size: body.size,
      apiKey: body.apiKey,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/stock-download", async (c) => {
  const body = await c.req.json();
  if (!body.query || typeof body.query !== "string") {
    return c.json({ error: "query is required" }, 400);
  }

  const outputDir = body.outputDir ?? join(OUTPUT_DIR, "stock-broll");

  try {
    const { getStockBRoll } = await import("@crayo/ai");
    const paths = await getStockBRoll(body.query, outputDir, {
      count: body.count,
      orientation: body.orientation,
      size: body.size,
      apiKey: body.apiKey,
    });
    return c.json({ paths, outputDir });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Enhancement 11: Timeline Export Endpoint ───

app.post("/api/export-timeline", async (c) => {
  const body = await c.req.json();
  if (!body.clips || !Array.isArray(body.clips) || body.clips.length === 0) {
    return c.json({ error: "clips array is required" }, 400);
  }
  if (!body.outputPath || typeof body.outputPath !== "string") {
    return c.json({ error: "outputPath is required" }, 400);
  }

  try {
    const { exportTimeline } = await import("@crayo/ai");
    const result = exportTimeline({
      clips: body.clips,
      title: body.title,
      fps: body.fps,
      outputPath: body.outputPath,
      format: body.format,
      dropFrame: body.dropFrame,
      width: body.width,
      height: body.height,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Enhancement 12: Social Publishing Endpoint ───

app.post("/api/publish", async (c) => {
  const body = await c.req.json();
  if (!body.videoPath || typeof body.videoPath !== "string") {
    return c.json({ error: "videoPath is required" }, 400);
  }
  if (!body.platforms || !Array.isArray(body.platforms) || body.platforms.length === 0) {
    return c.json({ error: "platforms array is required (tiktok, youtube, instagram)" }, 400);
  }
  if (!existsSync(body.videoPath)) {
    return c.json({ error: `File not found: ${body.videoPath}` }, 404);
  }

  try {
    const { publishVideo } = await import("@crayo/ai");
    const result = await publishVideo({
      videoPath: body.videoPath,
      platforms: body.platforms,
      title: body.title,
      caption: body.caption,
      hashtags: body.hashtags,
      scheduledAt: body.scheduledAt,
      thumbnail: body.thumbnail,
      privacy: body.privacy,
      tiktok: body.tiktok,
      youtube: body.youtube,
      instagram: body.instagram,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Enhancement 13: Split-Screen Gameplay Endpoint ───

app.post("/api/split-screen", async (c) => {
  const body = await c.req.json();
  if (!body.mainVideo || typeof body.mainVideo !== "string") {
    return c.json({ error: "mainVideo is required" }, 400);
  }
  if (!body.backgroundVideo || typeof body.backgroundVideo !== "string") {
    return c.json({ error: "backgroundVideo is required" }, 400);
  }
  if (!body.outputPath || typeof body.outputPath !== "string") {
    return c.json({ error: "outputPath is required" }, 400);
  }
  if (!existsSync(body.mainVideo)) {
    return c.json({ error: `Main video not found: ${body.mainVideo}` }, 404);
  }
  if (!existsSync(body.backgroundVideo)) {
    return c.json({ error: `Background video not found: ${body.backgroundVideo}` }, 404);
  }

  try {
    const { createSplitScreen } = await import("@crayo/ai");
    const result = await createSplitScreen({
      mainVideo: body.mainVideo,
      backgroundVideo: body.backgroundVideo,
      outputPath: body.outputPath,
      layout: body.layout,
      mainRatio: body.mainRatio,
      backgroundLoop: body.backgroundLoop,
      outputWidth: body.outputWidth,
      outputHeight: body.outputHeight,
      blur: body.blur,
      border: body.border,
      fps: body.fps,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─── Enhancement 14: Batch Render Endpoint ───

app.post("/api/batch-render", async (c) => {
  const body = await c.req.json();
  if (!body.sourceVideos || !Array.isArray(body.sourceVideos) || body.sourceVideos.length === 0) {
    return c.json({ error: "sourceVideos array is required" }, 400);
  }
  if (!body.outputDir || typeof body.outputDir !== "string") {
    return c.json({ error: "outputDir is required" }, 400);
  }

  try {
    const { runBatchRender } = await import("@crayo/ai");
    const result = await runBatchRender({
      sourceVideos: body.sourceVideos,
      outputDir: body.outputDir,
      pipeline: body.pipeline ?? {},
      naming: body.naming,
      parallel: body.parallel,
      continueOnError: body.continueOnError,
      notify: body.notify,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default {
  port,
  fetch: app.fetch,
  maxRequestBodySize: MAX_UPLOAD_BYTES,
};
