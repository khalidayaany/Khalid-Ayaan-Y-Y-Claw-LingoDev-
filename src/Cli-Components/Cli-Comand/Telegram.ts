#!/usr/bin/env bun

import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildAiRouteCandidates, type AiRouteCandidate } from "./Ai.js";
import { buildMessageWithMemoryContext, saveChatTurn } from "./memory.js";
import {
  extractCommandIntent,
  extractFileSystemIntent,
  runFileSystemIntent,
  runShellCommand,
} from "../Cli-Shell/index.js";
import {
  clearTelegramChatState,
  createTelegramVerificationCode,
  deleteTelegramConfig,
  getTelegramChatState,
  isTelegramAuthenticated,
  loadTelegramConfig,
  pollTelegramVerificationCode,
  saveTelegramAuth,
  setTelegramChatState,
  splitTelegramMessage,
  telegramDeleteMessage,
  telegramEditMessage,
  telegramGetUpdates,
  telegramSendMessage,
  telegramSendTyping,
  updateTelegramLastUpdateId,
  verifyTelegramBotToken,
  type TelegramPhotoSize,
  type TelegramProviderId,
  type TelegramUpdate,
} from "../Cli-Extenshone/Telegram/telegram.js";
import {
  getQwenModels,
  loadQwenConfig,
  loadQwenToken,
  resolveQwenBaseUrl,
  saveCurrentModel,
} from "../Cli-Extenshone/Qwen/qwen.js";
import {
  getMiniMaxModels,
  loadMiniMaxConfig,
  loadMiniMaxToken,
  resolveMiniMaxBaseUrl,
  saveCurrentMiniMaxModel,
} from "../Cli-Extenshone/Minimax/minimax.js";
import {
  getCodexModels,
  loadCodexConfig,
  loadCodexToken,
  saveCurrentCodexModel,
} from "../Cli-Extenshone/Codex/codex.js";
import {
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_PROD,
  getAntigravityModels,
  loadAntigravityConfig,
  loadAntigravityToken,
  normalizeAntigravityModelId,
  resolveAntigravityBaseUrl,
  saveCurrentAntigravityModel,
} from "../Cli-Extenshone/Antigravity/antigravity.js";
import {
  getOpenRouterModels,
  loadOpenRouterConfig,
  loadOpenRouterToken,
  resolveOpenRouterBaseUrl,
  saveCurrentOpenRouterModel,
} from "../Cli-Extenshone/Openrouter/openrouter.js";
import {
  getKiloModels,
  loadKiloConfig,
  loadKiloToken,
  resolveKiloBaseUrl,
  saveCurrentKiloModel,
} from "../Cli-Extenshone/Kilo/kilo.js";
import { analyzeTelegramPhoto } from "../Cli-Tools/Photo/photo.js";
import { decodeTelegramVideo } from "../Cli-Tools/Video/video.js";
import { transcribeTelegramVoice } from "../Cli-Tools/Voise/voise.js";
import { simplifyChatAnswer } from "../Cli-Agent/chat-simplifier.js";

const orange = "\x1b[38;2;249;115;22m";
const cyan = "\x1b[38;2;34;211;238m";
const green = "\x1b[38;2;34;197;94m";
const yellow = "\x1b[38;2;251;191;36m";
const red = "\x1b[38;2;239;68;68m";
const white = "\x1b[38;2;229;231;235m";
const gray = "\x1b[90m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding." +
  "You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question." +
  "**Absolute paths only**" +
  "**Proactiveness**";
const CODEX_MCP_DISABLE_OVERRIDES = [
  "-c",
  "mcp_servers.supabase-2.enabled=false",
];

type MenuItem<T extends string | number> = {
  key: T;
  label: string;
  description: string;
};

type ProviderSlashCommand = {
  provider: TelegramProviderId;
  modelId?: string;
  prompt: string;
};

type ResolvedProviderRequest = {
  provider?: TelegramProviderId;
  modelId?: string;
  prompt: string;
  providerOnly: boolean;
  explicitProvider: boolean;
  explicitModel: boolean;
};

type TelegramAgentStartResult = {
  running: boolean;
  started: boolean;
  reason?: string;
};

type TelegramLiveRun = {
  id: string;
  chatId: number;
  prompt: string;
  actor: string;
  status: string;
  detail: string;
  createdAt: number;
  updatedAt: number;
  completed: boolean;
  error?: string;
  resultPreview?: string;
  events: Array<{ at: number; text: string }>;
};

let telegramAgentRunning = false;
let telegramAgentStopRequested = false;
let telegramAgentLoopPromise: Promise<void> | null = null;
const telegramLiveRuns = new Map<string, TelegramLiveRun>();
const telegramLastRunByChat = new Map<number, string>();
let telegramLiveServer:
  | {
      port: number;
      close: () => void;
    }
  | null = null;
const TELEGRAM_CHAT_MEMORY_DIR = join(homedir(), ".hakathone", "store", "telegram-chat-memory");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function tailChars(value: string, maxChars: number): string {
  if (!value || value.length <= maxChars) return value;
  return value.slice(value.length - maxChars);
}

function telegramChatMemoryFile(chatId: number): string {
  return join(TELEGRAM_CHAT_MEMORY_DIR, `${chatId}.md`);
}

async function ensureTelegramChatMemoryDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(TELEGRAM_CHAT_MEMORY_DIR, { recursive: true });
}

async function appendTelegramChatMemory(params: {
  chatId: number;
  userMessage: string;
  assistantMessage: string;
  provider: string;
  model: string;
}): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureTelegramChatMemoryDir();
  const filePath = telegramChatMemoryFile(params.chatId);
  const timestamp = nowIso();
  const entry = [
    "",
    `### User @ ${timestamp}`,
    (params.userMessage || "").trim() || "(empty user message)",
    "",
    `### ${params.model} (${params.provider}) @ ${timestamp}`,
    (params.assistantMessage || "").trim() || "(empty assistant message)",
    "",
  ].join("\n");
  await fs.appendFile(filePath, entry, "utf-8");

  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 900_000) {
      const content = await fs.readFile(filePath, "utf-8");
      await fs.writeFile(filePath, tailChars(content, 600_000), "utf-8");
    }
  } catch {
    // ignore memory compaction failures
  }
}

async function buildTelegramChatContinuityPrompt(chatId: number, prompt: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const filePath = telegramChatMemoryFile(chatId);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const historyTail = tailChars(content, 7200).trim();
    if (!historyTail) return prompt;
    return [
      "Use previous context from this same Telegram chat when relevant.",
      "",
      "## Telegram Chat History",
      historyTail,
      "",
      "## Current User Message",
      prompt,
    ].join("\n");
  } catch {
    return prompt;
  }
}

function formatProviderName(provider: TelegramProviderId): string {
  if (provider === "qwen") return "Qwen";
  if (provider === "minimax") return "MiniMax";
  if (provider === "codex") return "Codex";
  if (provider === "antigravity") return "Antigravity";
  if (provider === "kilo") return "Kilo";
  return "OpenRouter";
}

function getModelLabel(candidate: AiRouteCandidate): string {
  return candidate.model.name || candidate.model.id;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function trimForPreview(value: string, max = 900): string {
  const compact = (value || "").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3)}...`;
}

function getLiveServerPort(): number {
  const parsed = Number.parseInt(process.env.KHALID_TELEGRAM_LIVE_PORT || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 4173;
}

function getLiveLocalBaseUrl(port: number): string {
  const raw = (process.env.KHALID_TELEGRAM_LIVE_LOCAL_BASE_URL || "").trim();
  const normalized = raw.replace(/\/+$/, "");
  if (normalized) {
    return normalized;
  }
  return `http://127.0.0.1:${port}`;
}

function getLivePublicBaseUrl(): string | null {
  const raw = (process.env.KHALID_TELEGRAM_LIVE_PUBLIC_BASE_URL || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getLiveLanBaseUrls(port: number): string[] {
  const nets = networkInterfaces();
  const urls = new Set<string>();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== "IPv4") continue;
      urls.add(`http://${entry.address}:${port}`);
    }
  }
  return Array.from(urls);
}

function buildLiveRunLinks(runId: string, port: number): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  const publicBase = getLivePublicBaseUrl();
  if (publicBase) {
    links.push({ label: "Public", url: `${publicBase}/telegram/live/${runId}` });
  }

  const localBase = getLiveLocalBaseUrl(port);
  links.push({ label: "Local", url: `${localBase}/telegram/live/${runId}` });

  for (const lanBase of getLiveLanBaseUrls(port).slice(0, 3)) {
    links.push({ label: "LAN", url: `${lanBase}/telegram/live/${runId}` });
  }

  const deduped: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  for (const item of links) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    deduped.push(item);
  }
  return deduped;
}

function buildLiveRunLink(runId: string, port: number): string {
  const links = buildLiveRunLinks(runId, port);
  return links[0]?.url || `${getLiveLocalBaseUrl(port)}/telegram/live/${runId}`;
}

