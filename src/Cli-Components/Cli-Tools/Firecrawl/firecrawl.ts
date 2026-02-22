#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const FIRECRAWL_CONFIG_FILE = join(STORE_DIR, "firecrawl-config.json");
const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const SUPPORTED_FORMATS = ["markdown", "html", "rawHtml", "screenshot", "links", "json", "branding"] as const;

export type FirecrawlFormat = (typeof SUPPORTED_FORMATS)[number];

type JsonRecord = Record<string, unknown>;

export type FirecrawlConfig = {
  apiKey?: string;
  baseUrl: string;
  defaultFormats: FirecrawlFormat[];
  updatedAt: string;
};

export type FirecrawlRunIntent =
  | { kind: "status" }
  | { kind: "scrape"; url: string; formats?: string[] }
  | { kind: "search"; query: string; limit?: number }
  | { kind: "map"; url: string; search?: string }
  | { kind: "agent"; prompt: string; urls?: string[] }
  | { kind: "crawl"; url: string; limit?: number; formats?: string[] }
  | { kind: "crawl-status"; id: string };

export type FirecrawlCliIntent =
  | { type: "menu" }
  | { type: "set-key"; apiKey?: string }
  | { type: "clear-key" }
  | { type: "help"; reason?: string }
  | { type: "run"; intent: FirecrawlRunIntent };

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeFormats(value: unknown): FirecrawlFormat[] {
  if (!Array.isArray(value)) {
    return ["markdown"];
  }

  const set = new Set<FirecrawlFormat>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    const found = SUPPORTED_FORMATS.find((format) => format.toLowerCase() === normalized.toLowerCase());
    if (!found) {
      continue;
    }
    set.add(found);
  }

  return set.size ? Array.from(set) : ["markdown"];
}

function normalizeConfig(value: unknown): FirecrawlConfig {
  const fallback: FirecrawlConfig = {
    apiKey: undefined,
    baseUrl: DEFAULT_FIRECRAWL_BASE_URL,
    defaultFormats: ["markdown"],
    updatedAt: nowIso(),
  };

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const row = value as Partial<FirecrawlConfig>;
  const baseUrl = typeof row.baseUrl === "string" && row.baseUrl.trim() ? row.baseUrl.trim() : fallback.baseUrl;
  const apiKey = typeof row.apiKey === "string" && row.apiKey.trim() ? row.apiKey.trim() : undefined;
  const updatedAt = typeof row.updatedAt === "string" && row.updatedAt.trim() ? row.updatedAt : fallback.updatedAt;

  return {
    apiKey,
    baseUrl,
    defaultFormats: sanitizeFormats(row.defaultFormats),
    updatedAt,
  };
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function loadFirecrawlConfig(): Promise<FirecrawlConfig> {
  const fs = await import("node:fs/promises");
  try {
    const raw = await fs.readFile(FIRECRAWL_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeConfig(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveFirecrawlConfig(normalized);
    }
    return normalized;
  } catch {
    const fallback = normalizeConfig(undefined);
    await saveFirecrawlConfig(fallback);
    return fallback;
  }
}

export async function saveFirecrawlConfig(config: FirecrawlConfig): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  const normalized = normalizeConfig(config);
  await fs.writeFile(FIRECRAWL_CONFIG_FILE, JSON.stringify(normalized, null, 2), "utf-8");
}

export async function setFirecrawlApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("Firecrawl API key is empty.");
  }
  const current = await loadFirecrawlConfig();
  await saveFirecrawlConfig({
    ...current,
    apiKey: trimmed,
    updatedAt: nowIso(),
  });
}

