export {
  db,
  client,
  project,
  render,
  asset,
  caption,
  batch,
  analytics,
  postQueue,
} from "./db";
export * as ffmpeg from "./ffmpeg";
export { ASPECTS, QUALITY, mixAudio } from "./ffmpeg";
export type {
  AspectRatio,
  AspectDef,
  QualityPreset,
  QualityDef,
  TransitionType,
  AudioTrack,
  SFXEntry,
  MixAudioOpts,
} from "./ffmpeg";
export { generateFakeText } from "./fake-text";
export type { Message, FakeTextOpts } from "./fake-text";
export { TEMPLATES, availableTemplates, getTemplate, getTemplatesByCategory } from "./templates";
export type { Template, TemplateField } from "./templates";
export { generateASS, writeASS, getCaptionStyles } from "./ass";
export type { CaptionAnim } from "./ass";
export {
  buildWordCaptionFilter,
  buildLineBasedWordCaptions,
} from "./word-captions";
export type { WordCaption, WordCaptionStyle } from "./word-captions";
export { generateViralASS, VIRAL_STYLES } from "./viral-captions";
export type { ViralCaptionStyle, WordTimestamp } from "./viral-captions";
export {
  generateScatteredWordFilters,
  buildScatteredWordFilterComplex,
  generateScatteredWordFiltersBatched,
} from "./scattered-captions";
export type { ScatteredWordOptions } from "./scattered-captions";
