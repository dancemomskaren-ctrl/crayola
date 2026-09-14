import { afterEach, expect, spyOn, test } from "bun:test";
import { generateChristianClipTitle } from "./index";

let fetchSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => fetchSpy?.mockRestore());

test("generates and cleans a grounded church title using an OpenAI-compatible endpoint", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: '“Grace changed my life 🙏”' } }] }));
  expect(await generateChristianClipTitle("God gave me hope.", "test-key", "https://example.com/v1/")).toBe("Grace changed my life 🙏");
  const [url, options] = fetchSpy.mock.calls[0];
  expect(url).toBe("https://example.com/v1/chat/completions");
  expect(JSON.parse(options.body).messages[1].content).toBe("God gave me hope.");
  expect(options.headers.Authorization).toBe("Bearer test-key");
});

test("rejects missing credentials before making requests", async () => {
  await expect(generateChristianClipTitle("Grace", "", "https://example.com")).rejects.toThrow("API key required");
});

test("reports upstream failures without exposing response bodies", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("private response", { status: 429 }));
  await expect(generateChristianClipTitle("Grace", "key", "https://example.com")).rejects.toThrow("Clip title API error (429)");
});

test("rejects missing or overlong titles", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ choices: [] })).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "a".repeat(101) } }] }));
  await expect(generateChristianClipTitle("Grace", "key", "https://example.com")).rejects.toThrow("empty title");
  await expect(generateChristianClipTitle("Grace", "key", "https://example.com")).rejects.toThrow("invalid title");
});