export async function clearFirecrawlApiKey(): Promise<void> {
  const current = await loadFirecrawlConfig();
  await saveFirecrawlConfig({
    ...current,
    apiKey: undefined,
    updatedAt: nowIso(),
  });
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampLine(value: string, maxChars = 160): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function sanitizePreview(value: string, maxChars = 700): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function maskFirecrawlApiKey(key: string | undefined): string {
  if (!key) return "not-set";
  if (key.length <= 8) return `${key.slice(0, 2)}***`;
  return `${key.slice(0, 5)}...${key.slice(-4)}`;
}

export async function getFirecrawlStatusSummary(): Promise<string> {
  const config = await loadFirecrawlConfig();
  return [
    `Firecrawl: ${config.apiKey ? "configured" : "not configured"}`,
    `Base URL: ${config.baseUrl}`,
    `API Key: ${maskFirecrawlApiKey(config.apiKey)}`,
    `Default formats: ${config.defaultFormats.join(", ")}`,
  ].join("\n");
}

function ensureConfigured(config: FirecrawlConfig): void {
  if (!config.apiKey) {
    throw new Error("Firecrawl API key not set. Use /firecrawl set-key or /connect -> Tools -> Firecrawl.");
  }
}

async function firecrawlHttp(
  method: "GET" | "POST",
  path: string,
  body?: JsonRecord,
): Promise<JsonRecord> {
  const config = await loadFirecrawlConfig();
  ensureConfigured(config);

  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const record = asRecord(parsed);
    const apiMessage = asString(record?.message) || asString(record?.error);
    throw new Error(apiMessage || text || `${response.status} ${response.statusText}`);
  }

  const record = asRecord(parsed);
  if (!record) {
    throw new Error("Firecrawl API returned invalid JSON.");
  }
  return record;
}

export async function firecrawlScrape(url: string, formats?: string[]): Promise<JsonRecord> {
  return await firecrawlHttp("POST", "/v2/scrape", {
    url,
    formats: sanitizeFormats(formats),
  });
}

export async function firecrawlSearch(query: string, limit = 5): Promise<JsonRecord> {
  return await firecrawlHttp("POST", "/v2/search", {
    query,
    limit: Math.max(1, Math.min(20, Math.floor(limit))),
  });
}

export async function firecrawlMap(url: string, search?: string): Promise<JsonRecord> {
  const body: JsonRecord = { url };
  if (search && search.trim()) {
    body.search = search.trim();
  }
  return await firecrawlHttp("POST", "/v2/map", body);
}

export async function firecrawlAgent(prompt: string, urls?: string[]): Promise<JsonRecord> {
  const body: JsonRecord = { prompt };
  if (Array.isArray(urls) && urls.length) {
    body.urls = urls;
  }
  return await firecrawlHttp("POST", "/v2/agent", body);
}

export async function firecrawlCrawl(url: string, limit = 100, formats?: string[]): Promise<JsonRecord> {
  return await firecrawlHttp("POST", "/v2/crawl", {
    url,
    limit: Math.max(1, Math.min(1000, Math.floor(limit))),
    scrapeOptions: {
      formats: sanitizeFormats(formats),
    },
  });
}

export async function firecrawlCrawlStatus(id: string): Promise<JsonRecord> {
  const safeId = encodeURIComponent(id.trim());
  return await firecrawlHttp("GET", `/v2/crawl/${safeId}`);
}

function firstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0] || null;
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pickTokenAfter(words: string[], key: string): string | null {
  const idx = words.indexOf(key);
  if (idx === -1) return null;
  return idx + 1 < words.length ? words[idx + 1] : null;
}

function removePrefixes(value: string, prefixes: string[]): string {
  let output = value;
  for (const prefix of prefixes) {
    const regex = new RegExp(`^${prefix}\\s*`, "i");
    output = output.replace(regex, "");
  }
  return output.trim();
}

