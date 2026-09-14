import { expect, test } from "bun:test";
import { extractCompetitorPage } from "./research-competitors";

test("extracts visible features, pricing context, and ministry mentions", () => {
  const result = extractCompetitorPage('<script>church secret $999</script><h2>AI captions</h2><p>Starter plan</p><div>$29</div><p>per month, billed annually</p><li>Share sermons with churches &amp; ministries</li>', "https://example.com");
  expect(result.features).toContain("AI captions");
  expect(result.pricing.join(" ")).toContain("$29");
  expect(result.pricing.join(" ")).toContain("billed annually");
  expect(result.ministryMentions).toEqual(["Share sermons with churches & ministries"]);
  expect(JSON.stringify(result)).not.toContain("$999");
});
