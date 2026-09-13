import { describe, expect, test } from "bun:test";
import { detectHighlights } from "./index";

describe("sermon highlight scoring", () => {
  const score = (text: string) => detectHighlights([
    { text, startMs: 0, endMs: 20000 },
  ])[0].score;

  for (const text of [
    "Open your Bible to Romans.",
    "The promise is in 3:16.",
    "Come forward and repeat after me.",
    "Raise your hand.",
    "I was lost until God healed me.",
    "Before I knew Christ, everything was different.",
    "He turned everything around. [audience applause]",
    "That was quite a surprise! (laughter)",
  ]) {
    test(`prioritizes ${text}`, () => {
      expect(score(text)).toBeGreaterThan(score("Amazing incredible shocking secret truth!"));
    });
  }

  test("does not match hooks inside unrelated words", () => {
    expect(score("The shell contains a watchmaker's necklace."))
      .toBe(score("The room contains a wooden table."));
  });

  test("ranks ministry moments first", () => {
    const clips = detectHighlights([
      { text: "Amazing incredible shocking secret truth!", startMs: 0, endMs: 20000 },
      { text: "God healed me.", startMs: 22000, endMs: 42000 },
    ], { clipCount: 1 });
    expect(clips[0].text).toBe("God healed me.");
  });

  test("handles an empty transcript", () => {
    expect(detectHighlights([])).toEqual([]);
  });
});