function buildLiveRunHtml(run: TelegramLiveRun, link: string): string {
  const rows = run.events
    .slice(-50)
    .reverse()
    .map((event) => {
      const at = new Date(event.at).toLocaleTimeString();
      return `<li><span class="at">${escapeHtml(at)}</span><span class="tx">${escapeHtml(event.text)}</span></li>`;
    })
    .join("");
  const badge = run.completed ? (run.error ? "failed" : "completed") : "running";
  const result = run.resultPreview ? `<section><h3>Result</h3><p>${escapeHtml(run.resultPreview)}</p></section>` : "";
  const err = run.error ? `<section><h3>Error</h3><p>${escapeHtml(run.error)}</p></section>` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Khalid Telegram Live</title>
<style>
body{font-family:ui-sans-serif,system-ui,Segoe UI,Arial;margin:0;background:#0b1220;color:#dbe7ff}
.wrap{max-width:920px;margin:0 auto;padding:20px}
.top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}
.badge{padding:4px 10px;border-radius:999px;font-size:12px;text-transform:uppercase}
.running{background:#1f3f7a;color:#a7c5ff}.completed{background:#245d2a;color:#a8f5b1}.failed{background:#7d2525;color:#ffb4b4}
section{background:#111b31;border:1px solid #223457;border-radius:12px;padding:14px;margin-top:12px}
h1,h3{margin:0 0 10px 0}.meta{opacity:.85;font-size:14px}.link{color:#9cc2ff}
ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
li{display:grid;grid-template-columns:90px 1fr;gap:10px;background:#0c162b;border:1px solid #1e3154;border-radius:8px;padding:8px}
.at{opacity:.7}.tx{white-space:pre-wrap;word-break:break-word}
</style>
</head><body><div class="wrap">
<div class="top"><h1>Telegram Live Run</h1><span class="badge ${badge}">${badge}</span></div>
<div class="meta">Run ID: ${escapeHtml(run.id)} | Chat: ${run.chatId}</div>
<div class="meta">Updated: ${escapeHtml(new Date(run.updatedAt).toLocaleString())}</div>
<div class="meta">Link: <a class="link" href="${escapeHtml(link)}">${escapeHtml(link)}</a></div>
<section><h3>Prompt</h3><p>${escapeHtml(run.prompt)}</p></section>
<section><h3>Status</h3><p>${escapeHtml(run.status)}</p><p>${escapeHtml(run.detail || "-")}</p></section>
${result}${err}
<section><h3>Events</h3><ul>${rows || "<li><span class='tx'>No events yet</span></li>"}</ul></section>
</div></body></html>`;
}

async function ensureTelegramLiveServer(): Promise<number> {
  if (telegramLiveServer) {
    return telegramLiveServer.port;
  }

  const port = getLiveServerPort();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";
    if (url === "/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, runs: telegramLiveRuns.size }));
      return;
    }

    const matchJson = url.match(/^\/telegram\/live\/([a-zA-Z0-9-]+)\.json$/);
    if (matchJson) {
      const run = telegramLiveRuns.get(matchJson[1]);
      if (!run) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ...run,
          link: buildLiveRunLink(run.id, port),
        }),
      );
      return;
    }

    const match = url.match(/^\/telegram\/live\/([a-zA-Z0-9-]+)$/);
    if (match) {
      const run = telegramLiveRuns.get(match[1]);
      if (!run) {
        res.statusCode = 404;
        res.end("Run not found");
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(buildLiveRunHtml(run, buildLiveRunLink(run.id, port)));
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  telegramLiveServer = {
    port,
    close: () => {
      server.close();
      telegramLiveServer = null;
    },
  };
  return port;
}

function createLiveRun(chatId: number, prompt: string, actor: string): TelegramLiveRun {
  const now = Date.now();
  // Keep memory bounded for long-running bot sessions.
  for (const [id, existing] of telegramLiveRuns) {
    if (telegramLiveRuns.size <= 120) break;
    if (existing.completed && now - existing.updatedAt > 2 * 60 * 60 * 1000) {
      telegramLiveRuns.delete(id);
    }
  }

  const run: TelegramLiveRun = {
    id: randomUUID(),
    chatId,
    prompt: trimForPreview(prompt, 1800),
    actor,
    status: "preparing request",
    detail: "",
    createdAt: now,
    updatedAt: now,
    completed: false,
    events: [],
  };
  telegramLiveRuns.set(run.id, run);
  telegramLastRunByChat.set(chatId, run.id);
  return run;
}

function appendLiveRunEvent(runId: string, text: string): void {
  const run = telegramLiveRuns.get(runId);
  if (!run) return;
  const normalized = trimForPreview(text, 300);
  if (!normalized) return;
  run.updatedAt = Date.now();
  run.events.push({ at: run.updatedAt, text: normalized });
  if (run.events.length > 300) {
    run.events.splice(0, run.events.length - 300);
  }
}

function updateLiveRunStatus(runId: string, status: string, detail = ""): void {
  const run = telegramLiveRuns.get(runId);
  if (!run) return;
  run.status = trimForPreview(status, 180);
  run.detail = trimForPreview(detail, 260);
  run.updatedAt = Date.now();
  appendLiveRunEvent(runId, `${run.status}${run.detail ? ` | ${run.detail}` : ""}`);
}

function completeLiveRun(runId: string, resultPreview: string): void {
  const run = telegramLiveRuns.get(runId);
  if (!run) return;
  run.completed = true;
  run.resultPreview = trimForPreview(resultPreview, 2000);
  run.updatedAt = Date.now();
  appendLiveRunEvent(runId, "completed");
}

function failLiveRun(runId: string, error: string): void {
  const run = telegramLiveRuns.get(runId);
  if (!run) return;
  run.completed = true;
  run.error = trimForPreview(error, 1600);
  run.updatedAt = Date.now();
  appendLiveRunEvent(runId, `failed | ${run.error}`);
}

function withTelegramStylePrompt(message: string): string {
  return [
    message,
    "",
    "Response style:",
    "- Plain text only",
    "- Keep answer concise and direct",
    "- No markdown headers",
  ].join("\n");
}

function withTelegramExecutionPolicy(message: string): string {
  return [
    message,
    "",
    "Execution policy:",
    "- Execute the task directly using terminal/filesystem when needed.",
    "- Do not only generate plan markdown unless user explicitly asks for plan files.",
    "- If you claim file/folder created or changed, it must be actually done in this run.",
    "- Return concise final output with absolute file paths and verification evidence.",
    "- Avoid unrelated files, avoid unnecessary analysis, avoid extra downloads.",
    "- Never run destructive commands (rm -rf /, mkfs, dd wipe, shutdown/reboot, curl|bash).",
  ].join("\n");
}

function isHarmfulCommand(command: string): boolean {
  const lower = command.toLowerCase();
  const patterns: RegExp[] = [
    /\brm\s+-rf\s+\/\b/,
    /\brm\s+-rf\s+--no-preserve-root\b/,
    /\bmkfs(\.\w+)?\b/,
    /\bwipefs\b/,
    /\bdd\s+if=/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bpoweroff\b/,
    /\bcurl\b.*\|\s*(bash|sh)\b/,
    /\bwget\b.*\|\s*(bash|sh)\b/,
  ];
  return patterns.some((pattern) => pattern.test(lower));
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.floor(ms))}ms`;
  const sec = Math.floor(ms / 1000);
  const rem = ms % 1000;
  return `${sec}.${Math.floor(rem / 100)}s`;
}

function isTelegramExecutionPrompt(input: string): boolean {
  const message = input.trim();
  if (!message) return false;
  const lower = message.toLowerCase();

  if (extractFileSystemIntent(message)) return true;
  const commandIntent = extractCommandIntent(message);
  if (commandIntent?.explicit) return true;

  if (/^\/(?:executor|browser|browser-live|cmd|run|shell|fs)\b/.test(lower)) return true;
  if (/(\/home\/|~\/|\.\.\/|\.\/)/.test(lower)) return true;

  const action = /(create|make|build|write|save|fix|setup|install|develop|compile|run|execute|koro|kor|banaw|toiri|check|chek)/.test(
    lower,
  );
  const target = /(file|folder|directory|project|app|application|website|repo|repository|code|system|task|bug|feature|module)/.test(
    lower,
  );
  return action && target;
}

function normalizeUsageText(message: string): string {
  return simplifyChatAnswer(message || "No response.", { keepLineBreaks: true });
}

function getAntigravityHeaders(): Record<string, string> {
  const version = process.env.PI_AI_ANTIGRAVITY_VERSION || "1.15.8";
  return {
    "User-Agent": `antigravity/${version} darwin/arm64`,
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };
}

function parseAntigravitySseText(rawSse: string): string {
  let output = "";
  const lines = rawSse.split("\n");

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let chunk: any;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }

    const parts = chunk?.response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.length > 0) {
        output += part.text;
      }
    }
  }

  return output.trim();
}

function parseProviderSlashCommand(input: string): ProviderSlashCommand | null {
  const trimmed = input.trim();
  const matched = trimmed.match(/^\/(qwen|minimax|codex|antigravity|openrouter|kilo)\b(.*)$/i);
  if (!matched) return null;

  const provider = matched[1].toLowerCase() as TelegramProviderId;
  let rest = (matched[2] || "").trim();
  let modelId: string | undefined;
  let prompt = "";

  const modelInline = rest.match(/^model=([^\s]+)\s*(.*)$/i);
  if (modelInline) {
    modelId = modelInline[1].trim();
    prompt = (modelInline[2] || "").trim();
    return { provider, modelId, prompt };
  }

  const separatorIndex = rest.indexOf("::");
  if (separatorIndex >= 0) {
    const before = rest.slice(0, separatorIndex).trim();
    const after = rest.slice(separatorIndex + 2).trim();
    if (before && !/\s/.test(before)) {
      modelId = before;
      prompt = after;
      return { provider, modelId, prompt };
    }
  }

  prompt = rest;
  return { provider, prompt };
}

function normalizeProviderName(raw: string): TelegramProviderId | null {
  const key = raw.trim().toLowerCase();
  if (key === "qwen") return "qwen";
  if (key === "minimax") return "minimax";
  if (key === "codex") return "codex";
  if (key === "antigravity") return "antigravity";
  if (key === "openrouter") return "openrouter";
  if (key === "kilo") return "kilo";
  return null;
}

function parseNaturalProviderCommand(input: string): ProviderSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    return null;
  }

  const direct = trimmed.match(
    /^\s*(qwen|minimax|codex|antigravity|openrouter|kilo)\b(?:\s+ke)?(?:\s+(?:use|us|with|diye|dia|koro|kor|please))*\s*(.*)$/i,
  );
  if (direct) {
    const provider = normalizeProviderName(direct[1]);
    if (!provider) return null;
    const prompt = (direct[2] || "").trim();
    return { provider, prompt };
  }

  const inline = trimmed.match(/\b(?:use|us|with)\s+(qwen|minimax|codex|antigravity|openrouter|kilo)\b/i);
  if (inline) {
    const provider = normalizeProviderName(inline[1]);
    if (!provider) return null;
    const prompt = trimmed.replace(inline[0], "").trim();
    return { provider, prompt };
  }

  return null;
}

