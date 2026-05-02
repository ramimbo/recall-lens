#!/usr/bin/env node
import { resolve } from "node:path";
import {
  fetchOfficialRecalls,
  loadProfile,
  rankRecalls,
  writeReportFiles
} from "./recall-lens.js";

const args = new Map(
  process.argv.slice(2).flatMap((arg, index, all) => {
    if (!arg.startsWith("--")) return [];
    const key = arg.slice(2);
    const next = all[index + 1];
    return [[key, next && !next.startsWith("--") ? next : true]];
  })
);

const profilePath = resolve(args.get("profile") || "data/household.example.json");
const outDir = resolve(args.get("out") || "dist");
const limit = Number(args.get("limit") || 12);
const generatedAt = new Date();

const profile = await loadProfile(profilePath);
const recalls = await fetchOfficialRecalls();
const ranked = rankRecalls(recalls, profile).slice(0, limit);

await writeReportFiles({ recalls: ranked, profile, outDir, generatedAt });

console.log(`Wrote ${ranked.length} recall matches to ${outDir}`);
