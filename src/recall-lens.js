import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

const FDA_FOOD_URL =
  "https://api.fda.gov/food/enforcement.json?limit=25&sort=report_date:desc";
const CPSC_URL =
  "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2026-04-01";

export const sources = [
  {
    name: "FDA food enforcement reports",
    url: "https://api.fda.gov/food/enforcement.json"
  },
  {
    name: "CPSC recall retrieval API",
    url: "https://www.saferproducts.gov/RestWebServices/Recall?format=json"
  }
];

export async function loadProfile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function fetchOfficialRecalls() {
  const [fda, cpsc] = await Promise.all([fetchFdaFood(), fetchCpscProducts()]);
  return [...fda, ...cpsc];
}

export async function fetchFdaFood(fetcher = fetch) {
  const response = await fetcher(FDA_FOOD_URL, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`FDA request failed: ${response.status}`);
  }

  const payload = await response.json();
  return (payload.results ?? []).map((item) => ({
    source: "FDA",
    title: item.product_description ?? "Food recall",
    date: formatFdaDate(item.report_date),
    url:
      "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts",
    company: item.recalling_firm ?? "",
    risk: item.classification ?? "Unclassified",
    reason: item.reason_for_recall ?? "",
    remedy: item.recall_initiation_date
      ? `Recall began ${formatFdaDate(item.recall_initiation_date)}. Check product codes before using.`
      : "Check product codes before using.",
    raw: item
  }));
}

export async function fetchCpscProducts(fetcher = fetch) {
  const response = await fetcher(CPSC_URL, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`CPSC request failed: ${response.status}`);
  }

  const payload = await response.json();
  return (Array.isArray(payload) ? payload : []).slice(0, 25).map((item) => ({
    source: "CPSC",
    title: item.Title ?? "Product recall",
    date: formatIsoDate(item.RecallDate),
    url: item.URL ?? "https://www.cpsc.gov/Recalls",
    company: collectNames(item.Manufacturers),
    risk: collectNames(item.Hazards) || "Product safety hazard",
    reason: [item.Description, collectNames(item.Hazards)].filter(Boolean).join(" "),
    remedy: collectNames(item.Remedies) || "Check the official notice before using.",
    raw: item
  }));
}

export function rankRecalls(recalls, profile) {
  return recalls
    .map((recall) => ({ ...recall, match: scoreRecall(recall, profile) }))
    .filter((recall) => recall.match.score > 0)
    .sort((a, b) => b.match.score - a.match.score || b.date.localeCompare(a.date));
}

export function scoreRecall(recall, profile) {
  const text = normalizeText(
    [recall.title, recall.company, recall.reason, recall.risk, recall.remedy].join(" ")
  );
  const hits = [];
  let score = 0;

  for (const term of profile.watch ?? []) {
    if (text.includes(normalizeText(term))) {
      hits.push(term);
      score += 3;
    }
  }

  for (const term of profile.allergens ?? []) {
    if (text.includes(normalizeText(term))) {
      hits.push(`allergen: ${term}`);
      score += 5;
    }
  }

  for (const term of profile.higherRisk ?? []) {
    if (text.includes(normalizeText(term))) {
      hits.push(`risk group: ${term}`);
      score += 4;
    }
  }

  if (/class i|death|serious injury|listeria|salmonella|e\. coli|botulism/.test(text)) {
    score += 5;
  } else if (/class ii|fire|burn|choking|lead|undeclared/.test(text)) {
    score += 3;
  }

  return {
    score,
    hits: [...new Set(hits)],
    action: actionFor(score, text)
  };
}

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderMarkdown(recalls, profile, generatedAt = new Date()) {
  const rows = recalls.length
    ? recalls
        .map(
          (recall, index) => `## ${index + 1}. ${shorten(recall.title, 120)}

- Source: ${recall.source}
- Date: ${recall.date || "unknown"}
- Why it matched: ${recall.match.hits.join(", ") || "safety language"}
- Suggested action: ${recall.match.action}
- Official notice: ${recall.url}
`
        )
        .join("\n")
    : "No matching recalls found for this profile.";

  return `# Recall Lens Report

Generated: ${generatedAt.toISOString()}
Profile: ${profile.name}

Recall Lens checks official recall data and turns it into a short household action list. Treat texts, calls, and emails as untrusted until the official notice confirms the recall.

${rows}

## Sources

${sources.map((source) => `- ${source.name}: ${source.url}`).join("\n")}
`;
}

