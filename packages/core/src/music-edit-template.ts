// Music Edit / Beat Sync template
// Automatically cuts video clips to music beats

import type { Template } from "./types";

export const musicEditTemplate: Template = {
  id: "music-edit",
  name: "Music Edit",
  icon: "🎵",
  description: "Auto-cut video clips to music beats (aesthetic edits, AMV, GMV)",
  category: "creative",
  
  defaults: {
    platform: "9:16",
    quality: "high",
    captionStyle: "scattered_neon",
    cutDensity: "auto", // auto, low, medium, high
    minClipLength: 0.5, // seconds
    maxClipLength: 4, // seconds
    enableBroll: false,
    transitionStyle: "cut", // cut, fade, dissolve
  },

  fields: [
    {
      key: "audioFile",
      label: "Music Track",
      type: "file",
      accept: "audio/*",
      required: true,
      help: "Upload the music track to sync video clips to",
    },
    {
      key: "sourceVideos",
      label: "Source Video Clips",
      type: "file",
      accept: "video/*",
      multiple: true,
      required: true,
      help: "Upload 2-5 video clips to cut between (full-length videos work best)",
    },
    {
      key: "platform",
      label: "Platform Format",
      type: "select",
      options: [
        { value: "9:16", label: "TikTok/Shorts (9:16)" },
        { value: "1:1", label: "Instagram Square (1:1)" },
        { value: "16:9", label: "YouTube (16:9)" },
      ],
      default: "9:16",
    },
    {
      key: "cutDensity",
      label: "Cut Density",
      type: "select",
      options: [
        { value: "auto", label: "Auto (follows music energy)" },
        { value: "low", label: "Low (1 cut every 2 seconds)" },
        { value: "medium", label: "Medium (1 cut per second)" },
        { value: "high", label: "High (2 cuts per second)" },
      ],
      default: "auto",
      help: "Auto mode cuts faster during drops/chorus, slower during verses",
    },
    {
      key: "minClipLength",
      label: "Min Clip Length (sec)",
      type: "slider",
      min: 0.25,
      max: 2,
      step: 0.25,
      default: 0.5,
    },
    {
      key: "maxClipLength",
      label: "Max Clip Length (sec)",
      type: "slider",
      min: 1,
      max: 10,
      step: 0.5,
      default: 4,
    },
    {
      key: "captionStyle",
      label: "Caption Style",
      type: "select",
      options: [
        { value: "none", label: "No captions" },
        { value: "scattered_clean", label: "🎨 Scattered - Clean" },
        { value: "scattered_neon", label: "🎮 Scattered - Neon" },
        { value: "scattered_pastel", label: "🌸 Scattered - Pastel" },
        { value: "scattered_bold", label: "💥 Scattered - Bold" },
        { value: "viral_mrbeast", label: "🔥 MrBeast (yellow pop)" },
        { value: "viral_hormozi", label: "💼 Hormozi (cyan bold)" },
      ],
      default: "scattered_neon",
      help: "Scattered styles work best for aesthetic edits",
    },
    {
      key: "enableBroll",
      label: "Enable B-Roll Injection",
      type: "checkbox",
      default: false,
      help: "Randomly insert short overlay clips on beats (requires B-roll folder)",
    },
    {
      key: "transitionStyle",
      label: "Transition Style",
      type: "select",
      options: [
        { value: "cut", label: "Hard Cut (instant)" },
        { value: "fade", label: "Fade (0.2s crossfade)" },
        { value: "dissolve", label: "Dissolve (0.3s blend)" },
      ],
      default: "cut",
    },
    {
      key: "quality",
      label: "Export Quality",
      type: "select",
      options: [
        { value: "draft", label: "Draft (720p, fast)" },
        { value: "standard", label: "Standard (1080p)" },
        { value: "high", label: "High (1080p, CRF 18)" },
        { value: "ultra", label: "Ultra (4K, slow)" },
      ],
      default: "high",
    },
  ],
};