export function resolveFirecrawlCliIntent(command: string): FirecrawlCliIntent | null {
  const trimmed = command.trim();
  if (!trimmed.toLowerCase().startsWith("/firecrawl")) {
    return null;
  }

  const rest = trimmed.slice("/firecrawl".length).trim();
  if (!rest) {
    return { type: "menu" };
  }

  const words = rest.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  const action = words[0]?.toLowerCase();
  const payload = rest.slice(words[0]?.length || 0).trim();

  if (action === "help") {
    return { type: "help" };
  }
  if (action === "setup" || action === "config" || action === "set-key" || action === "key") {
    const keyValue = normalizeQuery(payload).replace(/^(set-key|key)\s+/i, "").trim();
    return { type: "set-key", apiKey: keyValue || undefined };
  }
  if (action === "clear-key") {
    return { type: "clear-key" };
  }
  if (action === "status") {
    return { type: "run", intent: { kind: "status" } };
  }

  if (action === "scrape") {
    const url = firstUrl(payload);
    if (!url) {
      return { type: "help", reason: "scrape command requires a URL." };
    }
    return { type: "run", intent: { kind: "scrape", url } };
  }

  if (action === "search") {
    const query = normalizeQuery(payload);
    if (!query) {
      return { type: "help", reason: "search command requires a query." };
    }
    return { type: "run", intent: { kind: "search", query } };
  }

  if (action === "map") {
    const url = firstUrl(payload);
    if (!url) {
      return { type: "help", reason: "map command requires a URL." };
    }
    return { type: "run", intent: { kind: "map", url } };
  }

  if (action === "agent") {
    const prompt = normalizeQuery(payload);
    if (!prompt) {
      return { type: "help", reason: "agent command requires a prompt." };
    }
    return { type: "run", intent: { kind: "agent", prompt } };
  }

  if (action === "crawl") {
    const url = firstUrl(payload);
    if (!url) {
      return { type: "help", reason: "crawl command requires a URL." };
    }
    const limitToken = pickTokenAfter(words.map((word) => word.toLowerCase()), "--limit");
    const limitParsed = limitToken ? Number.parseInt(limitToken, 10) : NaN;
    const limit = Number.isFinite(limitParsed) ? limitParsed : 100;
    return { type: "run", intent: { kind: "crawl", url, limit } };
  }

  if (action === "crawl-status") {
    const id = normalizeQuery(payload);
    if (!id) {
      return { type: "help", reason: "crawl-status command requires a job ID." };
    }
    return { type: "run", intent: { kind: "crawl-status", id } };
  }

  return { type: "help", reason: `Unknown firecrawl command: ${action}` };
}

export function resolveFirecrawlNaturalIntent(message: string): FirecrawlRunIntent | null {
  const lower = message.toLowerCase();
  if (!lower.includes("firecrawl")) {
    return null;
  }

  const url = firstUrl(message);
  if (url) {
    if (/\bmap\b/.test(lower)) {
      return { kind: "map", url };
    }
    if (/\bcrawl\b/.test(lower)) {
      return { kind: "crawl", url, limit: 100 };
    }
    if (/\bstatus\b/.test(lower) && /crawl/.test(lower)) {
      const idMatch = message.match(/\bcrawl[-\s]?status\s+([a-z0-9-]{5,})/i);
      if (idMatch?.[1]) {
        return { kind: "crawl-status", id: idMatch[1] };
      }
    }
    return { kind: "scrape", url };
  }

  if (/\bsearch\b/.test(lower)) {
    const query = removePrefixes(message, ["firecrawl", "search"]);
    if (query) {
      return { kind: "search", query, limit: 5 };
    }
  }

  if (/\bagent\b/.test(lower) || /\bfind\b/.test(lower)) {
    const prompt = removePrefixes(message, ["firecrawl", "agent"]);
    if (prompt) {
      return { kind: "agent", prompt };
    }
  }

  if (/\bstatus\b/.test(lower)) {
    return { kind: "status" };
  }

  return null;
}

export function buildFirecrawlUsage(): string {
  return [
    "Firecrawl command usage:",
    "/firecrawl",
    "/firecrawl status",
    "/firecrawl set-key <fc-api-key>",
    "/firecrawl clear-key",
    "/firecrawl scrape <url>",
    "/firecrawl search <query>",
    "/firecrawl map <url>",
    "/firecrawl agent <prompt>",
    "/firecrawl crawl <url> [--limit 100]",
    "/firecrawl crawl-status <job-id>",
  ].join("\n");
}

