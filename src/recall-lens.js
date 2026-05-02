import { writeFile, mkdir, readFile } from "node:fs/promises";

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

export function renderHtml({
  recalls,
  allRecalls,
  profile,
  generatedAt = new Date(),
  dataEndpoint = null
}) {
  const appState = {
    generatedAt: generatedAt.toISOString(),
    profile,
    recalls: allRecalls.map(slimRecall),
    sources,
    dataEndpoint
  };
  const stateJson = JSON.stringify(appState).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recall Lens</title>
  <style>
    :root {
      color-scheme: dark;
      --paper: #080a0f;
      --panel: #121926;
      --panel-2: #182234;
      --ink: #f8fafc;
      --muted: #c2cad7;
      --line: #3a4a63;
      --red: #ff7a6e;
      --red-soft: #351b1e;
      --blue: #8fd3ff;
      --blue-soft: #153552;
      --green: #77d8a1;
      --green-soft: #132b24;
      --yellow: #f0c86b;
      --yellow-soft: #342911;
      --violet: #b69cff;
      --shadow: rgba(0, 0, 0, 0.3);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--paper);
      color: var(--ink);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; }
    button, input, select { font: inherit; }
    a { color: var(--blue); font-weight: 750; text-decoration-thickness: 0.08em; text-underline-offset: 0.16em; }
    .shell { max-width: 1240px; margin: 0 auto; padding: 22px 18px 42px; overflow-x: hidden; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 8px; background: var(--blue); color: #07111b; font-weight: 850; }
    .brand h1 { font-size: 1.12rem; line-height: 1; margin: 0; }
    .brand p { color: var(--muted); font-size: 0.9rem; margin: 4px 0 0; }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .button { min-height: 38px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); color: var(--ink); padding: 8px 11px; font-weight: 750; cursor: pointer; white-space: nowrap; }
    .button.primary { background: var(--blue); color: #07111b; border-color: var(--blue); }
    .button:hover { border-color: #5d7290; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr); gap: 14px; margin-bottom: 14px; }
    .brief { padding: 22px; background: linear-gradient(145deg, #172131, #111823 58%, #221927); border: 1px solid var(--line); border-radius: 8px; min-height: 222px; display: grid; align-content: space-between; box-shadow: 0 18px 60px var(--shadow); }
    .brief h2 { font-size: clamp(2.1rem, 5vw, 4.7rem); line-height: 0.93; margin: 0; max-width: 840px; letter-spacing: 0; overflow-wrap: anywhere; }
    .brief p { color: var(--muted); font-size: 1.02rem; line-height: 1.48; max-width: 720px; margin: 16px 0 0; }
    .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .stat { background: #101722; border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-height: 106px; display: grid; align-content: space-between; }
    .stat strong { font-size: 2rem; line-height: 1; }
    .stat span { color: var(--muted); font-size: 0.86rem; font-weight: 700; text-transform: uppercase; }
    .workspace { display: grid; grid-template-columns: 312px minmax(0, 1fr); gap: 14px; align-items: start; }
    .controls { position: sticky; top: 14px; display: grid; gap: 12px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 15px; }
    .panel h3 { margin: 0 0 12px; font-size: 0.98rem; }
    .field { display: grid; gap: 6px; margin-bottom: 12px; }
    label { color: #d9e1ed; font-size: 0.84rem; font-weight: 760; }
    input, select { width: 100%; border: 1px solid var(--line); background: #0b111c; color: var(--ink); border-radius: 8px; padding: 10px; }
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .tab, .profile-chip { border: 1px solid var(--line); border-radius: 8px; background: #0b111c; padding: 8px 10px; color: var(--muted); font-weight: 760; cursor: pointer; }
    .tab.active, .profile-chip.active { background: var(--blue-soft); border-color: var(--blue); color: var(--ink); }
    .profile-chip:hover { border-color: var(--blue); color: var(--ink); }
    .choice-group { display: grid; gap: 8px; margin-bottom: 14px; }
    .choice-group h4 { margin: 0; font-size: 0.84rem; color: #e5ebf4; }
    .choice-grid { display: flex; flex-wrap: wrap; gap: 7px; }
    .inline-add { display: grid; grid-template-columns: minmax(0, 1fr) 120px auto; gap: 8px; align-items: center; }
    .small { color: var(--muted); font-size: 0.84rem; line-height: 1.4; margin: 0; }
    .list-head { display: flex; justify-content: space-between; gap: 14px; align-items: end; margin: 2px 0 12px; }
    .list-head h2 { margin: 0; font-size: 1.24rem; }
    .list-head p { color: var(--muted); margin: 4px 0 0; }
    .recall-list { display: grid; gap: 10px; }
    .recall { background: var(--panel); border: 1px solid var(--line); border-left: 5px solid var(--blue); border-radius: 8px; padding: 16px; display: grid; gap: 11px; box-shadow: 0 10px 32px var(--shadow); }
    .recall.priority { border-left-color: var(--red); }
    .recall.allergen { border-left-color: var(--yellow); }
    .recall.product { border-left-color: var(--green); }
    .recall-top { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .source { display: inline-flex; align-items: center; min-height: 26px; border-radius: 8px; padding: 4px 8px; color: #fff; background: #236595; font-size: 0.76rem; font-weight: 850; }
    .source.FDA { background: #1c6b4c; }
    .score { min-width: 54px; text-align: right; color: var(--muted); font-weight: 800; }
    .recall h3 { font-size: 1.08rem; line-height: 1.3; margin: 0; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip { display: inline-flex; align-items: center; min-height: 26px; border-radius: 8px; padding: 4px 8px; background: #1c2634; color: #dbe3ef; font-size: 0.8rem; font-weight: 720; }
    .chip.red { background: var(--red-soft); color: var(--red); }
    .chip.yellow { background: var(--yellow-soft); color: var(--yellow); }
    .chip.green { background: var(--green-soft); color: var(--green); }
    .action-line { margin: 0; font-size: 0.98rem; line-height: 1.45; }
    details { border-top: 1px solid var(--line); padding-top: 10px; }
    summary { cursor: pointer; color: var(--blue); font-weight: 800; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
    .detail-grid p { margin: 0; color: #d3d9e4; line-height: 1.45; }
    .empty { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 22px; color: var(--muted); }
    .footer { color: var(--muted); margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 0.88rem; }
    .status { color: var(--muted); font-size: 0.9rem; margin: 0 0 12px; }
    @media (max-width: 860px) {
      .topbar, .list-head, .recall-top { align-items: stretch; flex-direction: column; }
      .actions { justify-content: flex-start; }
      .hero, .workspace { grid-template-columns: 1fr; }
      .controls { position: static; }
      .brief { min-height: 0; }
      .detail-grid { grid-template-columns: 1fr; }
      .inline-add { grid-template-columns: 1fr; }
    }
    @media (max-width: 520px) {
      .shell { padding: 14px 12px 32px; }
      .stats { grid-template-columns: 1fr; }
      .brief { padding: 18px; }
      .brief h2 { font-size: 1.86rem; line-height: 1.04; }
      .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
      .actions .button { text-align: center; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="mark">RL</div>
        <div>
          <h1>Recall Lens</h1>
          <p id="generatedLabel">Official recall scan</p>
        </div>
      </div>
      <div class="actions">
        <button class="button" id="refreshButton" type="button">Refresh data</button>
        <a class="button" href="report.md">Report</a>
        <a class="button" href="recalls.json">JSON</a>
        <button class="button primary" id="printButton" type="button">Print</button>
      </div>
    </header>
    <section class="hero">
      <div class="brief">
        <div>
          <h2>Official recall triage for a real home.</h2>
          <p>FDA food alerts and CPSC product recalls, matched against the items and risk groups that matter.</p>
        </div>
      </div>
      <div class="stats" aria-label="Recall summary">
        <div class="stat"><strong id="matchCount">0</strong><span>Matches</span></div>
        <div class="stat"><strong id="priorityCount">0</strong><span>Priority</span></div>
        <div class="stat"><strong id="allergenCount">0</strong><span>Allergen</span></div>
        <div class="stat"><strong id="sourceCount">0</strong><span>Records scanned</span></div>
      </div>
    </section>
    <section class="workspace">
      <aside class="controls">
        <div class="panel">
          <h3>Household Profile</h3>
          <p class="small">Tap what matters. Results update immediately.</p>
          <div class="choice-group">
            <h4>Items</h4>
            <div class="choice-grid" id="watchChoices"></div>
          </div>
          <div class="choice-group">
            <h4>Allergies</h4>
            <div class="choice-grid" id="allergenChoices"></div>
          </div>
          <div class="choice-group">
            <h4>Care needs</h4>
            <div class="choice-grid" id="riskChoices"></div>
          </div>
          <div class="inline-add">
            <input id="customTermInput" type="text" placeholder="Add term">
            <select id="customGroupSelect" aria-label="Term type">
              <option value="watch">Item</option>
              <option value="allergens">Allergy</option>
              <option value="higherRisk">Care</option>
            </select>
            <button class="button" id="addCustomTerm" type="button">Add</button>
          </div>
        </div>
        <div class="panel">
          <h3>Filter</h3>
          <div class="field">
            <label for="searchInput">Search</label>
            <input id="searchInput" type="search" placeholder="brand, product, hazard">
          </div>
          <div class="field">
            <label for="sourceFilter">Source</label>
            <select id="sourceFilter">
              <option value="all">All sources</option>
              <option value="FDA">FDA</option>
              <option value="CPSC">CPSC</option>
            </select>
          </div>
          <div class="field">
            <label for="sortFilter">Sort</label>
            <select id="sortFilter">
              <option value="priority">Priority first</option>
              <option value="newest">Newest first</option>
              <option value="source">Source</option>
            </select>
          </div>
          <div class="tabs" role="tablist" aria-label="Recall categories">
            <button class="tab" data-mode="all" type="button">All</button>
            <button class="tab active" data-mode="priority" type="button">Priority</button>
            <button class="tab" data-mode="allergen" type="button">Allergen</button>
            <button class="tab" data-mode="product" type="button">Product</button>
          </div>
        </div>
        <div class="panel">
          <h3>Sources</h3>
          <p class="small">FDA food enforcement reports and CPSC product recalls. Agency links open the official notice or recall index.</p>
        </div>
      </aside>
      <section>
        <div class="list-head">
          <div>
            <h2 id="resultsTitle">Matches</h2>
            <p id="resultsSubhead">Sorted by score and date.</p>
          </div>
        </div>
        <p class="status" id="statusLine">Loading current recall data...</p>
        <div class="recall-list" id="recallList"></div>
      </section>
    </section>
    <p class="footer">Treat surprise recall texts and emails as untrusted. Use agency pages, product labels, and manually reached brand sites before sending personal details.</p>
  </main>
  <script type="application/json" id="appState">${stateJson}</script>
  <script>
    let state = JSON.parse(document.getElementById("appState").textContent);
    const els = {
      generatedLabel: document.getElementById("generatedLabel"),
      matchCount: document.getElementById("matchCount"),
      priorityCount: document.getElementById("priorityCount"),
      allergenCount: document.getElementById("allergenCount"),
      sourceCount: document.getElementById("sourceCount"),
      watchChoices: document.getElementById("watchChoices"),
      allergenChoices: document.getElementById("allergenChoices"),
      riskChoices: document.getElementById("riskChoices"),
      customTermInput: document.getElementById("customTermInput"),
      customGroupSelect: document.getElementById("customGroupSelect"),
      addCustomTerm: document.getElementById("addCustomTerm"),
      refreshButton: document.getElementById("refreshButton"),
      searchInput: document.getElementById("searchInput"),
      sourceFilter: document.getElementById("sourceFilter"),
      sortFilter: document.getElementById("sortFilter"),
      recallList: document.getElementById("recallList"),
      resultsTitle: document.getElementById("resultsTitle"),
      resultsSubhead: document.getElementById("resultsSubhead"),
      statusLine: document.getElementById("statusLine"),
      printButton: document.getElementById("printButton")
    };
    let mode = "priority";
    let profile = structuredClone(state.profile);
    const profileOptions = {
      watch: ["baby", "toy", "charger", "battery", "power bank", "dresser", "bed rail", "furniture", "pool", "medicine", "dates", "sauce", "cinnamon", "cheese"],
      allergens: ["fish", "sesame", "wheat", "milk", "peanut", "tree nut", "egg", "soy", "shellfish"],
      higherRisk: ["child", "toddler", "pregnant", "older adult", "immune", "asthma", "mobility"]
    };

    addMissingOptions();
    renderProfileControls();
    updateGeneratedLabel();
    els.sourceCount.textContent = state.recalls.length;

    function updateGeneratedLabel() {
      els.generatedLabel.textContent = new Date(state.generatedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
    }

    function normalize(value) {
      return String(value || "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").replace(/\\s+/g, " ").trim();
    }

    function groupTerms(group) {
      return profile[group] || [];
    }

    function hasTerm(group, term) {
      return groupTerms(group).map(normalize).includes(normalize(term));
    }

    function addMissingOptions() {
      for (const group of Object.keys(profileOptions)) {
        for (const term of groupTerms(group)) {
          if (!profileOptions[group].map(normalize).includes(normalize(term))) {
            profileOptions[group].push(term);
          }
        }
      }
    }

    function renderProfileControls() {
      renderChoiceGroup(els.watchChoices, "watch");
      renderChoiceGroup(els.allergenChoices, "allergens");
      renderChoiceGroup(els.riskChoices, "higherRisk");
    }

    function renderChoiceGroup(container, group) {
      container.innerHTML = profileOptions[group].map((term) => {
        const active = hasTerm(group, term) ? " active" : "";
        return '<button class="profile-chip' + active + '" data-group="' + group + '" data-term="' + escapeAttribute(term) + '" type="button">' + escapeHtml(term) + '</button>';
      }).join("");
    }

    function toggleProfileTerm(group, term) {
      const terms = groupTerms(group);
      profile[group] = hasTerm(group, term)
        ? terms.filter((item) => normalize(item) !== normalize(term))
        : [...terms, term];
      renderProfileControls();
      render();
    }

    function addCustomTerm() {
      const term = els.customTermInput.value.trim();
      if (!term) return;
      const group = els.customGroupSelect.value;
      if (!profileOptions[group].map(normalize).includes(normalize(term))) {
        profileOptions[group].push(term);
      }
      if (!hasTerm(group, term)) {
        profile[group] = [...groupTerms(group), term];
      }
      els.customTermInput.value = "";
      renderProfileControls();
      render();
    }

    function scoreRecall(recall) {
      const text = normalize([recall.title, recall.company, recall.reason, recall.risk, recall.remedy].join(" "));
      const hits = [];
      let score = 0;
      for (const term of profile.watch || []) {
        if (text.includes(normalize(term))) {
          hits.push(term);
          score += 3;
        }
      }
      for (const term of profile.allergens || []) {
        if (text.includes(normalize(term))) {
          hits.push("allergen: " + term);
          score += 5;
        }
      }
      for (const term of profile.higherRisk || []) {
        if (text.includes(normalize(term))) {
          hits.push("risk group: " + term);
          score += 4;
        }
      }
      if (/class i|death|serious injury|listeria|salmonella|e\\. coli|botulism/.test(text)) score += 5;
      else if (/class ii|fire|burn|choking|lead|undeclared/.test(text)) score += 3;
      return { score, hits: [...new Set(hits)], action: actionFor(score, text) };
    }

    function actionFor(score, text) {
      if (score >= 12) return "Compare the UPC, lot, model, or date code with the official notice. Stop using it if the details match.";
      if (/undeclared|allergen|sesame|fish|milk|peanut|wheat|tree nut/.test(text)) return "Check the ingredient and allergen language before anyone with that allergy uses it.";
      return "Compare the official notice with the product at home before acting on any message.";
    }

    function classify(recall) {
      const hitText = recall.match.hits.join(" ").toLowerCase();
      if (recall.match.score >= 12) return "priority";
      if (hitText.includes("allergen")) return "allergen";
      return "product";
    }

    function rankedRecalls() {
      const ranked = state.recalls
        .map((recall) => ({ ...recall, match: scoreRecall(recall) }))
        .filter((recall) => recall.match.score > 0);
      if (els.sortFilter.value === "newest") {
        return ranked.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.match.score - a.match.score);
      }
      if (els.sortFilter.value === "source") {
        return ranked.sort((a, b) => a.source.localeCompare(b.source) || b.match.score - a.match.score);
      }
      return ranked.sort((a, b) => b.match.score - a.match.score || String(b.date).localeCompare(String(a.date)));
    }

    function filteredRecalls() {
      const query = normalize(els.searchInput.value);
      const source = els.sourceFilter.value;
      return rankedRecalls().filter((recall) => {
        if (source !== "all" && recall.source !== source) return false;
        if (mode !== "all" && classify(recall) !== mode) return false;
        if (!query) return true;
        return normalize([recall.title, recall.company, recall.reason, recall.risk, recall.remedy, recall.match.hits.join(" ")].join(" ")).includes(query);
      });
    }

    function render() {
      const ranked = rankedRecalls();
      const recalls = filteredRecalls();
      els.matchCount.textContent = ranked.length;
      els.priorityCount.textContent = ranked.filter((recall) => classify(recall) === "priority").length;
      els.allergenCount.textContent = ranked.filter((recall) => classify(recall) === "allergen").length;
      els.sourceCount.textContent = state.recalls.length;
      els.resultsTitle.textContent = recalls.length === 1 ? "1 match" : recalls.length + " matches";
      els.resultsSubhead.textContent = "Showing " + (els.sourceFilter.value === "all" ? "FDA and CPSC" : els.sourceFilter.value) + " records.";
      els.statusLine.textContent = state.error
        ? "Using the latest available data. Refresh failed: " + state.error
        : "Current data loaded from official FDA and CPSC feeds.";
      els.recallList.innerHTML = recalls.length
        ? recalls.map(renderRecall).join("")
        : '<p class="empty">No matches for this profile and filter.</p>';
    }

    function renderRecall(recall) {
      const group = classify(recall);
      return '<article class="recall ' + group + '">' +
        '<div class="recall-top"><span class="source ' + recall.source + '">' + escapeHtml(recall.source) + '</span><span class="score">' + recall.match.score + '</span></div>' +
        '<h3>' + escapeHtml(shorten(recall.title, 170)) + '</h3>' +
        '<div class="meta">' + chips(recall, group) + '</div>' +
        '<p class="action-line">' + escapeHtml(recall.match.action) + '</p>' +
        '<details><summary>Details</summary><div class="detail-grid">' +
        '<p><strong>Risk</strong><br>' + escapeHtml(shorten(recall.risk || "Not listed", 260)) + '</p>' +
        '<p><strong>Reason</strong><br>' + escapeHtml(shorten(recall.reason || "Not listed", 260)) + '</p>' +
        '<p><strong>Company</strong><br>' + escapeHtml(recall.company || "Not listed") + '</p>' +
        '<p><strong>Remedy</strong><br>' + escapeHtml(shorten(recall.remedy || "Check the notice.", 260)) + '</p>' +
        '</div></details>' +
        '<a href="' + escapeAttribute(recall.url) + '">Open official notice</a>' +
      '</article>';
    }

    function chips(recall, group) {
      const color = group === "priority" ? "red" : group === "allergen" ? "yellow" : "green";
      const chips = ['<span class="chip ' + color + '">' + escapeHtml(group) + '</span>'];
      if (recall.date) chips.push('<span class="chip">' + escapeHtml(recall.date) + '</span>');
      for (const hit of recall.match.hits.slice(0, 4)) {
        chips.push('<span class="chip">' + escapeHtml(hit) + '</span>');
      }
      return chips.join("");
    }

    function shorten(value, max) {
      const text = String(value || "").replace(/\\s+/g, " ").trim();
      return text.length > max ? text.slice(0, max - 1).trim() + "..." : text;
    }

    function escapeHtml(value) {
      return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    }

    function escapeAttribute(value) {
      return escapeHtml(value).replaceAll("'", "&#39;");
    }

    document.querySelector(".controls").addEventListener("click", (event) => {
      const chip = event.target.closest(".profile-chip");
      if (!chip) return;
      toggleProfileTerm(chip.dataset.group, chip.dataset.term);
    });
    els.addCustomTerm.addEventListener("click", addCustomTerm);
    els.customTermInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addCustomTerm();
    });
    els.searchInput.addEventListener("input", render);
    els.sourceFilter.addEventListener("change", render);
    els.sortFilter.addEventListener("change", render);
    els.printButton.addEventListener("click", () => window.print());
    els.refreshButton.addEventListener("click", () => refreshData(true));
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        mode = tab.dataset.mode;
        document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
        render();
      });
    });
    async function refreshData(force = false) {
      if (!state.dataEndpoint) {
        render();
        return;
      }
      els.statusLine.textContent = "Refreshing official recall data...";
      els.refreshButton.disabled = true;
      try {
        const url = force ? state.dataEndpoint + "?refresh=1" : state.dataEndpoint;
        const response = await fetch(url, { headers: { accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Request failed");
        state = { ...state, ...payload, dataEndpoint: state.dataEndpoint };
        updateGeneratedLabel();
      } catch (error) {
        state = { ...state, error: error.message };
      } finally {
        els.refreshButton.disabled = false;
        render();
      }
    }
    refreshData(false);
  </script>
</body>
</html>`;
}

export async function writeReportFiles({ recalls, allRecalls = recalls, profile, outDir, generatedAt }) {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(`${outDir}/report.md`, renderMarkdown(recalls, profile, generatedAt)),
    writeFile(`${outDir}/index.html`, renderHtml({ recalls, allRecalls, profile, generatedAt })),
    writeFile(`${outDir}/recalls.json`, `${JSON.stringify(recalls.map(slimRecall), null, 2)}\n`)
  ]);
}

export function slimRecall(recall) {
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
