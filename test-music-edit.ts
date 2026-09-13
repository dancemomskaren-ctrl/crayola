#!/usr/bin/env bun
// Test script for music-edit endpoint

const API_URL = "http://localhost:3000/api/music-edit";

const testRequest = {
  audioFile: "/path/to/music.mp3", // UPDATE THIS
  sourceVideos: [
    "/path/to/video1.mp4", // UPDATE THIS
    "/path/to/video2.mp4", // UPDATE THIS
  ],
  platform: "9:16",
  cutDensity: "auto",
  minClipLength: 0.5,
  maxClipLength: 4,
  captionStyle: "none", // or "scattered_neon"
  transitionStyle: "cut",
  quality: "high",
};

console.log("Sending music-edit request...");
console.log(JSON.stringify(testRequest, null, 2));

const response = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(testRequest),
});

const result = await response.json();

if (response.ok) {
  console.log("\n✅ Success!");
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n📹 Video: ${result.outputPath}`);
  console.log(`🎵 BPM: ${result.metadata.bpm}`);
  console.log(`✂️ Clips: ${result.metadata.totalClips}`);
  console.log(`⏱️ Duration: ${Math.round(result.metadata.durationMs / 1000)}s`);
} else {
  console.error("\n❌ Error:");
  console.error(JSON.stringify(result, null, 2));
}
