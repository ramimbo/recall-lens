#!/usr/bin/env node
import { createServer } from "node:http";
import {
  loadProfile,
  fetchOfficialRecalls,
  rankRecalls,
  renderHtml,
  renderMarkdown,
  slimRecall,
  sources
} from "./recall-lens.js";

const port = Number(process.env.PORT || 4177);
const profilePath = process.env.PROFILE_PATH || "data/household.example.json";
const cacheMs = Number(process.env.CACHE_MS || 5 * 60 * 1000);

let cache = {
  at: 0,
  recalls: [],
  error: null
};

async function currentRecalls(force = false) {
  const now = Date.now();
  if (!force && cache.recalls.length && now - cache.at < cacheMs) {
    return { ...cache, cached: true };
  }

  try {
    const recalls = await fetchOfficialRecalls();
    cache = { at: now, recalls, error: null };
  } catch (error) {
    cache = { ...cache, at: now, error: error.message };
  }
  return { ...cache, cached: false };
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function sendText(response, text) {
  response.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(text);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true, service: "recall-lens" });
    return;
  }

  if (url.pathname === "/api/recalls") {
    const force = url.searchParams.get("refresh") === "1";
    const data = await currentRecalls(force);
    const status = data.error && !data.recalls.length ? 502 : 200;
    sendJson(response, status, {
      generatedAt: new Date(data.at || Date.now()).toISOString(),
      cached: data.cached,
      error: data.error,
      sources,
      recalls: data.recalls.map(slimRecall)
    });
    return;
  }

  if (url.pathname === "/recalls.json") {
    const data = await currentRecalls(url.searchParams.get("refresh") === "1");
    sendJson(response, 200, {
      generatedAt: new Date(data.at || Date.now()).toISOString(),
      cached: data.cached,
      error: data.error,
      recalls: data.recalls.map(slimRecall)
    });
    return;
  }

  if (url.pathname === "/report.md") {
    const profile = await loadProfile(profilePath);
    const data = await currentRecalls();
    const ranked = rankRecalls(data.recalls, profile).slice(0, 12);
    sendText(response, renderMarkdown(ranked, profile, new Date(data.at || Date.now())));
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const profile = await loadProfile(profilePath);
    sendHtml(response, renderHtml({
      recalls: [],
      allRecalls: [],
      profile,
      generatedAt: new Date(),
      dataEndpoint: "/api/recalls"
    }));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found\n");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Recall Lens listening on http://127.0.0.1:${port}`);
});
