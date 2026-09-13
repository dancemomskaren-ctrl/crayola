// Stock Footage Auto-Sourcing via Pexels API
// Inspired by gyoridavid/short-video-maker (⭐1.3k)
// Searches and downloads free HD stock video clips for B-roll
// Pexels API: free, unlimited, no watermarks, attribution appreciated

import { existsSync, mkdirSync } from "fs";
import { join, basename } from "path";

// ─── Types ───

export interface StockSearchOptions {
  query: string; // search keywords (e.g. "cooking kitchen steam")
  count?: number; // max clips to return (default: 5)
  orientation?: "landscape" | "portrait" | "square"; // default: landscape
  minDuration?: number; // minimum clip duration in seconds (default: 3)
  maxDuration?: number; // max clip duration in seconds (default: 30)
  size?: "large" | "medium" | "small"; // quality tier (default: medium)
  apiKey?: string; // Pexels API key (or env PEXELS_API_KEY)
}

export interface StockClip {
  id: number;
  url: string; // Pexels page URL
  downloadUrl: string; // direct video file URL
  width: number;
  height: number;
  duration: number; // seconds
  quality: string; // e.g. "hd", "sd"
  photographer: string;
}

export interface StockSearchResult {
  clips: StockClip[];
  query: string;
  totalResults: number;
}

export interface StockDownloadOptions {
  clips: StockClip[]; // clips from search result
  outputDir: string; // directory to save downloaded clips
  maxConcurrent?: number; // parallel downloads (default: 3)
}

export interface StockDownloadResult {
  downloaded: Array<{ clip: StockClip; localPath: string }>;
  failed: Array<{ clip: StockClip; error: string }>;
}

// ─── Search ───

/**
 * Search Pexels for stock video clips.
 * Free API, no watermarks. Get your key at https://www.pexels.com/api/
 */
export async function searchStockFootage(
  opts: StockSearchOptions,
): Promise<StockSearchResult> {
  const apiKey = opts.apiKey || process.env.PEXELS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Pexels API key required. Get one free at https://www.pexels.com/api/ " +
      "and set PEXELS_API_KEY env var or pass apiKey option.",
    );
  }

  const count = opts.count ?? 5;
  const orientation = opts.orientation ?? "landscape";
  const minDuration = opts.minDuration ?? 3;
  const maxDuration = opts.maxDuration ?? 30;
  const size = opts.size ?? "medium";

  const params = new URLSearchParams({
    query: opts.query,
    per_page: String(Math.min(count * 2, 80)), // fetch extra to filter
    orientation,
  });

  console.log(`[stock] Searching Pexels: "${opts.query}" (${orientation})...`);

  const response = await fetch(
    `https://api.pexels.com/videos/search?${params}`,
    { headers: { Authorization: apiKey } },
  );

  if (!response.ok) {
    throw new Error(`Pexels API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as {
    total_results: number;
    videos: Array<{
      id: number;
      url: string;
      duration: number;
      user: { name: string };
      video_files: Array<{
        id: number;
        quality: string;
        width: number;
        height: number;
        link: string;
        file_type: string;
      }>;
    }>;
  };

  // Filter by duration and pick best quality file per video
  const clips: StockClip[] = [];

  for (const video of data.videos) {
    if (video.duration < minDuration || video.duration > maxDuration) continue;
    if (clips.length >= count) break;

    // Pick the best video file based on size preference
    const files = video.video_files
      .filter((f) => f.file_type === "video/mp4")
      .sort((a, b) => b.width - a.width); // largest first

    let picked = files[0]; // default: largest
    if (size === "medium") {
      picked = files.find((f) => f.width <= 1920 && f.width >= 720) ?? files[0];
    } else if (size === "small") {
      picked = files.find((f) => f.width <= 1280) ?? files[files.length - 1];
    }

    if (!picked) continue;

    clips.push({
      id: video.id,
      url: video.url,
      downloadUrl: picked.link,
      width: picked.width,
      height: picked.height,
      duration: video.duration,
      quality: picked.quality,
      photographer: video.user.name,
    });
  }

  console.log(`[stock] Found ${clips.length} clips (${data.total_results} total)`);
  return { clips, query: opts.query, totalResults: data.total_results };
}

// ─── Download ───

/**
 * Download stock clips to local directory.
 */
export async function downloadStockClips(
  opts: StockDownloadOptions,
): Promise<StockDownloadResult> {
  const maxConcurrent = opts.maxConcurrent ?? 3;
  mkdirSync(opts.outputDir, { recursive: true });

  const downloaded: StockDownloadResult["downloaded"] = [];
  const failed: StockDownloadResult["failed"] = [];

  console.log(`[stock] Downloading ${opts.clips.length} clips to ${opts.outputDir}...`);

  // Process in batches
  for (let i = 0; i < opts.clips.length; i += maxConcurrent) {
    const batch = opts.clips.slice(i, i + maxConcurrent);
    const results = await Promise.allSettled(
      batch.map((clip) => downloadSingleClip(clip, opts.outputDir)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        downloaded.push({ clip: batch[j], localPath: result.value });
      } else {
        failed.push({ clip: batch[j], error: result.reason?.message ?? "Unknown error" });
      }
    }
  }

  console.log(`[stock] Downloaded ${downloaded.length}/${opts.clips.length} clips`);
  return { downloaded, failed };
}

async function downloadSingleClip(clip: StockClip, outputDir: string): Promise<string> {
  const filename = `pexels-${clip.id}-${clip.width}x${clip.height}.mp4`;
  const localPath = join(outputDir, filename);

  // Skip if already downloaded
  if (existsSync(localPath)) {
    return localPath;
  }

  const response = await fetch(clip.downloadUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  await Bun.write(localPath, buffer);
  return localPath;
}

// ─── Convenience: Search + Download ───

/**
 * One-shot: search for stock footage and download matching clips.
 * Returns local file paths ready for B-roll injection.
 */
export async function getStockBRoll(
  query: string,
  outputDir: string,
  opts?: Partial<StockSearchOptions>,
): Promise<string[]> {
  const searchResult = await searchStockFootage({ query, ...opts });

  if (searchResult.clips.length === 0) {
    console.warn(`[stock] No clips found for "${query}"`);
    return [];
  }

  const dlResult = await downloadStockClips({
    clips: searchResult.clips,
    outputDir,
  });

  return dlResult.downloaded.map((d) => d.localPath);
}