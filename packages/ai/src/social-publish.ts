// Multi-Platform Video Publishing
// Posts clips directly to TikTok, YouTube Shorts, and Instagram Reels
// Unified interface — one call publishes to all selected platforms
// Supports scheduling, captions, hashtags, and thumbnail selection

import { existsSync, readFileSync, statSync } from "fs";
import { basename } from "path";

// ─── Types ───

export type Platform = "tiktok" | "youtube" | "instagram";

export interface PublishOptions {
  videoPath: string; // local path to the video file
  platforms: Platform[]; // where to publish
  title?: string; // video title (YouTube)
  caption?: string; // post caption/description
  hashtags?: string[]; // auto-appended to caption
  scheduledAt?: string; // ISO 8601 timestamp for scheduled publish
  thumbnail?: string; // path to thumbnail image (YouTube)
  privacy?: "public" | "unlisted" | "private"; // default: public
  // Platform-specific auth (or use env vars)
  tiktok?: TikTokAuth;
  youtube?: YouTubeAuth;
  instagram?: InstagramAuth;
}

export interface TikTokAuth {
  accessToken: string; // OAuth access token
  openId?: string; // TikTok user open_id
}

export interface YouTubeAuth {
  accessToken: string; // OAuth2 access token
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface InstagramAuth {
  accessToken: string; // Graph API token
  igUserId: string; // Instagram Business account ID
  videoUrl?: string; // public URL (IG requires hosted video URL)
}

export interface PublishResult {
  platform: Platform;
  success: boolean;
  postId?: string; // platform-specific post/video ID
  postUrl?: string; // URL to the published post
  error?: string;
  status?: "published" | "draft" | "scheduled" | "processing";
}

export interface MultiPublishResult {
  results: PublishResult[];
  successCount: number;
  failCount: number;
}

// ─── Main Publish Function ───

/**
 * Publish a video to one or more platforms.
 * Returns results per platform (some may succeed while others fail).
 */
export async function publishVideo(opts: PublishOptions): Promise<MultiPublishResult> {
  if (!existsSync(opts.videoPath)) {
    throw new Error(`Video file not found: ${opts.videoPath}`);
  }

  const caption = buildCaption(opts.caption, opts.hashtags);
  const results: PublishResult[] = [];

  for (const platform of opts.platforms) {
    try {
      let result: PublishResult;
      switch (platform) {
        case "tiktok":
          result = await publishToTikTok(opts, caption);
          break;
        case "youtube":
          result = await publishToYouTube(opts, caption);
          break;
        case "instagram":
          result = await publishToInstagram(opts, caption);
          break;
      }
      results.push(result);
    } catch (err: any) {
      results.push({ platform, success: false, error: err.message });
    }
  }

  return {
    results,
    successCount: results.filter((r) => r.success).length,
    failCount: results.filter((r) => !r.success).length,
  };
}

function buildCaption(caption?: string, hashtags?: string[]): string {
  let text = caption ?? "";
  if (hashtags && hashtags.length > 0) {
    const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
    text = text ? `${text}\n\n${tags}` : tags;
  }
  return text;
}

// ─── TikTok Content Posting API ───

async function publishToTikTok(opts: PublishOptions, caption: string): Promise<PublishResult> {
  const auth = opts.tiktok ?? {
    accessToken: process.env.TIKTOK_ACCESS_TOKEN ?? "",
    openId: process.env.TIKTOK_OPEN_ID,
  };

  if (!auth.accessToken) {
    throw new Error("TikTok access token required (set TIKTOK_ACCESS_TOKEN or pass tiktok.accessToken)");
  }

  const fileSize = statSync(opts.videoPath).size;

  // Step 1: Initialize upload
  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 150), // TikTok title max 150 chars
        privacy_level: "SELF_ONLY", // goes to drafts first for safety
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fileSize,
        chunk_size: fileSize, // single chunk for files < 64MB
        total_chunk_count: 1,
      },
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`TikTok init failed: ${err.slice(0, 200)}`);
  }

  const initData = await initRes.json() as { data: { publish_id: string; upload_url: string } };
  const uploadUrl = initData.data.upload_url;

  // Step 2: Upload video binary
  const videoBuffer = readFileSync(opts.videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${fileSize - 1}/${fileSize}`,
    },
    body: videoBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`TikTok upload failed: ${uploadRes.status}`);
  }

  return {
    platform: "tiktok",
    success: true,
    postId: initData.data.publish_id,
    status: "draft", // TikTok sends to drafts, user publishes from app
  };
}

// ─── YouTube Data API v3 ───

async function publishToYouTube(opts: PublishOptions, caption: string): Promise<PublishResult> {
  const auth = opts.youtube ?? {
    accessToken: process.env.YOUTUBE_ACCESS_TOKEN ?? "",
  };

  if (!auth.accessToken) {
    throw new Error("YouTube access token required (set YOUTUBE_ACCESS_TOKEN or pass youtube.accessToken)");
  }

  const privacy = opts.privacy ?? "public";
  const title = opts.title ?? caption.split("\n")[0].slice(0, 100) ?? "Short";
  const fileSize = statSync(opts.videoPath).size;

  // Step 1: Initialize resumable upload
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Length": String(fileSize),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: {
          title,
          description: caption,
          tags: opts.hashtags ?? [],
          categoryId: "22", // People & Blogs
        },
        status: {
          privacyStatus: privacy,
          selfDeclaredMadeForKids: false,
          ...(opts.scheduledAt ? { publishAt: opts.scheduledAt } : {}),
        },
      }),
    },
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`YouTube init failed: ${err.slice(0, 200)}`);
  }

  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return upload URL");

  // Step 2: Upload video
  const videoBuffer = readFileSync(opts.videoPath);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: videoBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`YouTube upload failed: ${uploadRes.status}`);
  }

  const videoData = await uploadRes.json() as { id: string };
  const videoId = videoData.id;

  return {
    platform: "youtube",
    success: true,
    postId: videoId,
    postUrl: `https://youtube.com/shorts/${videoId}`,
    status: opts.scheduledAt ? "scheduled" : "published",
  };
}

