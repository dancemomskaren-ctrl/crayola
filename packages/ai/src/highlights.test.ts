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
    "Read from the book of Job.",
    "Mark chapter four tells us this.",
    "Turn to 2 Timothy 1:7.",
    "COME\nFORWARD and receive grace.",
    "God\nhealed my broken heart.",
    "What a moment. [Audience laughter and applause]",
    "What a moment. (congregation cheering loudly)",
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

  for (const text of [
    "The job requires a steady effort.",
    "Please mark the date for registration.",
    "The numbers indicate a steady increase.",
    "The judges reached a unanimous decision.",
    "These acts require a steady effort.",
    "Our applause team meets every Tuesday.",
  ]) {
    test(`does not mistake ordinary language for scripture or audience reactions: ${text}`, () => {
      expect(score(text)).toBe(score("The room contains a wooden table."));
    });
  }

  test("repeated signals do not inflate scores", () => {
    expect(score("Come forward. Come forward. Come forward."))
      .toBe(score("Come forward and receive grace."));
  });

  test("combined ministry signals strengthen a highlight", () => {
    expect(score("God healed me. [applause]"))
      .toBeGreaterThan(score("God healed me."));
  });

  test("handles an empty transcript", () => {
    expect(detectHighlights([])).toEqual([]);
  });
});
