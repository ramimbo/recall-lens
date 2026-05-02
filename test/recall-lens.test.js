import test from "node:test";
import assert from "node:assert/strict";
import { normalizeText, rankRecalls, renderHtml, renderMarkdown, scoreRecall } from "../src/recall-lens.js";

const profile = {
  name: "Test home",
  watch: ["charger", "honey"],
  allergens: ["sesame", "fish"],
  higherRisk: ["child"]
};

test("normalizes messy recall text", () => {
  assert.equal(normalizeText("HTRC T400 Battery-Charger!!!"), "htrc t400 battery charger");
});

test("scores recalls with allergen and product hits above generic recalls", () => {
  const strong = scoreRecall(
    {
      title: "Dragon sauce recall",
      company: "Booey's",
      reason: "Contains statement does not declare fish and sesame.",
      risk: "Class II",
      remedy: "Check bottle UPC."
    },
    profile
  );
  const weak = scoreRecall(
    {
      title: "Garden shovel recall",
      company: "Example",
      reason: "Handle may crack.",
      risk: "Product safety hazard",
      remedy: "Contact firm."
    },
    profile
  );

  assert.ok(strong.score > weak.score);
  assert.deepEqual(strong.hits, ["allergen: sesame", "allergen: fish"]);
});

test("ranks and renders only matched recalls", () => {
  const ranked = rankRecalls(
    [
      {
        source: "CPSC",
        title: "Battery chargers recalled due to fire hazard",
        date: "2026-04-02",
        url: "https://example.test",
        company: "",
        risk: "fire hazard",
        reason: "",
        remedy: ""
      },
      {
        source: "FDA",
        title: "Unrelated item",
        date: "2026-04-01",
        url: "https://example.test",
        company: "",
        risk: "",
        reason: "No matching words",
        remedy: ""
      }
    ],
    profile
  );

  assert.equal(ranked.length, 1);
  assert.match(renderMarkdown(ranked, profile), /Battery chargers/);
});

test("renders a self-contained app shell with embedded recall data", () => {
  const recall = {
    source: "CPSC",
    title: "Battery chargers recalled due to fire hazard",
    date: "2026-04-02",
    url: "https://example.test",
    company: "Example Co",
    risk: "fire hazard",
    reason: "A charger can overheat.",
    remedy: "Stop using it.",
    match: { score: 11, hits: ["charger"], action: "Check the official notice." }
  };
  const html = renderHtml({
    recalls: [recall],
    allRecalls: [recall],
    profile,
    generatedAt: new Date("2026-05-02T12:00:00Z")
  });

  assert.match(html, /id="appState"/);
  assert.match(html, /Official recall triage/);
  assert.match(html, /let mode = "priority"/);
  assert.match(html, /Battery chargers recalled/);
});
