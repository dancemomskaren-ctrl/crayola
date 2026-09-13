import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const DATA_DIR = join(import.meta.dir, "../../../data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "crayo.db");
const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite);

export const client = sqliteTable("client", {
  id: text("id").primaryKey(),
  name: text("name").notNull(), // e.g. "Grace Community Church"
  notes: text("notes"), // contact info, contract terms, whatever's useful
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // story | fake_text | split_screen
  status: text("status").notNull().default("draft"), // draft | rendering | done | error
  script: text("script"),
  url: text("url"),
  clientId: text("client_id"), // nullable — internal/test projects have no client
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const render = sqliteTable("render", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | done | error
  inputPath: text("input_path"),
  outputPath: text("output_path"),
  error: text("error"),
  settings: text("settings"), // JSON string
  deliveredAt: integer("delivered_at", { mode: "timestamp" }), // set when copied to a client delivery folder
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const asset = sqliteTable("asset", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  type: text("type").notNull(), // video | audio | image
  path: text("path").notNull(),
  metadata: text("metadata"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const caption = sqliteTable("caption", {
  id: text("id").primaryKey(),
  renderId: text("render_id").notNull(),
  text: text("text").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  style: text("style"), // JSON string
});

export const batch = sqliteTable("batch", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  templateId: text("template_id").notNull(),
  status: text("status").notNull().default("processing"), // processing | done | error
  totalClips: integer("total_clips").notNull().default(0),
  completedClips: integer("completed_clips").notNull().default(0),
  error: text("error"),
  resultJson: text("result_json"), // JSON string — array of { projectId, renderId, text, ... }
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Analytics ───

export const analytics = sqliteTable("analytics", {
  id: text("id").primaryKey(),
  renderId: text("render_id").notNull(),
  platform: text("platform").notNull(), // tiktok | reels | shorts | youtube
  postUrl: text("post_url"),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  watchTimeMs: integer("watch_time_ms").notNull().default(0),
  hookRetention: integer("hook_retention").notNull().default(0), // % who watched past 3s
  avgWatchPercent: integer("avg_watch_percent").notNull().default(0), // % of video watched
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ─── Posting Queue ───

export const postQueue = sqliteTable("post_queue", {
  id: text("id").primaryKey(),
  renderId: text("render_id").notNull(),
  platform: text("platform").notNull(), // tiktok | reels | shorts
  status: text("status").notNull().default("queued"), // queued | posting | posted | failed
  caption: text("caption"),
  hashtags: text("hashtags"), // JSON array string
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  postedAt: integer("posted_at", { mode: "timestamp" }),
  postUrl: text("post_url"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS client (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    notes TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    script TEXT,
    url TEXT,
    client_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS render (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input_path TEXT,
    output_path TEXT,
    error TEXT,
    settings TEXT,
    delivered_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS asset (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    path TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS caption (
    id TEXT PRIMARY KEY,
    render_id TEXT NOT NULL,
    text TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    style TEXT
  );
  CREATE TABLE IF NOT EXISTS batch (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    template_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    total_clips INTEGER NOT NULL DEFAULT 0,
    completed_clips INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    result_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analytics (
    id TEXT PRIMARY KEY,
    render_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    post_url TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    comments INTEGER NOT NULL DEFAULT 0,
    shares INTEGER NOT NULL DEFAULT 0,
    saves INTEGER NOT NULL DEFAULT 0,
    watch_time_ms INTEGER NOT NULL DEFAULT 0,
    hook_retention INTEGER NOT NULL DEFAULT 0,
    avg_watch_percent INTEGER NOT NULL DEFAULT 0,
    fetched_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS post_queue (
    id TEXT PRIMARY KEY,
    render_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    caption TEXT,
    hashtags TEXT,
    scheduled_at INTEGER,
    posted_at INTEGER,
    post_url TEXT,
    error TEXT,
    created_at INTEGER NOT NULL
  );
`);

// Migration: add client_id to an existing project table that predates
// the client feature. CREATE TABLE IF NOT EXISTS above only helps on a
// fresh DB — existing installs need ALTER TABLE. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so check pragma first and skip if present.
{
  const cols = sqlite.query(`PRAGMA table_info(project)`).all() as {
    name: string;
  }[];
  const hasClientId = cols.some((c) => c.name === "client_id");
  if (!hasClientId) {
    sqlite.exec(`ALTER TABLE project ADD COLUMN client_id TEXT;`);
  }
}

// Migration: add delivered_at to an existing render table.
{
  const cols = sqlite.query(`PRAGMA table_info(render)`).all() as {
    name: string;
  }[];
  const hasDeliveredAt = cols.some((c) => c.name === "delivered_at");
  if (!hasDeliveredAt) {
    sqlite.exec(`ALTER TABLE render ADD COLUMN delivered_at INTEGER;`);
  }
}
