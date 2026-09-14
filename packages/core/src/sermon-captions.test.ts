import { expect, test } from "bun:test";
import { generateASS } from "./ass";
import { getTemplate } from "./templates";

test("sermon styles produce valid ASS style columns and use their declared styles", () => {
  for (const style of ["scripture", "testimony", "altar-call"]) {
    const ass = generateASS([{ text: "God is love", startMs: 0, endMs: 1600, reference: "1 John 4:8" }], style);
    const format = ass.split("\n").find(line => line.startsWith("Format: Name"))!;
    const definition = ass.split("\n").find(line => line.startsWith("Style:"))!;
    expect(definition.split(",").length).toBe(format.split(",").length);
    expect(ass).toContain(`,${definition.split(",")[0].slice(7)},,0,0,0,,`);
    if (style === "scripture") expect(ass).toContain("\\N{\\fs34}1 John 4:8");
    if (style === "altar-call") expect(ass).toContain("\\t(800,1200,\\fscx106\\fscy106)");
  }
  const options = getTemplate("sermon_clip")!.fields.find(field => field.key === "captionStyle")!.options!;
  expect(options.map(option => option.value)).toEqual(expect.arrayContaining(["scripture", "testimony", "altar-call"]));
});