export function renderHtml(recalls, profile, generatedAt = new Date()) {
  const cards = recalls.length
    ? recalls
        .map(
          (recall) => `<article class="card">
  <div class="meta"><span>${escapeHtml(recall.source)}</span><span>${escapeHtml(recall.date || "unknown")}</span></div>
  <h2>${escapeHtml(shorten(recall.title, 150))}</h2>
  <p>${escapeHtml(recall.match.action)}</p>
  <p class="hits">${escapeHtml(recall.match.hits.join(" · ") || "safety language")}</p>
  <a href="${escapeAttribute(recall.url)}">Open official notice</a>
</article>`
        )
        .join("\n")
    : `<p class="empty">No matching recalls found for this profile.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recall Lens</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #151515; background: #f6f3ed; }
    body { margin: 0; }
    main { max-width: 980px; margin: 0 auto; padding: 48px 20px 56px; }
    header { display: grid; gap: 14px; margin-bottom: 28px; }
    h1 { font-size: clamp(2.2rem, 4vw, 4rem); line-height: 0.95; margin: 0; max-width: 760px; }
    .lede { font-size: 1.1rem; line-height: 1.55; max-width: 680px; margin: 0; color: #3d3a35; }
    .stamp { color: #666056; font-size: 0.95rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
    .card { background: #fffdfa; border: 1px solid #d8d1c5; border-radius: 8px; padding: 18px; box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
    .meta { display: flex; justify-content: space-between; gap: 12px; color: #6f5c3d; font-size: 0.82rem; font-weight: 700; text-transform: uppercase; }
    h2 { font-size: 1.05rem; line-height: 1.3; margin: 14px 0 10px; }
    p { line-height: 1.5; }
    .hits { color: #685f52; font-size: 0.92rem; }
    a { color: #005a8d; font-weight: 700; }
    .note { margin-top: 28px; padding-top: 18px; border-top: 1px solid #d8d1c5; color: #514c44; }
    .empty { background: #fffdfa; border: 1px solid #d8d1c5; border-radius: 8px; padding: 18px; }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="stamp">Generated ${escapeHtml(generatedAt.toISOString())} for ${escapeHtml(profile.name)}</div>
      <h1>Recall Lens turns official alerts into a short household checklist.</h1>
      <p class="lede">Real recalls and fake recall texts are landing in the same inboxes. This page matches official FDA and CPSC data against a small household profile, then gives one plain next step for each hit.</p>
    </header>
    <section class="grid">${cards}</section>
    <p class="note">Do not click recall links from texts or surprise emails. Use the official notice link, the brand site reached manually, or the agency recall page.</p>
  </main>
</body>
</html>`;
}

export async function writeReportFiles({ recalls, profile, outDir, generatedAt }) {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(`${outDir}/report.md`, renderMarkdown(recalls, profile, generatedAt)),
    writeFile(`${outDir}/index.html`, renderHtml(recalls, profile, generatedAt)),
    writeFile(`${outDir}/recalls.json`, `${JSON.stringify(recalls.map(slimRecall), null, 2)}\n`)
  ]);
}

function slimRecall(recall) {
  return {
    source: recall.source,
    title: recall.title,
    date: recall.date,
    url: recall.url,
    company: recall.company,
    risk: recall.risk,
    reason: recall.reason,
    remedy: recall.remedy,
    match: recall.match
  };
}

function actionFor(score, text) {
  if (score >= 12) {
    return "Compare the UPC, lot, model, or date code with the official notice. Stop using it if the details match.";
  }
  if (/undeclared|allergen|sesame|fish|milk|peanut|wheat|tree nut/.test(text)) {
    return "Check the ingredient and allergen language before anyone with that allergy uses it.";
  }
  return "Compare the official notice with the product at home before acting on any message.";
}

function formatFdaDate(value) {
  const text = String(value ?? "");
  return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text;
}

function formatIsoDate(value) {
  return String(value ?? "").slice(0, 10);
}

function collectNames(items) {
  return (items ?? [])
    .map((item) => item.Name ?? item.Option ?? item.Country ?? item.URL ?? "")
    .filter(Boolean)
    .join(" ");
}

function shorten(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