// ─── Instagram Graph API ───

async function publishToInstagram(opts: PublishOptions, caption: string): Promise<PublishResult> {
  const auth = opts.instagram ?? {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN ?? "",
    igUserId: process.env.INSTAGRAM_USER_ID ?? "",
  };

  if (!auth.accessToken || !auth.igUserId) {
    throw new Error("Instagram access token and user ID required");
  }

  // Instagram requires a publicly accessible video URL
  // If no videoUrl provided, user must host it themselves
  const videoUrl = auth.videoUrl;
  if (!videoUrl) {
    throw new Error(
      "Instagram requires a public video URL. Upload to a CDN first and pass instagram.videoUrl",
    );
  }

  // Step 1: Create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${auth.igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        access_token: auth.accessToken,
      }),
    },
  );

  if (!containerRes.ok) {
    const err = await containerRes.text();
    throw new Error(`Instagram container failed: ${err.slice(0, 200)}`);
  }

  const { id: containerId } = await containerRes.json() as { id: string };

  // Step 2: Wait for processing (poll status)
  let status = "IN_PROGRESS";
  let attempts = 0;
  while (status === "IN_PROGRESS" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(
      `https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${auth.accessToken}`,
    );
    const statusData = await statusRes.json() as { status_code: string };
    status = statusData.status_code;
    attempts++;
  }

  if (status !== "FINISHED") {
    throw new Error(`Instagram processing failed: status=${status}`);
  }

  // Step 3: Publish
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${auth.igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: auth.accessToken,
      }),
    },
  );

  if (!publishRes.ok) {
    const err = await publishRes.text();
    throw new Error(`Instagram publish failed: ${err.slice(0, 200)}`);
  }

  const { id: mediaId } = await publishRes.json() as { id: string };

  return {
    platform: "instagram",
    success: true,
    postId: mediaId,
    postUrl: `https://www.instagram.com/reel/${mediaId}/`,
    status: "published",
  };
}