export async function executeFirecrawlRunIntent(intent: FirecrawlRunIntent): Promise<string> {
  if (intent.kind === "status") {
    return await getFirecrawlStatusSummary();
  }

  if (intent.kind === "scrape") {
    const result = await firecrawlScrape(intent.url, intent.formats);
    const data = asRecord(result.data);
    const metadata = asRecord(data?.metadata);
    const title = asString(metadata?.title) || "(unknown)";
    const sourceUrl = asString(metadata?.sourceURL) || intent.url;
    const statusCode = asNumber(metadata?.statusCode);
    const markdown = asString(data?.markdown);
    const preview = markdown ? sanitizePreview(markdown, 900) : sanitizePreview(JSON.stringify(data || {}, null, 2), 900);

    return [
      "Firecrawl scrape completed.",
      `URL: ${sourceUrl}`,
      `Title: ${title}`,
      `Status: ${statusCode ?? "unknown"}`,
      "",
      "Preview:",
      preview || "(empty)",
    ].join("\n");
  }

  if (intent.kind === "search") {
    const result = await firecrawlSearch(intent.query, intent.limit ?? 5);
    const data = asRecord(result.data);
    const web = Array.isArray(data?.web) ? data.web : [];
    const rows = web
      .slice(0, 8)
      .map((item, index) => {
        const row = asRecord(item);
        const title = asString(row?.title) || "(no title)";
        const url = asString(row?.url) || "(no url)";
        const desc = asString(row?.description) || "";
        const position = asNumber(row?.position) || index + 1;
        return `${position}. ${clampLine(title, 120)}\n   ${url}\n   ${clampLine(desc, 140)}`;
      })
      .join("\n");

    return [
      `Firecrawl search completed for: ${intent.query}`,
      web.length ? `Results: ${web.length}` : "Results: 0",
      "",
      rows || "(No results)",
    ].join("\n");
  }

  if (intent.kind === "map") {
    const result = await firecrawlMap(intent.url, intent.search);
    const links = Array.isArray(result.links) ? result.links : [];
    const lines = links.slice(0, 20).map((item, index) => {
      const row = asRecord(item);
      if (!row) {
        return `${index + 1}. ${String(item)}`;
      }
      const url = asString(row.url) || "(no url)";
      const title = asString(row.title) || "";
      return `${index + 1}. ${url}${title ? ` | ${clampLine(title, 80)}` : ""}`;
    });

    return [
      `Firecrawl map completed: ${intent.url}`,
      `Links found: ${links.length}`,
      "",
      lines.join("\n") || "(No links)",
    ].join("\n");
  }

  if (intent.kind === "agent") {
    const result = await firecrawlAgent(intent.prompt, intent.urls);
    const data = asRecord(result.data);
    const answer = asString(data?.result) || "(empty result)";
    const sources = Array.isArray(data?.sources) ? data.sources : [];
    const sourceLines = sources
      .slice(0, 10)
      .map((item) => `- ${String(item)}`)
      .join("\n");

    return [
      "Firecrawl agent completed.",
      "",
      sanitizePreview(answer, 1400),
      "",
      "Sources:",
      sourceLines || "- (none)",
    ].join("\n");
  }

  if (intent.kind === "crawl") {
    const result = await firecrawlCrawl(intent.url, intent.limit ?? 100, intent.formats);
    const id = asString(result.id) || "(unknown)";
    const pollUrl = asString(result.url) || "(none)";
    return [
      "Firecrawl crawl job created.",
      `Job ID: ${id}`,
      `Status URL: ${pollUrl}`,
      "Use: /firecrawl crawl-status <job-id>",
    ].join("\n");
  }

  const result = await firecrawlCrawlStatus(intent.id);
  const status = asString(result.status) || "unknown";
  const total = asNumber(result.total);
  const completed = asNumber(result.completed);
  const creditsUsed = asNumber(result.creditsUsed);
  const data = Array.isArray(result.data) ? result.data : [];
  const sample = data.length ? asRecord(data[0]) : null;
  const sampleMeta = asRecord(sample?.metadata);
  const sampleUrl = asString(sampleMeta?.sourceURL);

  return [
    "Firecrawl crawl status:",
    `Job ID: ${intent.id}`,
    `Status: ${status}`,
    `Completed: ${completed ?? 0}/${total ?? 0}`,
    `Credits used: ${creditsUsed ?? 0}`,
    sampleUrl ? `Sample URL: ${sampleUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
