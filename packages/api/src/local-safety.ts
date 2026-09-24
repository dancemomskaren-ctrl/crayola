import { existsSync, realpathSync, mkdirSync } from "fs";
import { resolve, relative, isAbsolute, dirname } from "path";

export const ROOT = resolve(import.meta.dir, "../../..");
export const DATA_DIR = resolve(process.env.CRAYO_DATA_DIR || resolve(ROOT, "data"));
export const OUTPUT_DIR = resolve(DATA_DIR, "renders");
export const UPLOADS_DIR = resolve(DATA_DIR, "uploads");
export const DELIVERY_DIR = resolve(DATA_DIR, "delivery");
export const ASSETS_DIR = resolve(ROOT, "assets");
for (const dir of [OUTPUT_DIR, UPLOADS_DIR, DELIVERY_DIR]) mkdirSync(dir, { recursive: true });

function within(path: string, root: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolve symlinks too, including the nearest existing parent for new outputs. */
export function managedPath(value: string, output = false): string {
  const path = resolve(ROOT, value);
  let existing = path;
  while (!existsSync(existing) && existing !== dirname(existing)) existing = dirname(existing);
  const actual = resolve(realpathSync(existing), relative(existing, path));
  const roots = output ? [OUTPUT_DIR] : [OUTPUT_DIR, UPLOADS_DIR, ASSETS_DIR];
  if (!roots.some(root => existsSync(root) && within(actual, realpathSync(root)))) {
    throw new Error("File must be inside this project's managed media folders.");
  }
  return actual;
}

export function sourceOptions(body: any) {
  if (!!body.url === !!body.localFilePath) throw new Error("Provide exactly one video URL or uploaded file.");
  if (body.localFilePath) return { localFilePath: managedPath(String(body.localFilePath)) };
  const url = new URL(body.url);
  const host = url.hostname.toLowerCase();
  const sites = ["youtube.com", "youtu.be", "vimeo.com", "twitch.tv", "kick.com", "tiktok.com"];
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !sites.some(site => host === site || host.endsWith(`.${site}`))) {
    throw new Error("Use an HTTPS YouTube, Vimeo, Twitch, Kick or TikTok link, or upload the video.");
  }
  return { url: url.href };
}

// One CPU-heavy task at a time in this local application.
let tail: Promise<unknown> = Promise.resolve();
export function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work, work);
  tail = result.catch(() => {});
  return result;
}

export function mediaResponse(path: string, range?: string, filename?: string): Response {
  const file = Bun.file(path);
  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" };
  if (filename) headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  if (!range) return new Response(file, { headers: { ...headers, "Content-Length": String(file.size) } });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = match?.[1] ? Number(match[1]) : Math.max(0, file.size - Number(match?.[2]));
  let end = match?.[1] && match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= file.size || end < start) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
  }
  return new Response(file.slice(start, end + 1).stream(), { status: 206, headers: { ...headers,
    "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${file.size}` } });
}