function parseProviderModelPrefix(input: string): ProviderSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    return null;
  }

  const slashPrefix = trimmed.match(
    /^(qwen|minimax|codex|antigravity|openrouter|kilo)\s*\/\s*([^\s]+)\s*(.*)$/i,
  );
  if (slashPrefix) {
    const provider = normalizeProviderName(slashPrefix[1]);
    if (!provider) return null;
    return {
      provider,
      modelId: slashPrefix[2].trim(),
      prompt: (slashPrefix[3] || "").trim(),
    };
  }

  const verbosePrefix = trimmed.match(
    /^(qwen|minimax|codex|antigravity|openrouter|kilo)\s*:\s*([^>]+?)\s*>\s*(.*)$/i,
  );
  if (verbosePrefix) {
    const provider = normalizeProviderName(verbosePrefix[1]);
    if (!provider) return null;
    return {
      provider,
      modelId: verbosePrefix[2].trim(),
      prompt: (verbosePrefix[3] || "").trim(),
    };
  }

  const keyValue = trimmed.match(
    /^provider=(qwen|minimax|codex|antigravity|openrouter|kilo)\s+model=([^\s]+)\s*(.*)$/i,
  );
  if (keyValue) {
    const provider = normalizeProviderName(keyValue[1]);
    if (!provider) return null;
    return {
      provider,
      modelId: keyValue[2].trim(),
      prompt: (keyValue[3] || "").trim(),
    };
  }

  return null;
}

function resolveProviderRequestFromInput(
  input: string,
  chatState: { provider?: TelegramProviderId; modelId?: string },
): ResolvedProviderRequest {
  const request =
    parseProviderSlashCommand(input) ||
    parseProviderModelPrefix(input) ||
    parseNaturalProviderCommand(input);
  if (request) {
    const modelId =
      request.modelId ||
      (chatState.provider === request.provider ? chatState.modelId : undefined);
    return {
      provider: request.provider,
      modelId,
      prompt: request.prompt.trim(),
      providerOnly: !request.prompt.trim(),
      explicitProvider: true,
      explicitModel: Boolean(request.modelId),
    };
  }

  return {
    provider: chatState.provider,
    modelId: chatState.modelId,
    prompt: input.trim(),
    providerOnly: false,
    explicitProvider: false,
    explicitModel: false,
  };
}

function pickBestPhotoFileId(photo?: TelegramPhotoSize[]): string | undefined {
  if (!Array.isArray(photo) || !photo.length) {
    return undefined;
  }
  const sorted = [...photo].sort((a, b) => {
    const aSize = Number(a.file_size || 0);
    const bSize = Number(b.file_size || 0);
    if (aSize !== bSize) return bSize - aSize;
    const aPixels = Number(a.width || 0) * Number(a.height || 0);
    const bPixels = Number(b.width || 0) * Number(b.height || 0);
    return bPixels - aPixels;
  });
  return sorted[0]?.file_id;
}

function looksLikeSystemCommand(input: string): boolean {
  const lower = input.trim().toLowerCase();
  return [
    "/start",
    "/help",
    "/providers",
    "/live",
    "/clear",
    "/back",
  ].some((prefix) => lower.startsWith(prefix));
}

function findByModelId<T extends { id: string; name: string }>(
  models: T[],
  requestedId?: string,
): T | undefined {
  if (!requestedId) return undefined;
  const normalized = requestedId.trim().toLowerCase();
  if (!normalized) return undefined;
  return models.find(
    (model) =>
      model.id.toLowerCase() === normalized ||
      model.name.toLowerCase() === normalized ||
      `${model.name}`.toLowerCase().includes(normalized),
  );
}

function isVisionPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return ["image", "photo", "picture", "vision", "screenshot"].some((key) =>
    lower.includes(key),
  );
}

function isCodingPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return [
    "code",
    "bug",
    "fix",
    "refactor",
    "typescript",
    "javascript",
    "python",
    "api",
    "cli",
    "build",
  ].some((key) => lower.includes(key));
}

function pickAutoQwenModelLocal(models: Awaited<ReturnType<typeof getQwenModels>>, prompt: string) {
  const lowerPrompt = prompt.toLowerCase();
  if (isVisionPrompt(prompt)) {
    const vision = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("vision"));
    if (vision) return vision;
  }
  if (isCodingPrompt(prompt) || lowerPrompt.includes("agent")) {
    const coder = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("coder"));
    if (coder) return coder;
  }
  return models[0];
}

function pickAutoMiniMaxModelLocal(
  models: Awaited<ReturnType<typeof getMiniMaxModels>>,
  prompt: string,
) {
  if (isCodingPrompt(prompt)) {
    const advanced = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("2.5"));
    if (advanced) return advanced;
  }
  return models[0];
}

function pickAutoCodexModelLocal(
  models: Awaited<ReturnType<typeof getCodexModels>>,
  prompt: string,
) {
  const lowerPrompt = prompt.toLowerCase();
  if (isCodingPrompt(prompt) || lowerPrompt.includes("agent")) {
    const strong = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("codex"));
    if (strong) return strong;
  }
  if (isVisionPrompt(prompt)) {
    const vision = models.find((m) => m.input.includes("image"));
    if (vision) return vision;
  }
  return models[0];
}

function pickAutoAntigravityModelLocal(
  models: Awaited<ReturnType<typeof getAntigravityModels>>,
  prompt: string,
) {
  const lowerPrompt = prompt.toLowerCase();
  if (isCodingPrompt(prompt) || lowerPrompt.includes("agent")) {
    const claudeThinking = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("claude-opus"));
    if (claudeThinking) return claudeThinking;
  }
  if (isVisionPrompt(prompt)) {
    const vision = models.find((m) => m.input.includes("image"));
    if (vision) return vision;
  }
  const geminiPreferred = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("gemini"));
  if (geminiPreferred) return geminiPreferred;
  return models[0];
}

function pickAutoOpenRouterModelLocal(
  models: Awaited<ReturnType<typeof getOpenRouterModels>>,
  prompt: string,
) {
  const lowerPrompt = prompt.toLowerCase();

  if (isVisionPrompt(prompt)) {
    const vision =
      models.find((m) => m.input.includes("image")) ||
      models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("vision"));
    if (vision) return vision;
  }

  if (isCodingPrompt(prompt) || lowerPrompt.includes("agent")) {
    const codingPreferred = models.find((m) => {
      const lower = `${m.id} ${m.name}`.toLowerCase();
      return (
        lower.includes("claude") ||
        lower.includes("gpt") ||
        lower.includes("deepseek") ||
        lower.includes("qwen")
      );
    });
    if (codingPreferred) return codingPreferred;
  }

  const balanced = models.find((m) => {
    const lower = `${m.id} ${m.name}`.toLowerCase();
    return lower.includes("claude") || lower.includes("gpt") || lower.includes("gemini");
  });

  return balanced || models[0];
}

function pickAutoKiloModelLocal(
  models: Awaited<ReturnType<typeof getKiloModels>>,
  prompt: string,
) {
  const lowerPrompt = prompt.toLowerCase();

  if (isVisionPrompt(prompt)) {
    const vision =
      models.find((m) => m.input.includes("image")) ||
      models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("vision"));
    if (vision) return vision;
  }

  if (isCodingPrompt(prompt) || lowerPrompt.includes("agent")) {
    const codingPreferred = models.find((m) => {
      const lower = `${m.id} ${m.name}`.toLowerCase();
      return (
        lower.includes("claude") ||
        lower.includes("gpt") ||
        lower.includes("qwen") ||
        lower.includes("deepseek")
      );
    });
    if (codingPreferred) return codingPreferred;
  }

  const balanced = models.find((m) => {
    const lower = `${m.id} ${m.name}`.toLowerCase();
    return lower.includes("claude") || lower.includes("gpt") || lower.includes("gemini");
  });

  return balanced || models[0];
}

async function loadProviderModelList(provider: TelegramProviderId): Promise<Array<{ id: string; name: string }>> {
  if (provider === "qwen") {
    const token = await loadQwenToken();
    if (!token) throw new Error("Qwen is not authenticated.");
    return (await getQwenModels(token)).map((model) => ({ id: model.id, name: model.name }));
  }
  if (provider === "minimax") {
    const token = await loadMiniMaxToken();
    if (!token) throw new Error("MiniMax is not authenticated.");
    return (await getMiniMaxModels(token)).map((model) => ({ id: model.id, name: model.name }));
  }
  if (provider === "codex") {
    const token = await loadCodexToken();
    if (!token) throw new Error("Codex is not authenticated.");
    return (await getCodexModels(token)).map((model) => ({ id: model.id, name: model.name }));
  }
  if (provider === "antigravity") {
    const token = await loadAntigravityToken();
    if (!token) throw new Error("Antigravity is not authenticated.");
    return (await getAntigravityModels(token)).map((model) => ({ id: model.id, name: model.name }));
  }
  if (provider === "kilo") {
    const token = await loadKiloToken();
    if (!token) throw new Error("Kilo is not authenticated.");
    return (await getKiloModels(token)).map((model) => ({ id: model.id, name: model.name }));
  }
  const token = await loadOpenRouterToken();
  if (!token) throw new Error("OpenRouter is not authenticated.");
  return (await getOpenRouterModels(token)).map((model) => ({ id: model.id, name: model.name }));
}

