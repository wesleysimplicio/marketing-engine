import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SKIP = new Set([".git", "node_modules", "dist", "build", "coverage", "test-results", "playwright-report"]);
const JSON_SUFFIXES = new Set([".json", ".jsonl", ".ndjson"]);
const INTERNAL = new Set(["internal_persistence", "internal_cache", "internal_ipc", "internal_fixture_or_evidence", "internal_index"]);
const SOURCE_SUFFIXES = new Set([".js", ".mjs", ".ts", ".tsx", ".py", ".rs", ".sh", ".ps1"]);
const REQUIRED = ["pattern", "category", "owner", "reason", "review", "target_format"];

export function parsePolicy(text) {
  const entries = [];
  let current;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    if (line === "[[paths]]") { if (current) entries.push(current); current = {}; continue; }
    if (!current || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    current[key.trim()] = rest.join("=").trim().replace(/^"|"$/g, "");
  }
  if (current) entries.push(current);
  return entries;
}

export function validateRegistry(entries, today = new Date()) {
  const errors = [];
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const label = entry.pattern || `entry ${index + 1}`;
    for (const key of REQUIRED) if (!entry[key]?.trim()) errors.push(`${label}: missing ${key}`);
    if (/[*?\[\]{}]/.test(entry.pattern ?? "") && entry.scope !== "directory") errors.push(`${label}: patterns must be exact paths unless scope = directory`);
    if (entry.scope !== undefined && entry.scope !== "directory") errors.push(`${label}: scope must be directory when present`);
    if (seen.has(entry.pattern)) errors.push(`${label}: duplicate path`);
    seen.add(entry.pattern);
    if (entry.review && !/^\d{4}-\d{2}-\d{2}$/.test(entry.review)) errors.push(`${label}: review must be YYYY-MM-DD`);
    else if (entry.review && new Date(`${entry.review}T23:59:59Z`) < today) errors.push(`${label}: exception expired on ${entry.review}`);
  }
  return errors;
}

function walk(dir, skip, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, skip, out); else out.push(path);
  }
  return out;
}

export function sourceUsesJson(text) {
  return /(^|\s)(import|from)\s+json\b|serde_json|JSON\.(parse|stringify)\s*\(|\.(jsonl|ndjson)\b/.test(text);
}

function policyEntryFor(path, entries) {
  const exact = entries.find((entry) => entry.pattern === path);
  if (exact) return exact;
  return entries.find((entry) => entry.scope === "directory" && entry.pattern?.endsWith("/**") && path.startsWith(entry.pattern.slice(0, -2)));
}

export function scanInternalFormats(options) {
  const root = resolve(options.root);
  const policyPath = options.policyPath ?? join(root, "config", "json-boundaries.toml");
  const entries = parsePolicy(readFileSync(policyPath, "utf8"));
  const registryErrors = validateRegistry(entries, options.today);
  const report = { mode: options.strict ? "strict" : "baseline", bounded: [], migration: [], unknown: [], registryErrors };
  const roots = [root, ...(options.extraRoots ?? []).map((item) => resolve(item))];
  const visited = new Set();
  for (const scanRoot of roots) for (const absolute of walk(scanRoot, DEFAULT_SKIP)) {
    const real = resolve(absolute); if (visited.has(real)) continue; visited.add(real);
    const path = scanRoot === root ? relative(root, absolute).replaceAll("\\", "/") : `@generated/${relative(scanRoot, absolute).replaceAll("\\", "/")}`;
    const suffix = extname(path).toLowerCase();
    const sourceUsage = SOURCE_SUFFIXES.has(suffix) && !new Set(["scripts/check-internal-formats.mjs", "lib/policy/internal-formats.mjs"]).has(path) && sourceUsesJson(readFileSync(absolute, "utf8"));
    if (!JSON_SUFFIXES.has(suffix) && !sourceUsage) continue;
    const entry = policyEntryFor(path, entries);
    const finding = { path, detail: sourceUsage ? "source JSON usage" : "JSON artifact", entry };
    if (!entry) report.unknown.push(finding);
    else if (INTERNAL.has(entry.category)) report.migration.push(finding);
    else report.bounded.push(finding);
  }
  return report;
}

export function renderReport(report) {
  const rows = (items) => items.length ? items.sort((a,b) => a.path.localeCompare(b.path)).map(x => `- ${x.path} (${x.entry?.category ?? x.detail})`).join("\n") : "- none";
  return [`# Simplicio internal-format policy`, ``, `Mode: ${report.mode}`, ``, `## Registry errors`, report.registryErrors.length ? report.registryErrors.map(x => `- ${x}`).join("\n") : "- none", ``, `## Allowed or explicitly bounded`, rows(report.bounded), ``, `## Migration required`, rows(report.migration), ``, `## Unclassified`, rows(report.unknown), ``].join("\n");
}

export function runPolicyCli(args, env = process.env) {
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const strict = args.includes("--strict") || env.SIMPLICIO_FORMAT_STRICT === "1";
  const report = scanInternalFormats({ root, strict });
  process.stdout.write(renderReport(report));
  if (report.registryErrors.length || report.unknown.length) return 1;
  if (strict && report.migration.length) return 2;
  return 0;
}