async function resolveModelHintFromPrompt(
  provider: TelegramProviderId,
  prompt: string,
): Promise<{
  modelId?: string;
  prompt: string;
  modelOnly: boolean;
}> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { prompt: "", modelOnly: false };
  }

  const models = await loadProviderModelList(provider);
  if (!models.length) {
    return { prompt: trimmed, modelOnly: false };
  }

  const exact = findByModelId(models, trimmed);
  if (exact) {
    return {
      modelId: exact.id,
      prompt: "",
      modelOnly: true,
    };
  }

  const [firstToken, ...restTokens] = trimmed.split(/\s+/);
  const firstMatch = findByModelId(models, firstToken);
  if (firstMatch) {
    const restPrompt = restTokens.join(" ").trim();
    return {
      modelId: firstMatch.id,
      prompt: restPrompt,
      modelOnly: restPrompt.length === 0,
    };
  }

  return { prompt: trimmed, modelOnly: false };
}

async function readLinePrompt(message: string): Promise<string> {
  process.stdin.setRawMode?.(false);
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`${white}${message}${reset}`);
  } finally {
    rl.close();
  }
}

async function waitAnyKey(): Promise<void> {
  console.log(`${white}Press any key to continue...${reset}`);
  await new Promise<void>((resolve) => {
    const handleData = () => {
      process.stdin.removeListener("data", handleData);
      process.stdin.setRawMode?.(false);
      resolve();
    };
    process.stdin.once("data", handleData);
    process.stdin.setRawMode?.(true);
  });
}

async function showMenu<T extends string | number>(
  title: string,
  items: Array<MenuItem<T>>,
  hint = "use ↑↓ arrows, Enter to select",
): Promise<T> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;

    const render = () => {
      const lines: string[] = [];
      lines.push(`${bold}${title}:${reset} ${gray}(${hint})${reset}`);
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const active = selectedIndex === index;
        const icon = active ? `${orange}▶${reset}` : " ";
        const color = active ? orange : white;
        lines.push(`  ${icon} ${color}${item.label.padEnd(18)}${reset} ${gray}│${reset} ${item.description}`);
      }
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );

      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A`);
      }
      for (const line of lines) {
        process.stdout.write(`\x1b[2K${line}\n`);
      }
      renderedLines = lines.length;
    };

    render();

    const handleData = (data: Buffer) => {
      const char = data.toString();
      if (char === "\x1b[A" || char === "k") {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        render();
      } else if (char === "\x1b[B" || char === "j") {
        selectedIndex = (selectedIndex + 1) % items.length;
        render();
      } else if (char === "\r" || char === "\n") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(items[selectedIndex].key);
      } else if (char === "\u0003") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(items[items.length - 1].key);
      }
    };

    process.stdin.on("data", handleData);
    process.stdin.setRawMode?.(true);
  });
}

async function buildRouteForProvider(
  provider: TelegramProviderId,
  requestedModelId?: string,
  promptForAuto = "",
): Promise<AiRouteCandidate> {
  if (provider === "qwen") {
    const token = await loadQwenToken();
    if (!token) {
      throw new Error("Qwen is not authenticated. Run /model first.");
    }
    const models = await getQwenModels(token);
    if (!models.length) {
      throw new Error("No Qwen model available.");
    }
    const requested = findByModelId(models, requestedModelId);
    if (requestedModelId && !requested) {
      throw new Error(`Qwen model not found: ${requestedModelId}`);
    }
    const selected =
      requested ||
      pickAutoQwenModelLocal(models, promptForAuto) ||
      models[0];
    if (requested) {
      await saveCurrentModel(requested.id);
    }
    return {
      provider: "qwen",
      token,
      model: selected,
      baseUrl: resolveQwenBaseUrl(token),
    };
  }

  if (provider === "minimax") {
    const token = await loadMiniMaxToken();
    if (!token) {
      throw new Error("MiniMax is not authenticated. Run /model first.");
    }
    const models = await getMiniMaxModels(token);
    if (!models.length) {
      throw new Error("No MiniMax model available.");
    }
    const requested = findByModelId(models, requestedModelId);
    if (requestedModelId && !requested) {
      throw new Error(`MiniMax model not found: ${requestedModelId}`);
    }
    const selected =
      requested ||
      pickAutoMiniMaxModelLocal(models, promptForAuto) ||
      models[0];
    if (requested) {
      await saveCurrentMiniMaxModel(requested.id);
    }
    return {
      provider: "minimax",
      token,
      model: selected,
      baseUrl: resolveMiniMaxBaseUrl(token),
    };
  }

  if (provider === "codex") {
    const token = await loadCodexToken();
    if (!token) {
      throw new Error("Codex is not authenticated. Run /model first.");
    }
    const models = await getCodexModels(token);
    if (!models.length) {
      throw new Error("No Codex model available.");
    }
    const requested = findByModelId(models, requestedModelId);
    if (requestedModelId && !requested) {
      throw new Error(`Codex model not found: ${requestedModelId}`);
    }
    const selected =
      requested ||
      pickAutoCodexModelLocal(models, promptForAuto) ||
      models[0];
    if (requested) {
      await saveCurrentCodexModel(requested.id);
    }
    return {
      provider: "codex",
      token,
      model: selected,
    };
  }

  if (provider === "antigravity") {
    const token = await loadAntigravityToken();
    if (!token) {
      throw new Error("Antigravity is not authenticated. Run /model first.");
    }
    const models = await getAntigravityModels(token);
    if (!models.length) {
      throw new Error("No Antigravity model available.");
    }
    const requested = findByModelId(models, requestedModelId);
    if (requestedModelId && !requested) {
      throw new Error(`Antigravity model not found: ${requestedModelId}`);
    }
    const selected =
      requested ||
      pickAutoAntigravityModelLocal(models, promptForAuto) ||
      models[0];
    if (requested) {
      await saveCurrentAntigravityModel(requested.id);
    }
    return {
      provider: "antigravity",
      token,
      model: selected,
      baseUrl: resolveAntigravityBaseUrl(token),
    };
  }

  if (provider === "kilo") {
    const token = await loadKiloToken();
    if (!token) {
      throw new Error("Kilo is not authenticated. Run /model first.");
    }
    const models = await getKiloModels(token);
    if (!models.length) {
      throw new Error("No Kilo model available.");
    }
    const requested = findByModelId(models, requestedModelId);
    if (requestedModelId && !requested) {
      throw new Error(`Kilo model not found: ${requestedModelId}`);
    }
    const selected =
      requested ||
      pickAutoKiloModelLocal(models, promptForAuto) ||
      models[0];
    if (requested) {
      await saveCurrentKiloModel(requested.id);
    }
    return {
      provider: "kilo",
      token,
      model: selected,
      baseUrl: resolveKiloBaseUrl(token),
    };
  }

  const token = await loadOpenRouterToken();
  if (!token) {
    throw new Error("OpenRouter is not authenticated. Run /model first.");
  }
  const models = await getOpenRouterModels(token);
  if (!models.length) {
    throw new Error("No OpenRouter model available.");
  }
  const requested = findByModelId(models, requestedModelId);
  if (requestedModelId && !requested) {
    throw new Error(`OpenRouter model not found: ${requestedModelId}`);
  }
  const selected =
    requested ||
    pickAutoOpenRouterModelLocal(models, promptForAuto) ||
    models[0];
  if (requested) {
    await saveCurrentOpenRouterModel(requested.id);
  }
  return {
    provider: "openrouter",
    token,
    model: selected,
    baseUrl: resolveOpenRouterBaseUrl(),
  };
}

async function fetchQwenResponse(
  route: Extract<AiRouteCandidate, { provider: "qwen" }>,
  prompt: string,
): Promise<string> {
  const response = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.access}`,
    },
    body: JSON.stringify({
      model: route.model.id,
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.min(route.model.maxTokens, 2048),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return normalizeUsageText(data?.choices?.[0]?.message?.content || "No response from AI.");
}

async function fetchMiniMaxResponse(
  route: Extract<AiRouteCandidate, { provider: "minimax" }>,
  prompt: string,
): Promise<string> {
  const response = await fetch(`${route.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.access}`,
    },
    body: JSON.stringify({
      model: route.model.id,
      max_tokens: Math.min(route.model.maxTokens, 2048),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (Array.isArray(data?.content)) {
    const text = data.content
      .filter((item: any) => item?.type === "text" && typeof item?.text === "string")
      .map((item: any) => item.text)
      .join("");
    if (text.trim()) {
      return normalizeUsageText(text);
    }
  }

  return normalizeUsageText(
    data?.choices?.[0]?.message?.content || data?.reply || data?.base_resp?.status_msg || "No response from AI.",
  );
}

async function fetchOpenRouterResponse(
  route: Extract<AiRouteCandidate, { provider: "openrouter" }>,
  prompt: string,
): Promise<string> {
  const response = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://localhost",
      "X-Title": process.env.OPENROUTER_X_TITLE || "Khalid AI CLI",
    },
    body: JSON.stringify({
      model: route.model.id,
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.min(route.model.maxTokens, 2048),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return normalizeUsageText(data?.choices?.[0]?.message?.content || "No response from AI.");
}

async function fetchKiloResponse(
  route: Extract<AiRouteCandidate, { provider: "kilo" }>,
  prompt: string,
): Promise<string> {
  const response = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.apiKey}`,
    },
    body: JSON.stringify({
      model: route.model.id,
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.min(route.model.maxTokens, 2048),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return normalizeUsageText(data?.choices?.[0]?.message?.content || "No response from AI.");
}

async function fetchAntigravityResponse(
  route: Extract<AiRouteCandidate, { provider: "antigravity" }>,
  prompt: string,
): Promise<string> {
  const normalizedModelId = normalizeAntigravityModelId(route.model.id);
  const modelIdLower = normalizedModelId.toLowerCase();
  const requestBody = {
    project: route.token.projectId,
    model: normalizedModelId,
    request: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: {
        role: "user",
        parts: [
          { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
          { text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
        ],
      },
    },
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  };

  const endpoints = [route.baseUrl, ANTIGRAVITY_ENDPOINT_DAILY, ANTIGRAVITY_ENDPOINT_PROD].filter(
    (value, index, list) => value && list.indexOf(value) === index,
  );
  let lastError = "Antigravity request failed";

  for (const endpoint of endpoints) {
    const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${route.token.access}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...getAntigravityHeaders(),
        ...(modelIdLower.includes("claude") && modelIdLower.includes("thinking")
          ? { "anthropic-beta": "interleaved-thinking-2025-05-14" }
          : {}),
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text();
      lastError = text || `${response.status} ${response.statusText}`;
      continue;
    }

    const rawSse = await response.text();
    const text = parseAntigravitySseText(rawSse);
    if (text.trim()) {
      return normalizeUsageText(text);
    }
    lastError = "Antigravity returned an empty response.";
  }

  throw new Error(lastError);
}

async function fetchCodexResponse(
  route: Extract<AiRouteCandidate, { provider: "codex" }>,
  prompt: string,
  options?: {
    onProgress?: (status: string, detail?: string) => void;
    applyExecutionPolicy?: boolean;
  },
): Promise<string> {
  const outputFile = join(homedir(), ".hakathone", "store", `telegram-codex-${randomUUID()}.txt`);
  const fs = await import("node:fs/promises");
  await fs.mkdir(join(homedir(), ".hakathone", "store"), { recursive: true });

  let stdout = "";
  let stderr = "";

  await new Promise<void>((resolve, reject) => {
    options?.onProgress?.("starting runtime", "starting Codex process");
    const args = [
      "exec",
      ...CODEX_MCP_DISABLE_OVERRIDES,
      "--sandbox",
      "danger-full-access",
      "--dangerously-bypass-approvals-and-sandbox",
      "--ephemeral",
      "--skip-git-repo-check",
      "--add-dir",
      "/",
      "--color",
      "never",
      "--output-last-message",
      outputFile,
      "--model",
      route.model.id,
      "--cd",
      homedir(),
      options?.applyExecutionPolicy === false ? prompt : withTelegramExecutionPolicy(prompt),
    ];

    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
    const pushProgress = (source: "stdout" | "stderr", chunk: string) => {
      const lines = chunk
        .replace(/\r/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      options?.onProgress?.(`streaming ${source}`, last.length > 160 ? `${last.slice(0, 160)}...` : last);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      pushProgress("stdout", text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      pushProgress("stderr", text);
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        options?.onProgress?.("finalizing response", "collecting final output");
        resolve();
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `codex exit code ${code}`));
      }
    });
  });

  try {
    const text = (await fs.readFile(outputFile, "utf-8")).trim();
    if (text) return normalizeUsageText(text);
  } finally {
    await fs.rm(outputFile, { force: true }).catch(() => undefined);
  }

  const fallback = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  if (fallback) return normalizeUsageText(fallback);
  throw new Error("Codex returned an empty response.");
}

async function fetchRouteResponse(
  candidate: AiRouteCandidate,
  prompt: string,
): Promise<string> {
  if (candidate.provider === "qwen") {
    return await fetchQwenResponse(candidate, prompt);
  }
  if (candidate.provider === "minimax") {
    return await fetchMiniMaxResponse(candidate, prompt);
  }
  if (candidate.provider === "antigravity") {
    return await fetchAntigravityResponse(candidate, prompt);
  }
  if (candidate.provider === "openrouter") {
    return await fetchOpenRouterResponse(candidate, prompt);
  }
  if (candidate.provider === "kilo") {
    return await fetchKiloResponse(candidate, prompt);
  }
  return await fetchCodexResponse(candidate, prompt);
}

function createTypingPulse(token: string, chatId: number): () => void {
  void telegramSendTyping(token, chatId).catch(() => undefined);
  const timer = setInterval(() => {
    void telegramSendTyping(token, chatId).catch(() => undefined);
  }, 3500);
  return () => clearInterval(timer);
}

async function createLiveStatusMessage(token: string, chatId: number, actor: string, runId?: string): Promise<{
  update: (text: string) => Promise<void>;
  close: () => Promise<void>;
}> {
  let messageId: number | null = null;
  try {
    const sent = await telegramSendMessage(token, chatId, `${actor} > Thinking: preparing request`);
    messageId = sent.message_id;
  } catch {
    messageId = null;
  }

  let lastText = "";
  let lastAt = 0;

  return {
    update: async (text: string) => {
      if (runId) {
        updateLiveRunStatus(runId, text);
      }
      if (!messageId) return;
      const now = Date.now();
      const nextText = `${actor} > ${text}`;
      if (nextText === lastText || now - lastAt < 700) {
        return;
      }
      lastText = nextText;
      lastAt = now;
      try {
        await telegramEditMessage(token, chatId, messageId, nextText);
      } catch {
        // ignore edit races
      }
    },
    close: async () => {
      if (runId) {
        updateLiveRunStatus(runId, "completed");
      }
      if (!messageId) return;
      try {
        await telegramDeleteMessage(token, chatId, messageId);
      } catch {
        // ignore
      }
    },
  };
}

async function sendTelegramChunks(token: string, chatId: number, text: string): Promise<void> {
  const chunks = splitTelegramMessage(text);
  for (const chunk of chunks) {
    await telegramSendMessage(token, chatId, chunk);
  }
}

async function sendTelegramHelp(token: string, chatId: number): Promise<void> {
  const message = [
    "Telegram commands:",
    "Send any message normally (auto model routing is enabled).",
    "Provider lock examples: /qwen, /codex model=gpt-5.3-codex, openrouter/anthropic/claude-3.5-sonnet prompt...",
    "Provider+model prefix: openrouter: Claude 3 Haiku > your task",
    "",
    "Other:",
    "/providers",
    "/live",
    "/clear",
    "/help",
    "",
    "Media:",
    "Send voice/photo/video directly and bot will analyze then answer.",
  ].join("\n");
  await telegramSendMessage(token, chatId, message);
}

async function buildProvidersStatusText(): Promise<string> {
  const qwen = await loadQwenToken();
  const minimax = await loadMiniMaxToken();
  const codex = await loadCodexToken();
  const antigravity = await loadAntigravityToken();
  const openrouter = await loadOpenRouterToken();
  const kilo = await loadKiloToken();
  return [
    "Providers:",
    `Qwen: ${qwen ? "connected" : "not connected"}`,
    `MiniMax: ${minimax ? "connected" : "not connected"}`,
    `Codex: ${codex ? "connected" : "not connected"}`,
    `Antigravity: ${antigravity ? "connected" : "not connected"}`,
    `OpenRouter: ${openrouter ? "connected" : "not connected"}`,
    `Kilo: ${kilo ? "connected" : "not connected"}`,
  ].join("\n");
}

async function resolveRouteCandidates(
  prompt: string,
): Promise<AiRouteCandidate[]> {
  return await buildAiRouteCandidates(prompt);
}

async function getChatLockedRoute(chatId: number): Promise<{
  provider?: TelegramProviderId;
  modelId?: string;
}> {
  const config = await loadTelegramConfig();
  const state = getTelegramChatState(config, chatId);
  return {
    provider: state.provider,
    modelId: state.modelId,
  };
}

async function resolveCodexRouteForExecution(prompt: string): Promise<Extract<AiRouteCandidate, { provider: "codex" }> | null> {
  const candidates = await resolveRouteCandidates(prompt);
  const codex = candidates.find(
    (candidate): candidate is Extract<AiRouteCandidate, { provider: "codex" }> => candidate.provider === "codex",
  );
  return codex || null;
}

async function sendTelegramLiveLink(token: string, chatId: number, run: TelegramLiveRun): Promise<void> {
  try {
    const port = await ensureTelegramLiveServer();
    const links = buildLiveRunLinks(run.id, port);
    const hasPublicBase = Boolean(getLivePublicBaseUrl());
    const lines: string[] = ["Live link(s):"];
    for (const item of links) {
      lines.push(`${item.label}: ${item.url}`);
    }
    if (!hasPublicBase) {
      lines.push("");
      lines.push(
        "Public mobile access চাইলে KHALID_TELEGRAM_LIVE_PUBLIC_BASE_URL এ tunnel/tailscale URL সেট করুন.",
      );
    }
    await telegramSendMessage(token, chatId, lines.join("\n"));
  } catch (error: any) {
    appendLiveRunEvent(run.id, `live-link unavailable: ${error?.message || "server error"}`);
  }
}

async function runTelegramSystemExecutionTurn(params: {
  token: string;
  chatId: number;
  prompt: string;
  saveUserMessage?: string;
  forcedProvider?: TelegramProviderId;
  forcedModelId?: string;
}): Promise<void> {
  const run = createLiveRun(params.chatId, params.prompt, "System Executor");
  const originalUserMessage = (params.saveUserMessage || params.prompt).trim();
  await sendTelegramLiveLink(params.token, params.chatId, run);
  updateLiveRunStatus(run.id, "preparing system execution");

  const fsIntent = extractFileSystemIntent(params.prompt);
  if (fsIntent) {
    try {
      updateLiveRunStatus(run.id, `executing file task`, `${fsIntent.kind} ${fsIntent.path}`);
      const result = await runFileSystemIntent(fsIntent);
      const response = [
        `System Executor > ${result.message}`,
        `Path: ${result.absolutePath}`,
      ].join("\n");
      completeLiveRun(run.id, response);
      await sendTelegramChunks(params.token, params.chatId, response);
      void saveChatTurn(params.prompt, response, "system-file", "System Executor").catch(() => undefined);
      void appendTelegramChatMemory({
        chatId: params.chatId,
        userMessage: originalUserMessage,
        assistantMessage: response,
        provider: "system-file",
        model: "System Executor",
      }).catch(() => undefined);
    } catch (error: any) {
      const message = error?.message || "File task failed.";
      failLiveRun(run.id, message);
      await telegramSendMessage(params.token, params.chatId, `System Executor > Error: ${message}`);
      void appendTelegramChatMemory({
        chatId: params.chatId,
        userMessage: originalUserMessage,
        assistantMessage: `System Executor > Error: ${message}`,
        provider: "system-file",
        model: "System Executor",
      }).catch(() => undefined);
    }
    return;
  }

  const commandIntent = extractCommandIntent(params.prompt);
  if (commandIntent?.explicit) {
    const command = commandIntent.command;
    if (isHarmfulCommand(command)) {
      const message = "Blocked: harmful/destructive command is not allowed.";
      failLiveRun(run.id, message);
      await telegramSendMessage(params.token, params.chatId, `System Executor > ${message}`);
      return;
    }
    try {
      updateLiveRunStatus(run.id, "running shell command", command);
      const result = await runShellCommand(command, { cwd: homedir() });
      const output = normalizeUsageText(result.output || "(no output)");
      const response = [
        `System Executor > Command: ${command}`,
        `Exit: ${result.exitCode ?? "unknown"} | Duration: ${formatDurationMs(result.durationMs)}`,
        "",
        output.slice(0, 3500),
      ].join("\n");
      if (result.exitCode && result.exitCode !== 0) {
        failLiveRun(run.id, response);
      } else {
        completeLiveRun(run.id, response);
      }
      await sendTelegramChunks(params.token, params.chatId, response);
      void saveChatTurn(params.prompt, response, "system-command", "System Executor").catch(() => undefined);
      void appendTelegramChatMemory({
        chatId: params.chatId,
        userMessage: originalUserMessage,
        assistantMessage: response,
        provider: "system-command",
        model: "System Executor",
      }).catch(() => undefined);
    } catch (error: any) {
      const message = error?.message || "Command execution failed.";
      failLiveRun(run.id, message);
      await telegramSendMessage(params.token, params.chatId, `System Executor > Error: ${message}`);
      void appendTelegramChatMemory({
        chatId: params.chatId,
        userMessage: originalUserMessage,
        assistantMessage: `System Executor > Error: ${message}`,
        provider: "system-command",
        model: "System Executor",
      }).catch(() => undefined);
    }
    return;
  }

  if (params.forcedProvider && params.forcedProvider !== "codex") {
    appendLiveRunEvent(
      run.id,
      `requested ${formatProviderName(params.forcedProvider)} for system execution; using Codex runtime`,
    );
    await telegramSendMessage(
      params.token,
      params.chatId,
      `System Executor > ${formatProviderName(params.forcedProvider)} selected, but system execution runtime is Codex. Running with Codex now.`,
    ).catch(() => undefined);
  }

  let codexRoute: Extract<AiRouteCandidate, { provider: "codex" }> | null = null;
  if (params.forcedProvider === "codex") {
    try {
      const built = await buildRouteForProvider("codex", params.forcedModelId, params.prompt);
      codexRoute = built as Extract<AiRouteCandidate, { provider: "codex" }>;
    } catch (error: any) {
      const message = error?.message || "Failed to use requested Codex model.";
      failLiveRun(run.id, message);
      await telegramSendMessage(params.token, params.chatId, `System Executor > ${message}`);
      void appendTelegramChatMemory({
        chatId: params.chatId,
        userMessage: originalUserMessage,
        assistantMessage: `System Executor > ${message}`,
        provider: "system-codex",
        model: "System Executor",
      }).catch(() => undefined);
      return;
    }
  } else {
    codexRoute = await resolveCodexRouteForExecution(params.prompt);
  }

  if (!codexRoute) {
    const message = "Codex is not authenticated for execution tasks. Run /model in CLI and connect Codex.";
    failLiveRun(run.id, message);
    await telegramSendMessage(params.token, params.chatId, `System Executor > ${message}`);
    void appendTelegramChatMemory({
      chatId: params.chatId,
      userMessage: originalUserMessage,
      assistantMessage: `System Executor > ${message}`,
      provider: "system-codex",
      model: "System Executor",
    }).catch(() => undefined);
    return;
  }

  const stopTyping = createTypingPulse(params.token, params.chatId);
  const status = await createLiveStatusMessage(params.token, params.chatId, "System Executor", run.id);

  try {
    const continuityPrompt = await buildTelegramChatContinuityPrompt(params.chatId, params.prompt);
    const contextPrompt = await buildMessageWithMemoryContext(continuityPrompt);
    updateLiveRunStatus(run.id, "executing large task with codex", codexRoute.model.id);
    await status.update(`Thinking: executing with ${codexRoute.model.id}`);
    const result = await fetchCodexResponse(codexRoute, contextPrompt, {
      applyExecutionPolicy: true,
      onProgress: (summary, detail) => {
        void status.update(`${summary}${detail ? ` | ${detail}` : ""}`);
      },
    });
    await status.close();
    stopTyping();
    completeLiveRun(run.id, result);
    await sendTelegramChunks(params.token, params.chatId, `System Executor > ${result}`);
    void saveChatTurn(params.prompt, result, "system-codex", codexRoute.model.name).catch(() => undefined);
    void appendTelegramChatMemory({
      chatId: params.chatId,
      userMessage: originalUserMessage,
      assistantMessage: `System Executor > ${result}`,
      provider: "system-codex",
      model: codexRoute.model.name,
    }).catch(() => undefined);
  } catch (error: any) {
    await status.close();
    stopTyping();
    const message = error?.message || "System execution failed.";
    failLiveRun(run.id, message);
    await telegramSendMessage(params.token, params.chatId, `System Executor > Error: ${message}`);
    void appendTelegramChatMemory({
      chatId: params.chatId,
      userMessage: originalUserMessage,
      assistantMessage: `System Executor > Error: ${message}`,
      provider: "system-codex",
      model: codexRoute.model.name,
    }).catch(() => undefined);
  }
}

async function runTelegramAiTurn(params: {
  token: string;
  chatId: number;
  prompt: string;
  saveUserMessage?: string;
  forcedProvider?: TelegramProviderId;
  forcedModelId?: string;
}): Promise<void> {
  const run = createLiveRun(params.chatId, params.prompt, "AI Router");
  await sendTelegramLiveLink(params.token, params.chatId, run);
  updateLiveRunStatus(run.id, "preparing request");
  const continuityPrompt = await buildTelegramChatContinuityPrompt(params.chatId, params.prompt);
  const contextPrompt = await buildMessageWithMemoryContext(continuityPrompt);
  const preparedPrompt = withTelegramStylePrompt(contextPrompt);
  let candidates: AiRouteCandidate[] = [];
  if (params.forcedProvider) {
    try {
      const forced = await buildRouteForProvider(
        params.forcedProvider,
        params.forcedModelId,
        params.prompt,
      );
      candidates = [forced];
    } catch (error: any) {
      const message = error?.message || "Requested provider/model is unavailable.";
      failLiveRun(run.id, message);
      await telegramSendMessage(params.token, params.chatId, `AI Router > ${message}`);
      void appendTelegramChatMemory({
        chatId: params.chatId,
        userMessage: params.saveUserMessage || params.prompt,
        assistantMessage: `AI Router > ${message}`,
        provider: "router",
        model: "Router",
      }).catch(() => undefined);
      return;
    }
  } else {
    candidates = await resolveRouteCandidates(params.prompt);
  }
  if (!candidates.length) {
    failLiveRun(run.id, "No authenticated provider found.");
    await telegramSendMessage(
      params.token,
      params.chatId,
      "No authenticated provider found. Run /model in CLI and authenticate providers.",
    );
    void appendTelegramChatMemory({
      chatId: params.chatId,
      userMessage: params.saveUserMessage || params.prompt,
      assistantMessage: "No authenticated provider found. Run /model in CLI and authenticate providers.",
      provider: "router",
      model: "Router",
    }).catch(() => undefined);
    return;
  }

  let lastError = "Request failed.";

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const isLast = index === candidates.length - 1;
    const providerName = formatProviderName(candidate.provider);
    const actor = `${providerName}: ${getModelLabel(candidate)}`;

    updateLiveRunStatus(run.id, `querying ${providerName}`, candidate.model.id);
    const status = await createLiveStatusMessage(params.token, params.chatId, actor, run.id);
    const stopTyping = createTypingPulse(params.token, params.chatId);

    try {
      await status.update(`Thinking: querying ${providerName}`);
      const answer = await fetchRouteResponse(candidate, preparedPrompt);
      await status.close();
      stopTyping();

      const rendered = `${actor} > ${normalizeUsageText(answer) || "No response."}`;
      completeLiveRun(run.id, rendered);
      await sendTelegramChunks(params.token, params.chatId, rendered);

      void saveChatTurn(
        params.saveUserMessage || params.prompt,
        normalizeUsageText(answer),
        candidate.provider,
        actor,
      ).catch(() => undefined);
      void appendTelegramChatMemory({
        chatId: params.chatId,
        userMessage: params.saveUserMessage || params.prompt,
        assistantMessage: rendered,
        provider: candidate.provider,
        model: getModelLabel(candidate),
      }).catch(() => undefined);
      return;
    } catch (error: any) {
      await status.close();
      stopTyping();
      lastError = error?.message || "Request failed.";
      appendLiveRunEvent(run.id, `${formatProviderName(candidate.provider)} failed: ${lastError}`);
      if (!isLast) {
        continue;
      }
      failLiveRun(run.id, lastError);
      await telegramSendMessage(params.token, params.chatId, `${actor} > Error: ${lastError}`);
      void appendTelegramChatMemory({
        chatId: params.chatId,
        userMessage: params.saveUserMessage || params.prompt,
        assistantMessage: `${actor} > Error: ${lastError}`,
        provider: candidate.provider,
        model: getModelLabel(candidate),
      }).catch(() => undefined);
      return;
    }
  }

  failLiveRun(run.id, lastError);
  await telegramSendMessage(params.token, params.chatId, `Error: ${lastError}`);
  void appendTelegramChatMemory({
    chatId: params.chatId,
    userMessage: params.saveUserMessage || params.prompt,
    assistantMessage: `Error: ${lastError}`,
    provider: "router",
    model: "Router",
  }).catch(() => undefined);
}

async function handleTelegramPhotoMessage(params: {
  token: string;
  chatId: number;
  photoFileId: string;
  caption: string;
}): Promise<void> {
  const analysis = await analyzeTelegramPhoto({
    telegramToken: params.token,
    fileId: params.photoFileId,
    prompt:
      "Analyze this Telegram photo. Describe visible objects, important context, and any text if present.",
  });

  const prompt = [
    "User sent a photo in Telegram.",
    `Image analysis by ${analysis.provider}/${analysis.model}:`,
    analysis.analysis,
    "",
    `User request: ${
      params.caption.trim() || "Describe this image and answer the user with practical details."
    }`,
  ].join("\n");

  const lock = await getChatLockedRoute(params.chatId);

  await runTelegramAiTurn({
    token: params.token,
    chatId: params.chatId,
    prompt,
    saveUserMessage: params.caption || "[photo]",
    forcedProvider: lock.provider,
    forcedModelId: lock.modelId,
  });
}

async function handleTelegramVoiceMessage(params: {
  token: string;
  chatId: number;
  voiceFileId: string;
  voiceMimeType?: string;
  caption: string;
}): Promise<void> {
  const transcribed = await transcribeTelegramVoice({
    telegramToken: params.token,
    fileId: params.voiceFileId,
    mimeTypeHint: params.voiceMimeType,
    fileNameHint: "voice.ogg",
  });

  const prompt = [
    "User sent a voice message in Telegram.",
    `Voice transcript (${transcribed.provider}/${transcribed.model}):`,
    transcribed.transcript,
    "",
    `User request: ${
      params.caption.trim() || "Answer based on this voice message transcript."
    }`,
  ].join("\n");

  const lock = await getChatLockedRoute(params.chatId);

  await runTelegramAiTurn({
    token: params.token,
    chatId: params.chatId,
    prompt,
    saveUserMessage: params.caption || transcribed.transcript,
    forcedProvider: lock.provider,
    forcedModelId: lock.modelId,
  });
}

async function handleTelegramVideoMessage(params: {
  token: string;
  chatId: number;
  videoFileId: string;
  thumbnailFileId?: string;
  durationSec?: number;
  caption: string;
}): Promise<void> {
  const decoded = await decodeTelegramVideo({
    telegramToken: params.token,
    videoFileId: params.videoFileId,
    thumbnailFileId: params.thumbnailFileId,
    durationSec: params.durationSec,
    caption: params.caption,
  });

  const promptParts = [
    "User sent a video in Telegram.",
    "Video metadata:",
    decoded.metadataSummary,
  ];

  if (decoded.transcript) {
    promptParts.push("");
    promptParts.push(
      `Video audio transcript${decoded.transcriptModel ? ` (${decoded.transcriptModel})` : ""}:`,
    );
    promptParts.push(decoded.transcript);
  }

  if (decoded.visualSummary) {
    promptParts.push("");
    promptParts.push(
      `Video visual frame analysis${decoded.visualModel ? ` (${decoded.visualModel})` : ""}:`,
    );
    promptParts.push(decoded.visualSummary);
  }

  if (decoded.directVideoSummary) {
    promptParts.push("");
    promptParts.push(
      `Direct video summary${decoded.directVideoModel ? ` (${decoded.directVideoModel})` : ""}:`,
    );
    promptParts.push(decoded.directVideoSummary);
  }

  promptParts.push("");
  promptParts.push(
    `User request: ${params.caption.trim() || "Summarize this video and answer the user clearly."}`,
  );

  const lock = await getChatLockedRoute(params.chatId);

  await runTelegramAiTurn({
    token: params.token,
    chatId: params.chatId,
    prompt: promptParts.join("\n"),
    saveUserMessage: params.caption || "[video]",
    forcedProvider: lock.provider,
    forcedModelId: lock.modelId,
  });
}

async function processTelegramUpdate(token: string, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message || typeof message.chat?.id !== "number") {
    return;
  }
  if (message.from?.is_bot) {
    return;
  }

  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const caption = (message.caption || "").trim();

  const photoFileId = pickBestPhotoFileId(message.photo);
  if (photoFileId) {
    try {
      await handleTelegramPhotoMessage({
        token,
        chatId,
        photoFileId,
        caption,
      });
    } catch (error: any) {
      await telegramSendMessage(
        token,
        chatId,
        `Photo processing failed: ${error?.message || "Unknown error"}`,
      );
    }
    return;
  }

  if (message.voice?.file_id) {
    try {
      await handleTelegramVoiceMessage({
        token,
        chatId,
        voiceFileId: message.voice.file_id,
        voiceMimeType: message.voice.mime_type,
        caption,
      });
    } catch (error: any) {
      await telegramSendMessage(
        token,
        chatId,
        `Voice processing failed: ${error?.message || "Unknown error"}`,
      );
    }
    return;
  }

  if (message.video?.file_id) {
    try {
      await handleTelegramVideoMessage({
        token,
        chatId,
        videoFileId: message.video.file_id,
        thumbnailFileId: message.video.thumbnail?.file_id || message.video.thumb?.file_id,
        durationSec: message.video.duration,
        caption,
      });
    } catch (error: any) {
      await telegramSendMessage(
        token,
        chatId,
        `Video processing failed: ${error?.message || "Unknown error"}`,
      );
    }
    return;
  }

  if (message.document?.file_id) {
    const mime = (message.document.mime_type || "").toLowerCase();
    if (mime.startsWith("image/")) {
      try {
        await handleTelegramPhotoMessage({
          token,
          chatId,
          photoFileId: message.document.file_id,
          caption,
        });
      } catch (error: any) {
        await telegramSendMessage(
          token,
          chatId,
          `Image document processing failed: ${error?.message || "Unknown error"}`,
        );
      }
      return;
    }

    if (mime.startsWith("audio/")) {
      try {
        await handleTelegramVoiceMessage({
          token,
          chatId,
          voiceFileId: message.document.file_id,
          voiceMimeType: message.document.mime_type,
          caption,
        });
      } catch (error: any) {
        await telegramSendMessage(
          token,
          chatId,
          `Audio document processing failed: ${error?.message || "Unknown error"}`,
        );
      }
      return;
    }

    if (mime.startsWith("video/")) {
      try {
        await handleTelegramVideoMessage({
          token,
          chatId,
          videoFileId: message.document.file_id,
          thumbnailFileId: message.document.thumbnail?.file_id || message.document.thumb?.file_id,
          caption,
        });
      } catch (error: any) {
        await telegramSendMessage(
          token,
          chatId,
          `Video document processing failed: ${error?.message || "Unknown error"}`,
        );
      }
      return;
    }
  }

  if (!text) {
    return;
  }

  const lower = text.toLowerCase();
  if (lower.startsWith("/start") || lower.startsWith("/help")) {
    await sendTelegramHelp(token, chatId);
    return;
  }

  if (lower.startsWith("/providers")) {
    await telegramSendMessage(token, chatId, await buildProvidersStatusText());
    return;
  }

  if (lower.startsWith("/live")) {
    const runId = telegramLastRunByChat.get(chatId);
    if (!runId) {
      await telegramSendMessage(token, chatId, "No live run found for this chat yet.");
      return;
    }
    const run = telegramLiveRuns.get(runId);
    if (!run) {
      await telegramSendMessage(token, chatId, "Last live run was not found.");
      return;
    }
    try {
      const port = await ensureTelegramLiveServer();
      const links = buildLiveRunLinks(run.id, port);
      const lines = ["Latest live link(s):", ...links.map((item) => `${item.label}: ${item.url}`)];
      await telegramSendMessage(token, chatId, lines.join("\n"));
    } catch (error: any) {
      await telegramSendMessage(token, chatId, `Live link unavailable: ${error?.message || "server error"}`);
    }
    return;
  }

  if (lower.startsWith("/clear") || lower.startsWith("/back")) {
    await clearTelegramChatState(chatId);
    await telegramSendMessage(token, chatId, "Provider/model lock cleared for this chat. Auto routing is now active.");
    return;
  }

  const config = await loadTelegramConfig();
  const chatState = getTelegramChatState(config, chatId);
  const providerRequest = resolveProviderRequestFromInput(text, chatState);

  if (text.startsWith("/") && !looksLikeSystemCommand(text) && !providerRequest.explicitProvider) {
    await telegramSendMessage(token, chatId, "Unknown command. Use /help for available commands.");
    return;
  }

  let forcedProvider = providerRequest.provider;
  let forcedModelId = providerRequest.modelId;
  let normalizedPrompt = providerRequest.prompt;

  if (forcedProvider && (providerRequest.explicitProvider || providerRequest.explicitModel)) {
    try {
      const modelHint = await resolveModelHintFromPrompt(forcedProvider, normalizedPrompt);
      if (modelHint.modelId) {
        forcedModelId = modelHint.modelId;
      }
      normalizedPrompt = modelHint.prompt;
      if (modelHint.modelOnly && modelHint.modelId) {
        await setTelegramChatState(chatId, {
          provider: forcedProvider,
          modelId: modelHint.modelId,
        });
        await telegramSendMessage(
          token,
          chatId,
          `Locked for this chat: ${formatProviderName(forcedProvider)} / ${modelHint.modelId}`,
        );
        return;
      }
    } catch {
      // Ignore model hint resolution errors and continue with parsed values.
    }
  }

  if (providerRequest.providerOnly && forcedProvider) {
    await setTelegramChatState(chatId, {
      provider: forcedProvider,
      modelId: forcedModelId,
    });
    await telegramSendMessage(
      token,
      chatId,
      `Locked provider for this chat: ${formatProviderName(forcedProvider)}${forcedModelId ? ` / ${forcedModelId}` : " (auto model)"}`,
    );
    return;
  }

  if (providerRequest.explicitProvider && forcedProvider) {
    await setTelegramChatState(chatId, {
      provider: forcedProvider,
      modelId: forcedModelId,
    });
  }

  const effectivePrompt = (normalizedPrompt || "").trim() || text;
  if (!effectivePrompt) {
    await sendTelegramHelp(token, chatId);
    return;
  }

  if (isTelegramExecutionPrompt(effectivePrompt)) {
    await runTelegramSystemExecutionTurn({
      token,
      chatId,
      prompt: effectivePrompt,
      saveUserMessage: text,
      forcedProvider,
      forcedModelId,
    });
    return;
  }

  await runTelegramAiTurn({
    token,
    chatId,
    prompt: effectivePrompt,
    saveUserMessage: text,
    forcedProvider,
    forcedModelId,
  });
}

async function pollTelegramAgentLoop(
  options: {
    silent?: boolean;
    startedFromMenu?: boolean;
  } = {},
): Promise<void> {
  const config = await loadTelegramConfig();
  if (!config.authenticated || !config.botToken) {
    throw new Error("Telegram is not authenticated.");
  }

  const token = config.botToken;
  let offset = config.lastUpdateId;

  if (!options.silent && options.startedFromMenu) {
    console.log(`${green}Telegram agent started.${reset}`);
    console.log(`${gray}Bot replies are now active in Telegram.${reset}`);
    console.log("");
  }

  while (!telegramAgentStopRequested) {
    let updates: TelegramUpdate[] = [];
    try {
      updates = await telegramGetUpdates(token, {
        offset,
        timeout: 8,
        limit: 50,
      });
    } catch (error: any) {
      if (!telegramAgentStopRequested) {
        if (!options.silent) {
          console.log(`${yellow}Telegram poll warning: ${error?.message || "poll failed"}${reset}`);
        }
        await sleep(900);
      }
      continue;
    }

    if (!updates.length) {
      continue;
    }

    for (const update of updates) {
      if (telegramAgentStopRequested) {
        break;
      }
      offset = update.update_id + 1;
      await updateTelegramLastUpdateId(offset);
      try {
        await processTelegramUpdate(token, update);
      } catch (error: any) {
        const chatId = update.message?.chat?.id;
        if (typeof chatId === "number") {
          await telegramSendMessage(
            token,
            chatId,
            `Telegram processing error: ${error?.message || "Unknown error"}`,
          ).catch(() => undefined);
        }
      }
    }
  }
}

export function isTelegramAgentRunning(): boolean {
  return telegramAgentRunning;
}

export async function ensureTelegramAgentBackground(
  options: {
    silent?: boolean;
    startedFromMenu?: boolean;
  } = {},
): Promise<TelegramAgentStartResult> {
  const config = await loadTelegramConfig();
  if (!config.authenticated || !config.botToken) {
    return {
      running: false,
      started: false,
      reason: "not-authenticated",
    };
  }

  if (telegramAgentRunning) {
    return {
      running: true,
      started: false,
      reason: "already-running",
    };
  }

  telegramAgentStopRequested = false;
  telegramAgentRunning = true;

  telegramAgentLoopPromise = (async () => {
    try {
      await pollTelegramAgentLoop(options);
    } finally {
      telegramAgentRunning = false;
      telegramAgentLoopPromise = null;
      telegramAgentStopRequested = false;
    }
  })();

  return {
    running: true,
    started: true,
  };
}

export async function stopTelegramAgentBackground(): Promise<void> {
  telegramAgentStopRequested = true;
  if (telegramAgentLoopPromise) {
    await Promise.race([telegramAgentLoopPromise, sleep(9000)]);
  }
}

async function handleTelegramAuth(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}Telegram Bot Authentication${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const rawToken = await readLinePrompt("Paste your Telegram bot token: ");
  const token = rawToken.trim();
  if (!token) {
    console.log(`${red}Token is required.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  try {
    const me = await verifyTelegramBotToken(token);
    const code = createTelegramVerificationCode();
    const existing = await loadTelegramConfig();
    const botLabel = me.username ? `@${me.username}` : me.first_name;

    console.log("");
    console.log(`${green}✓ Bot token verified.${reset}`);
    console.log(`${white}Bot:${reset} ${cyan}${botLabel}${reset}`);
    console.log("");
    console.log(`${white}Verification step:${reset}`);
    console.log(`1. Open Telegram chat with ${cyan}${botLabel}${reset}`);
    console.log(`2. Send this code to the bot: ${yellow}${code}${reset}`);
    console.log(`3. CLI will detect it automatically`);
    console.log("");

    const verification = await pollTelegramVerificationCode({
      token,
      code,
      timeoutMs: 180000,
      startOffset: existing.lastUpdateId,
      onProgress: (message) => {
        process.stdout.write(`\r${gray}${message}${reset}`);
      },
    });

    process.stdout.write("\r\x1b[2K");

    if (!verification) {
      console.log(`${red}Verification timed out. Try again.${reset}`);
      console.log("");
      await waitAnyKey();
      return false;
    }

    await saveTelegramAuth({
      token,
      me,
      verifiedChatId: verification.chatId,
      verifiedUserId: verification.userId,
      lastUpdateId: verification.nextOffset,
    });

    await telegramSendMessage(token, verification.chatId, "Telegram auth successful. Bot is now connected.");
    await ensureTelegramAgentBackground({ silent: true });

    console.log(`${green}✓ Telegram authentication complete.${reset}`);
    console.log(`${white}Verified chat:${reset} ${cyan}${verification.chatId}${reset}`);
    console.log(`${white}Telegram Agent:${reset} ${green}running${reset}`);
    console.log("");
    await sleep(600);
    return true;
  } catch (error: any) {
    console.log(`${red}Telegram auth failed: ${error?.message || "Unknown error"}${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }
}

async function handleTelegramBots(): Promise<void> {
  const config = await loadTelegramConfig();
  if (!config.authenticated || !config.botToken) {
    console.log(`${red}Telegram is not authenticated. Use Telegram Auth first.${reset}`);
    console.log("");
    await waitAnyKey();
    return;
  }

  while (true) {
    const choice = await showMenu("Telegram Bots", [
      { key: 1, label: "Bot Info", description: "Show current Telegram bot details" },
      { key: 2, label: "Send Test", description: "Send test message to verified chat" },
      { key: 0, label: "Back", description: "Go back" },
    ]);

    if (choice === 0) {
      return;
    }

    if (choice === 1) {
      const lines = [
        `Bot Username: ${config.botUsername ? `@${config.botUsername}` : "unknown"}`,
        `Bot Name: ${config.botFirstName || "unknown"}`,
        `Bot ID: ${config.botId ?? "unknown"}`,
        `Verified Chat ID: ${config.verifiedChatId ?? "unknown"}`,
        `Last Update ID: ${config.lastUpdateId ?? "unknown"}`,
      ];
      console.log("");
      console.log(`${white}${lines.join("\n")}${reset}`);
      console.log("");
      await waitAnyKey();
      continue;
    }

    if (!config.verifiedChatId) {
      console.log(`${red}Verified chat is missing. Run Telegram Auth again.${reset}`);
      console.log("");
      await waitAnyKey();
      continue;
    }

    try {
      await telegramSendMessage(config.botToken, config.verifiedChatId, "Khalid AI Telegram bot is connected.");
      console.log(`${green}Test message sent.${reset}`);
    } catch (error: any) {
      console.log(`${red}Failed to send test message: ${error?.message || "Unknown error"}${reset}`);
    }
    console.log("");
    await waitAnyKey();
  }
}

async function handleTelegramLogout(): Promise<void> {
  const authenticated = await isTelegramAuthenticated();
  if (!authenticated) {
    console.log(`${gray}Telegram is already logged out.${reset}`);
    console.log("");
    await waitAnyKey();
    return;
  }
  await stopTelegramAgentBackground();
  await deleteTelegramConfig();
  console.log(`${green}✓ Telegram logout complete.${reset}`);
  console.log("");
  await sleep(400);
}

async function handleTelegramAgentUse(): Promise<void> {
  const config = await loadTelegramConfig();
  if (!config.authenticated || !config.botToken) {
    console.log(`${red}Telegram is not authenticated. Use Telegram Auth first.${reset}`);
    console.log("");
    await waitAnyKey();
    return;
  }

  const running = isTelegramAgentRunning();
  if (running) {
    const choice = await showMenu("Telegram Agent Use", [
      { key: 1, label: "Keep Running", description: "Agent is already running in background" },
      { key: 2, label: "Stop Agent", description: "Stop Telegram background responder" },
      { key: 0, label: "Back", description: "Go back" },
    ]);
    if (choice === 2) {
      await stopTelegramAgentBackground();
      console.log(`${green}Telegram agent stopped.${reset}`);
      console.log("");
      await sleep(300);
    }
    return;
  }

  await ensureTelegramAgentBackground({ silent: false, startedFromMenu: true });
}

export async function runTelegramCommand(): Promise<void> {
  while (true) {
    const choice = await showMenu("Telegram", [
      { key: 1, label: "Telegram Auth", description: "Connect Telegram bot token and verify chat" },
      { key: 2, label: "Telegram Bots", description: "Manage bot information and test message" },
      { key: 3, label: "Telegram Agent Use", description: "Run Telegram bot responder loop" },
      { key: 4, label: "Telegram Logout", description: "Clear Telegram auth and bot state" },
      { key: 0, label: "Cancel", description: "Go back" },
    ]);

    switch (choice) {
      case 1:
        await handleTelegramAuth();
        continue;
      case 2:
        await handleTelegramBots();
        continue;
      case 3:
        await handleTelegramAgentUse();
        continue;
      case 4:
        await handleTelegramLogout();
        continue;
      default:
        return;
    }
  }
}
