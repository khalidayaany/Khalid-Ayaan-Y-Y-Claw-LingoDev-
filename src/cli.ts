#!/usr/bin/env bun

import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { runModelCommand } from "./Cli-Components/Cli-Comand/model.js";
import {
  loadQwenToken,
} from "./Cli-Components/Cli-Extenshone/Qwen/qwen.js";
import { loadMiniMaxToken } from "./Cli-Components/Cli-Extenshone/Minimax/minimax.js";
import { loadCodexToken } from "./Cli-Components/Cli-Extenshone/Codex/codex.js";
import {
  loadAntigravityToken,
  normalizeAntigravityModelId,
} from "./Cli-Components/Cli-Extenshone/Antigravity/antigravity.js";
import { loadOpenRouterToken } from "./Cli-Components/Cli-Extenshone/Openrouter/openrouter.js";
import { loadKiloToken } from "./Cli-Components/Cli-Extenshone/Kilo/kilo.js";
import { isTelegramAuthenticated } from "./Cli-Components/Cli-Extenshone/Telegram/telegram.js";
import {
  ensureTelegramAgentBackground,
  isTelegramAgentRunning,
  runTelegramCommand,
} from "./Cli-Components/Cli-Comand/Telegram.js";
import {
  runConnectCommand,
  runFirecrawlConnectMenu,
  runSkillsConnectMenu,
} from "./Cli-Components/Cli-Comand/Connect.js";
import {
  buildAgentExecutionPrompt,
  buildAiRouteCandidates,
  clearSelectedModelOverride,
  getAgentPromptLabel,
  hasSelectedModelOverride,
  loadAiRouterConfig,
  recordLastUsedModel,
  resolveActiveAgentPlan,
  runAiCommand,
  shouldFallbackToNextProvider,
  type ActiveAgentPlan,
  type AiRouteCandidate,
} from "./Cli-Components/Cli-Comand/Ai.js";
import { isBackCommand, runBackToMain } from "./Cli-Components/Cli-Comand/Back.js";
import {
  buildMessageWithMemoryContext,
  ensureMemoryDirectories,
  isChiferMcpEnabled,
  saveChatTurn,
} from "./Cli-Components/Cli-Comand/memory.js";
import { AiLiveActivity } from "./Cli-Components/Cli-Extenshone/Ai-Live-Act/liveActivity.js";
import {
  extractCommandIntent,
  extractFileSystemIntent,
  runFileSystemIntent,
  runShellCommand,
} from "./Cli-Components/Cli-Shell/index.js";
import {
  buildTodoExecutionPrompt,
  buildTodoPlannerPrompt,
  createTodoRun,
  deriveTodoTasksFromPrompt,
  ensureTodoStore,
  formatTodoProgress,
  getTodoStorePath,
  loadTodoRun,
  setTodoTaskStatus,
} from "./Cli-Components/Cli-Tools/Todo/todo.js";
import { simplifyChatAnswer } from "./Cli-Components/Cli-Agent/chat-simplifier.js";
import {
  BROWSER_USE_HOME,
  inferBrowserUseNaturalIntent,
  isBrowserUseSetupIntent,
  resolveBrowserUseCommandIntent,
  setupBrowserUseLocalStack,
} from "./Cli-Components/Cli-Tools/Browser-Use/browserUse.js";
import {
  listBrowserProfileOptions,
  listSystemBrowserProfiles,
  resolveBrowserRuntimeSelection,
  setBrowserProfilePreferenceManual,
  type BrowserProfileOption,
} from "./Cli-Components/Cli-Tools/Browser-Use/profileManager.js";
import type { BrowserUseCommandIntent } from "./Cli-Components/Cli-Tools/Browser-Use/browserUse.js";
import {
  buildFirecrawlUsage,
  clearFirecrawlApiKey,
  executeFirecrawlRunIntent,
  resolveFirecrawlCliIntent,
  resolveFirecrawlNaturalIntent,
  setFirecrawlApiKey,
  type FirecrawlRunIntent,
} from "./Cli-Components/Cli-Tools/Firecrawl/index.js";
import {
  buildCliSkillsExecutionPrompt,
  loadCliSkillsState,
  resolveCliSkillPlan,
  type CliSkillPlan,
} from "./Cli-Components/Cli-Skills/index.js";
import {
  estimateUsageCostUsd,
  formatSchedulerConfigLines,
  loadSchedulerConfig,
  loadSchedulerModelSummary,
  recordSchedulerTelemetry,
  reorderCandidatesWithScheduler,
  resetSchedulerConfig,
  setSchedulerEnabled,
  setSchedulerMaxBudgetUsd,
  setSchedulerQualityTarget,
  type SchedulerQualityTarget,
} from "./Cli-Components/Cli-Governance/costScheduler.js";
import {
  evaluateCommandPolicy,
  formatPolicyConfigLines,
  loadPolicyConfig,
  resetPolicyConfig,
  savePolicyConfig,
  setPolicyConfirmation,
  setPolicyEnabled,
  setPolicyMode,
  type ConfirmTarget,
  type PolicyMode,
} from "./Cli-Components/Cli-Governance/policyEngine.js";
import {
  clearEvalGateBlock,
  ensureEvalHarnessFiles,
  formatEvalRunSummary,
  getEvalCasesFilePath,
  loadEvalGateState,
  loadEvalLeaderboard,
  loadEvalTrend,
  runEvalHarness,
  type EvalCase,
} from "./Cli-Components/Cli-Governance/evalHarness.js";

// Using exact Tailwind CSS colors
// orange-500: #f97316 = RGB(249, 115, 22)
const orange = '\x1b[38;2;249;115;22m';   // orange-500 (bright orange)
const cyan = '\x1b[38;2;34;211;238m';     // cyan-400
const green = '\x1b[38;2;34;197;94m';     // green-500
const red = '\x1b[38;2;239;68;68m';
const white = '\x1b[38;2;229;231;235m';   // gray-100 (gray-white)
const gray = '\x1b[90m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';

const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";
const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding." +
  "You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question." +
  "**Absolute paths only**" +
  "**Proactiveness**";
const CLI_HOME_DIR = resolve(homedir());
const WORKSPACE_PROTECTION_ENABLED = false;
const PROTECTED_WORKSPACE_ROOT = resolve(process.cwd());
const ALLOWED_MEMORY_ROOT = resolve(CLI_HOME_DIR, ".hakathone", "store");
const CODEX_MCP_DISABLE_OVERRIDES = [
  "-c",
  "mcp_servers.supabase-2.enabled=false",
];

function isWithinPath(parentPath: string, targetPath: string): boolean {
  const rel = relative(parentPath, targetPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolvePathFromInput(pathInput: string): string {
  const trimmed = pathInput.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) {
    throw new Error("Path is empty.");
  }
  if (trimmed === "~") {
    return CLI_HOME_DIR;
  }
  if (trimmed.startsWith("~/")) {
    return resolve(CLI_HOME_DIR, trimmed.slice(2));
  }
  if (isAbsolute(trimmed)) {
    return resolve(trimmed);
  }
  return resolve(process.cwd(), trimmed);
}

function isProtectedWorkspacePath(targetPath: string): boolean {
  if (!WORKSPACE_PROTECTION_ENABLED) {
    return false;
  }
  const normalized = resolve(targetPath);
  return isWithinPath(PROTECTED_WORKSPACE_ROOT, normalized);
}

function hasWriteIntentText(input: string): boolean {
  const lower = input.toLowerCase();
  return /\b(create|make|build|write|save|append|move|copy|delete|remove|edit|modify|update|mkdir|touch|mv|cp|rm)\b/.test(
    lower,
  );
}

function referencesProtectedWorkspaceWriteIntent(input: string): boolean {
  if (!WORKSPACE_PROTECTION_ENABLED) {
    return false;
  }
  const trimmed = input.trim();
  const looksActionable =
    /^(?:please\s+)?(?:create|make|build|write|save|append|move|copy|delete|remove|edit|modify|update|mkdir|touch|mv|cp|rm|setup|install|fix|run|execute|koro|kor|banaw|banao|toiri|chalao|cholao|chalaw)\b/i
      .test(trimmed) ||
    /^\/(?:fs|cmd|run|command|shell)\b/i.test(trimmed);
  if (!looksActionable) {
    return false;
  }
  if (!hasWriteIntentText(input)) {
    return false;
  }

  const tokens = extractPathTokens(input);
  for (const token of tokens) {
    try {
      const resolvedTarget = resolvePathFromInput(token);
      if (isProtectedWorkspacePath(resolvedTarget)) {
        return true;
      }
    } catch {
      continue;
    }
  }

  const lower = input.toLowerCase();
  return lower.includes(PROTECTED_WORKSPACE_ROOT.toLowerCase());
}

function extractPathTokens(input: string): string[] {
  const tokens = input.match(/(["'](?:[^"']+)["']|~\/[^\s"']+|\/[^\s"']+|\.\.?\/[^\s"']+)/g);
  return tokens ? tokens.map((token) => token.trim()) : [];
}

function commandTouchesProtectedWorkspace(command: string): boolean {
  if (!WORKSPACE_PROTECTION_ENABLED) {
    return false;
  }
  // Keep protected workspace readable, but block write-like shell operations there.
  return commandWritesRestrictedWorkspace(command);
}

function isWorkspacePath(targetPath: string): boolean {
  return isWithinPath(PROTECTED_WORKSPACE_ROOT, resolve(targetPath));
}

function isAllowedWorkspaceWritePath(targetPath: string): boolean {
  const normalized = resolve(targetPath);
  if (!isWorkspacePath(normalized)) {
    return true;
  }
  return false;
}

function isWriteLikeFsIntentKind(kind: string): boolean {
  return kind === "create-folder" || kind === "create-file" || kind === "write-file";
}

function hasExplicitDownloadPermission(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("allow download") ||
    lower.includes("download allowed") ||
    lower.includes("onumoti download") ||
    lower.includes("download onumoti") ||
    lower.includes("download permission") ||
    lower.includes("ডাউনলোড অনুমতি") ||
    lower.includes("download korte paro")
  );
}

function isDownloadLikeCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return (
    /\bcurl\b/.test(lower) ||
    /\bwget\b/.test(lower) ||
    /\bgit\s+clone\b/.test(lower)
  );
}

function isInstallLikeCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return (
    /\bnpm\s+install\b/.test(lower) ||
    /\bpnpm\s+add\b/.test(lower) ||
    /\byarn\s+add\b/.test(lower) ||
    /\bbun\s+add\b/.test(lower) ||
    /\bpip(?:3)?\s+install\b/.test(lower) ||
    /\bapt(?:-get)?\s+install\b/.test(lower) ||
    /\bdnf\s+install\b/.test(lower) ||
    /\byum\s+install\b/.test(lower) ||
    /\bpacman\s+-S\b/.test(lower)
  );
}

function isLikelyUrlToken(token: string): boolean {
  const cleaned = token.replace(/^["']|["']$/g, "");
  return /^\/\/[a-z0-9.-]+(?:\/.*)?$/i.test(cleaned);
}

function isHarmfulCommand(command: string): boolean {
  const lower = command.toLowerCase();
  const patterns: RegExp[] = [
    /\brm\s+-rf\s+\/\b/,
    /\brm\s+-rf\s+--no-preserve-root\b/,
    /\bmkfs(\.\w+)?\b/,
    /\bwipefs\b/,
    /\bfdisk\b/,
    /\bparted\b/,
    /\bdd\s+if=/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bpoweroff\b/,
    /\bhalt\b/,
    /\binit\s+[06]\b/,
    /:\(\)\s*\{\s*:\|\:&\s*\};:/,
    /\bchmod\s+-r\s+777\s+\/\b/,
    /\bchown\s+-r\s+root\b/,
    /\bcurl\b.*\|\s*(bash|sh)\b/,
    /\bwget\b.*\|\s*(bash|sh)\b/,
    /\bbash\s*<\(\s*curl\b/,
    /\bsh\s*<\(\s*curl\b/,
  ];
  return patterns.some((pattern) => pattern.test(lower));
}

function isReadOnlyShellCommand(command: string): boolean {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return false;
  if (/[><]|>>|<<|\|\s*tee\b/.test(trimmed)) return false;
  if (/\b(mkdir|touch|mv|cp|rm|chmod|chown|sed\s+-i|perl\s+-i|truncate|dd)\b/.test(lower)) return false;

  const first = lower.split(/\s+/)[0];
  const readonlyHeads = new Set([
    "ls",
    "pwd",
    "cat",
    "head",
    "tail",
    "sed",
    "rg",
    "grep",
    "find",
    "stat",
    "du",
    "df",
    "ps",
    "top",
    "htop",
    "env",
    "whoami",
    "date",
    "uname",
    "git",
    "sqlite3",
  ]);
  if (!readonlyHeads.has(first)) return false;

  if (first === "git") {
    return /\bgit\s+(status|log|show|diff|branch|remote|rev-parse)\b/.test(lower);
  }
  return true;
}

function commandWritesRestrictedWorkspace(command: string): boolean {
  if (!WORKSPACE_PROTECTION_ENABLED) {
    return false;
  }
  const lower = command.toLowerCase();
  const hasWriteVerb = /\b(mkdir|touch|mv|cp|rm|chmod|chown|sed\s+-i|perl\s+-i|tee|truncate|dd)\b/.test(lower) ||
    /[><]|>>|<<|\|\s*tee\b/.test(command);
  if (!hasWriteVerb) return false;

  const tokens = extractPathTokens(command);
  if (!tokens.length) {
    return false;
  }

  for (const token of tokens) {
    try {
      if (isLikelyUrlToken(token)) {
        continue;
      }
      const resolvedTarget = resolvePathFromInput(token);
      if (isWorkspacePath(resolvedTarget) && !isAllowedWorkspaceWritePath(resolvedTarget)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

function commandReadsOutsideAllowedRoots(command: string): boolean {
  // Outside protected workspace is allowed by policy.
  // Keep function for backward compatibility with existing call sites.
  return false;
}

function renderReadOnlyPolicyHint(): void {
  console.log(`${red}Blocked:${reset} Read-only mode is active for this workspace.`);
  console.log(`${gray}Protected workspace:${reset} ${white}${PROTECTED_WORKSPACE_ROOT}${reset}`);
  console.log(`${gray}Any write/create/move/delete inside this workspace is blocked.${reset}`);
  console.log(`${gray}Outside this workspace, operations are allowed by policy.${reset}`);
  console.log("");
}

async function ensureRuntimeGuardrails(): Promise<void> {
  // Guardrails are policy-driven; no workspace folder bootstrap is required.
  return;
}

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type ActiveRouteInfo = {
  provider: AiRouteCandidate["provider"];
  modelId: string;
  modelName: string;
  contextWindow: number;
};

type ChatFlowMode = "chat" | "command-summary";

type ChatWithAiOptions = {
  mode?: ChatFlowMode;
  saveUserMessage?: string;
};

const usageByModel = new Map<string, TokenUsage>();
let currentRouteInfo: ActiveRouteInfo | null = null;
let activeAgentResponseLabel: string | null = null;
let showPromptMetrics = false;
const providerFailureCooldownUntil = new Map<AiRouteCandidate["provider"], number>();
const PROVIDER_COOLDOWN_MS = 2 * 60 * 1000;

function prioritizeHealthyCandidates(candidates: AiRouteCandidate[]): AiRouteCandidate[] {
  const now = Date.now();
  return [...candidates].sort((a, b) => {
    const aCooling = (providerFailureCooldownUntil.get(a.provider) || 0) > now ? 1 : 0;
    const bCooling = (providerFailureCooldownUntil.get(b.provider) || 0) > now ? 1 : 0;
    return aCooling - bCooling;
  });
}

type ExecutorLogSource = "stdout" | "stderr" | "system";

type ExecutorLogEvent = {
  at: number;
  source: ExecutorLogSource;
  summary: string;
  detail: string;
};

type ExecutorLogSession = {
  id: string;
  actor: string;
  objective: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "completed" | "failed";
  events: ExecutorLogEvent[];
  resultSummary?: string;
  errorMessage?: string;
};

let activeExecutorLogSession: ExecutorLogSession | null = null;
let lastExecutorLogSession: ExecutorLogSession | null = null;

function clampInline(value: string, maxChars: number): string {
  const normalized = stripAnsi(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function beginExecutorLogSession(actor: string, objective: string): void {
  const session: ExecutorLogSession = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    actor,
    objective: objective.trim(),
    startedAt: Date.now(),
    status: "running",
    events: [],
  };

  activeExecutorLogSession = session;
  lastExecutorLogSession = session;
  recordExecutorLogEvent("system", "session started", `Objective: ${clampInline(objective, 260)}`);
}

function recordExecutorLogEvent(source: ExecutorLogSource, summary: string, detail: string): void {
  if (!activeExecutorLogSession) {
    return;
  }

  const normalizedSummary = clampInline(summary || "processing task", 120);
  const normalizedDetail = clampInline(detail || summary, 260);
  if (!normalizedDetail) {
    return;
  }

  const last = activeExecutorLogSession.events[activeExecutorLogSession.events.length - 1];
  if (
    last &&
    last.summary === normalizedSummary &&
    last.detail === normalizedDetail &&
    Date.now() - last.at < 800
  ) {
    return;
  }

  activeExecutorLogSession.events.push({
    at: Date.now(),
    source,
    summary: normalizedSummary,
    detail: normalizedDetail,
  });

  if (activeExecutorLogSession.events.length > 320) {
    activeExecutorLogSession.events.shift();
  }
}

function completeExecutorLogSession(resultSummary: string): void {
  if (!activeExecutorLogSession) {
    return;
  }
  activeExecutorLogSession.status = "completed";
  activeExecutorLogSession.finishedAt = Date.now();
  activeExecutorLogSession.resultSummary = clampInline(resultSummary, 260);
  lastExecutorLogSession = activeExecutorLogSession;
  activeExecutorLogSession = null;
}

function failExecutorLogSession(errorMessage: string): void {
  if (!activeExecutorLogSession) {
    return;
  }
  activeExecutorLogSession.status = "failed";
  activeExecutorLogSession.finishedAt = Date.now();
  activeExecutorLogSession.errorMessage = clampInline(errorMessage, 260);
  lastExecutorLogSession = activeExecutorLogSession;
  activeExecutorLogSession = null;
}

function formatClockTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString("en-US", { hour12: false });
}

function printExecutorLogSession(showAll = false): void {
  if (!lastExecutorLogSession) {
    console.log(`${gray}No System Executor history found yet.${reset}`);
    console.log("");
    return;
  }

  const session = lastExecutorLogSession;
  const finishedAt = session.finishedAt ?? Date.now();
  const duration = formatDurationMs(Math.max(0, finishedAt - session.startedAt));
  const totalEvents = session.events.length;
  const maxVisible = showAll ? totalEvents : 60;
  const startIndex = Math.max(0, totalEvents - maxVisible);

  console.log(`\n${white}System Executor Details${reset}`);
  console.log(
    `${gray}Run:${reset} ${white}${session.id}${reset} ${gray}| Status:${reset} ${white}${session.status}${reset} ${gray}| Actor:${reset} ${white}${session.actor}${reset} ${gray}| Duration:${reset} ${white}${duration}${reset}`,
  );
  console.log(`${gray}Objective:${reset} ${white}${clampInline(session.objective, 220)}${reset}`);

  if (!showAll && totalEvents > maxVisible) {
    console.log(`${gray}Showing latest ${maxVisible} of ${totalEvents} events. Use /executor all for full log.${reset}`);
  }

  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);

  if (!totalEvents) {
    console.log(`${gray}No step logs captured for this run.${reset}`);
  } else {
    for (let i = startIndex; i < totalEvents; i += 1) {
      const event = session.events[i];
      const step = String(i + 1).padStart(3, " ");
      const source = event.source.toUpperCase().padEnd(6, " ");
      console.log(`${gray}${step}${reset} ${gray}[${formatClockTimestamp(event.at)}]${reset} ${white}${event.summary}${reset}`);
      console.log(`${gray}    ${source}${reset} ${event.detail}`);
    }
  }

  if (session.resultSummary) {
    console.log(`${gray}Result:${reset} ${white}${session.resultSummary}${reset}`);
  }
  if (session.errorMessage) {
    console.log(`${red}Error:${reset} ${white}${session.errorMessage}${reset}`);
  }
  console.log("");
}

function estimateTokens(text: string): number {
  const raw = Math.ceil((text || "").length / 4);
  return Math.max(1, raw);
}

function getUsageKey(info: ActiveRouteInfo): string {
  return `${info.provider}:${info.modelId}`;
}

function recordUsage(info: ActiveRouteInfo, usage: TokenUsage): void {
  const key = getUsageKey(info);
  const existing = usageByModel.get(key) || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const merged = {
    promptTokens: existing.promptTokens + usage.promptTokens,
    completionTokens: existing.completionTokens + usage.completionTokens,
    totalTokens: existing.totalTokens + usage.totalTokens,
  };
  usageByModel.set(key, merged);
}

function normalizeUsage(raw: any): TokenUsage | undefined {
  const prompt = raw?.prompt_tokens ?? raw?.input_tokens;
  const completion = raw?.completion_tokens ?? raw?.output_tokens;
  const total = raw?.total_tokens;

  if (Number.isFinite(prompt) || Number.isFinite(completion) || Number.isFinite(total)) {
    const promptTokens = Number.isFinite(prompt) ? Number(prompt) : 0;
    const completionTokens = Number.isFinite(completion) ? Number(completion) : 0;
    const totalTokens =
      Number.isFinite(total) ? Number(total) : Math.max(0, promptTokens + completionTokens);
    return {
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  return undefined;
}

function buildEstimatedUsage(prompt: string, completion: string): TokenUsage {
  const promptTokens = estimateTokens(prompt);
  const completionTokens = estimateTokens(completion);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function stripLeadingWhitespace(value: string): string {
  return value.replace(/^\s+/, "");
}

function toPlainTerminalText(value: string): string {
  return simplifyChatAnswer(value, { keepLineBreaks: true });
}

function providerDisplayName(provider: AiRouteCandidate["provider"]): string {
  if (provider === "qwen") return "Qwen";
  if (provider === "minimax") return "MiniMax";
  if (provider === "codex") return "Codex";
  if (provider === "antigravity") return "Antigravity";
  if (provider === "openrouter") return "OpenRouter";
  return "Kilo";
}

function normalizeModelNameForLabel(modelName: string): string {
  const normalized = modelName.replace(/^[^:]+:\s*/, "").trim();
  return normalized || modelName;
}

function buildProviderModelLabel(
  provider: AiRouteCandidate["provider"],
  modelName: string,
): string {
  if (activeAgentResponseLabel) {
    return activeAgentResponseLabel;
  }
  return `${providerDisplayName(provider)}: ${normalizeModelNameForLabel(modelName)}`;
}

async function writeChunkLive(chunk: string): Promise<void> {
  if (!chunk) return;
  process.stdout.write(chunk);
}

async function printModelResponseLive(modelName: string, text: string): Promise<string> {
  const normalized = toPlainTerminalText(stripLeadingWhitespace(text || "")) || "No response from AI";
  process.stdout.write(`${cyan}${modelName}${reset} ${white}> ${reset}${white}`);
  await writeChunkLive(normalized);
  process.stdout.write(`${reset}\n`);
  return normalized;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

function extractProgressLines(chunk: string): string[] {
  return stripAnsi(chunk)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function shouldIgnoreCliProgressLine(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  return normalized === "--------" || normalized === "exec" || normalized === "codex" || normalized === "user";
}

function extractShellCommandFromProgress(line: string): string | null {
  const match = line.match(/\/bin\/bash\s+-lc\s+(['"])([\s\S]+?)\1/);
  if (match?.[2]) {
    return match[2].trim();
  }
  const fallback = line.match(/\b(?:bash|sh|zsh)\s+-lc\s+(['"])([\s\S]+?)\1/);
  return fallback?.[2]?.trim() || null;
}

function summarizeExecutorProgressLine(line: string, source: "stdout" | "stderr"): string {
  const lower = line.toLowerCase();
  const shellCommand = extractShellCommandFromProgress(line);

  if (lower.includes("starting system executor") || lower.includes("starting codex process")) {
    return "starting runtime";
  }
  if (lower.includes("planning todo steps")) {
    return "planning steps";
  }
  if (lower.includes("finalizing system executor output") || lower.includes("finalizing codex output")) {
    return "finalizing response";
  }
  if (lower.includes("mcp:")) {
    return "checking MCP tools";
  }
  if (lower.includes("todo step")) {
    return "executing todo step";
  }
  if (lower.includes("searched:") || lower.includes("search ")) {
    return "searching web sources";
  }
  if (shellCommand) {
    return `running command: ${clampInline(shellCommand, 72)}`;
  }
  if (/\b(cat\s+>|tee\b|>>)\b/.test(lower) || /\b(created|updated|written|saved|write)\b/.test(lower)) {
    return "writing files";
  }
  if (/\b(ls|cat|sed|head|tail|find|rg|grep|awk)\b/.test(lower)) {
    return "reading files";
  }
  if (/\b(apply_patch|patch)\b/.test(lower)) {
    return "applying patch";
  }
  if (/\b(failed|error|permission denied)\b/.test(lower)) {
    return "handling error";
  }
  if (/\b(done|completed|succeeded)\b/.test(lower)) {
    return "step completed";
  }
  if (/\b(thinking|planning|reasoning)\b/.test(lower)) {
    return "thinking";
  }

  return source === "stderr" ? "processing task" : "processing output";
}

function iconForExecutorSummary(summary: string): string {
  const lower = summary.toLowerCase();
  if (lower.includes("running command")) return "[CMD]";
  if (lower.includes("searching web")) return "[WEB]";
  if (lower.includes("reading files")) return "[READ]";
  if (lower.includes("writing files")) return "[WRITE]";
  if (lower.includes("applying patch")) return "[PATCH]";
  if (lower.includes("planning")) return "[PLAN]";
  if (lower.includes("mcp")) return "[MCP]";
  if (lower.includes("finalizing")) return "[DONE]";
  if (lower.includes("error") || lower.includes("failed")) return "[ERR]";
  if (lower.includes("thinking")) return "[THINK]";
  return "[WORK]";
}

function formatExecutorLiveSummary(summary: string): string {
  return `${iconForExecutorSummary(summary)} ${summary}`;
}

function formatExecutorLiveDetail(summary: string, rawLine: string): string {
  const normalized = clampInline(rawLine, 180);
  const lowerSummary = summary.toLowerCase();
  const shellCommand = extractShellCommandFromProgress(rawLine);

  if (shellCommand) {
    return clampInline(shellCommand, 150);
  }
  if (lowerSummary.includes("searching web")) {
    const match = rawLine.match(/searched:\s*(.+)$/i);
    if (match?.[1]) return clampInline(match[1], 150);
  }
  if (lowerSummary.includes("reading files") || lowerSummary.includes("writing files")) {
    const pathMatch = rawLine.match(/(\/[^\s"']+)/);
    if (pathMatch?.[1]) return clampInline(pathMatch[1], 150);
  }
  return normalized;
}

function trimToMaxChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[output truncated]`;
}

function formatDurationMs(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function buildCommandSummaryPrompt(
  command: string,
  exitCode: number | null,
  durationMs: number,
  rawOutput: string,
): string {
  const normalizedOutput = trimToMaxChars(stripAnsi(rawOutput).trim() || "(no output)", 9000);
  const status = exitCode === 0 ? "success" : `failed (exit ${exitCode ?? "unknown"})`;

  return [
    "You are a CLI assistant. Summarize this executed command result for the user.",
    "Keep it concise and practical.",
    "Output rules: plain terminal text only. No markdown (#, **, *, -, code fences).",
    "",
    `Command: ${command}`,
    `Status: ${status}`,
    `Duration: ${formatDurationMs(durationMs)}`,
    "",
    "Output:",
    "```text",
    normalizedOutput,
    "```",
    "",
    "Return:",
    "1) What happened",
    "2) If failed: exact next command to fix",
    "3) If success: important value/result",
  ].join("\n");
}

function withTerminalStyleInstruction(message: string): string {
  return [
    message,
    "",
    "Response style:",
    "- Plain terminal text only, no markdown",
    "- Do only what the user asked; no extra tasks",
    "- Keep output minimal",
    "- Never claim file/folder/terminal actions were completed unless actually executed in this run",
    "- If not executed, explicitly say not executed",
    "- If task completed, reply in a short, concrete line about what was completed",
  ].join("\n");
}

function formatAgentPlanSummary(plan: ActiveAgentPlan): string {
  const workerLabel = plan.workerAgents.length
    ? plan.workerAgents.map((agent) => agent.name).join(", ")
    : "none";
  return `mode=${plan.mode} | main=${plan.mainAgent.name} | workers=${workerLabel}`;
}

function roleActivityStatus(role: string, isMain = false): string {
  if (isMain) {
    return "Orchestrating sub-agents and preparing refined final response";
  }
  if (role === "developer") {
    return "Handling coding, CLI, and execution steps";
  }
  if (role === "researcher") {
    return "Collecting facts, analysis, and comparisons";
  }
  if (role === "designer") {
    return "Preparing UI/UX structure and visual decisions";
  }
  return "Working on assigned task segment";
}

function workerCompletedStatus(workerName: string, mainName: string): string {
  return `Completed task and sent output to ${mainName}`;
}

function sdkLabelForProvider(provider: AiRouteCandidate["provider"]): string {
  if (provider === "qwen") return "Qwen Chat API (SSE)";
  if (provider === "openrouter") return "OpenRouter Chat Completions API";
  if (provider === "kilo") return "Kilo OpenAI-compatible API";
  if (provider === "minimax") return "MiniMax Messages API";
  if (provider === "antigravity") return "Antigravity streamGenerateContent API";
  return "Codex CLI SDK";
}

function inferToolSignals(message: string): string {
  const lower = message.toLowerCase();
  const signals: string[] = [];
  if (lower.includes("firecrawl")) signals.push("Firecrawl");
  if (lower.includes("/browser") || lower.includes("browser-use") || lower.includes("browser")) {
    signals.push("Browser-Use");
  }
  if (lower.includes("/telegram") || lower.includes("telegram")) signals.push("Telegram");
  if (lower.includes("/executor") || lower.includes("executor")) signals.push("System Executor");
  return signals.length ? signals.join(", ") : "None";
}

function shouldRunParallelAgentExecution(
  message: string,
  mode: ChatFlowMode,
  plan: ActiveAgentPlan | null,
): boolean {
  if (mode !== "chat" || !plan || !plan.workerAgents.length) {
    return false;
  }

  const lower = message.toLowerCase();
  const forceSingleSignals = [
    "single model",
    "single ai",
    "one ai",
    "one model",
    "not all models",
    "auto change model",
    "auto model change",
    "ekai",
    "akta model",
    "sob model na",
    "auto ment cheneg",
  ];
  if (forceSingleSignals.some((signal) => lower.includes(signal))) {
    return false;
  }

  const parallelSignals = [
    "parallel",
    "all agents",
    "multi-agent parallel",
    "run all sub agents",
    "sobai mile",
    "eksathe sob ai",
    "aksate sob ai",
  ];
  return parallelSignals.some((signal) => lower.includes(signal));
}

type WorkerExecutionSpec = {
  worker: ActiveAgentPlan["workerAgents"][number];
  prompt: string;
  candidates: AiRouteCandidate[];
};

type WorkerExecutionResult = {
  worker: ActiveAgentPlan["workerAgents"][number];
  candidate?: AiRouteCandidate;
  output: string;
  error?: string;
};

const WORKER_FAST_TIMEOUT_MS = 45000;
const MAIN_FAST_TIMEOUT_MS = 70000;
const FAST_MAX_TOKENS = 1024;

function providerPreferenceForRole(role: string): AiRouteCandidate["provider"][] {
  if (role === "developer") {
    return ["kilo", "openrouter", "qwen", "minimax", "antigravity", "codex"];
  }
  if (role === "researcher") {
    return ["qwen", "minimax", "openrouter", "antigravity", "kilo", "codex"];
  }
  if (role === "designer") {
    return ["antigravity", "openrouter", "qwen", "kilo", "minimax", "codex"];
  }
  return ["qwen", "openrouter", "kilo", "minimax", "antigravity", "codex"];
}

function candidateUsageInfo(candidate: AiRouteCandidate): ActiveRouteInfo {
  return {
    provider: candidate.provider,
    modelId: candidate.model.id,
    modelName: candidate.model.name,
    contextWindow: candidate.model.contextWindow,
  };
}

function modelSdkLabel(candidate: AiRouteCandidate): string {
  return `${providerDisplayName(candidate.provider)} / ${candidate.model.id} | ${sdkLabelForProvider(candidate.provider)}`;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.floor(timeoutMs / 1000)}s`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function prioritizeCandidatesForWorker(
  candidates: AiRouteCandidate[],
  role: string,
  usedModelKeys: Set<string>,
  usedProviders: Set<AiRouteCandidate["provider"]>,
): AiRouteCandidate[] {
  const providerOrder = providerPreferenceForRole(role);
  const providerRank = (provider: AiRouteCandidate["provider"]) => {
    const index = providerOrder.indexOf(provider);
    return index >= 0 ? index : providerOrder.length + 1;
  };

  const sorted = [...candidates].sort((a, b) => providerRank(a.provider) - providerRank(b.provider));
  if (!sorted.length) {
    return sorted;
  }

  const uniqueCandidate = sorted.find((candidate) => {
    const key = `${candidate.provider}:${candidate.model.id}`;
    return !usedProviders.has(candidate.provider) && !usedModelKeys.has(key);
  })
    || sorted.find((candidate) => !usedProviders.has(candidate.provider))
    || sorted.find((candidate) => !usedModelKeys.has(`${candidate.provider}:${candidate.model.id}`));
  if (!uniqueCandidate) {
    return sorted;
  }

  const uniqueKey = `${uniqueCandidate.provider}:${uniqueCandidate.model.id}`;
  usedModelKeys.add(uniqueKey);
  usedProviders.add(uniqueCandidate.provider);
  return [uniqueCandidate, ...sorted.filter((candidate) => candidate !== uniqueCandidate)];
}

function buildWorkerPrompt(
  basePrompt: string,
  plan: ActiveAgentPlan,
  worker: ActiveAgentPlan["workerAgents"][number],
): string {
  return [
    "Sub-agent execution task:",
    `Main AI: ${plan.mainAgent.name}`,
    `Worker AI: ${worker.name}`,
    `Worker role: ${worker.role}`,
    `Worker instructions: ${worker.instructions}`,
    "- Focus only your assigned role and provide concrete output for main AI handoff.",
    "- Keep output structured: findings, actions, risks, and final recommendation.",
    "- FAST MODE: be concise and return only decision-critical output.",
    "- You are allowed to use available runtime tools/skills relevant to your role.",
    "- Do not wait for extra permission for safe analysis/reasoning steps.",
    "",
    "User task and runtime context:",
    basePrompt,
  ].join("\n");
}

function buildMainRefinementPrompt(
  basePrompt: string,
  plan: ActiveAgentPlan,
  workerResults: WorkerExecutionResult[],
): string {
  const lines: string[] = [
    "Main AI refinement task:",
    `Main AI: ${plan.mainAgent.name}`,
    `Main instructions: ${plan.mainAgent.instructions}`,
    "- You must refine and merge all worker outputs into one final high-quality answer.",
    "- Resolve conflicts across workers and keep only the most correct/practical solution.",
    "- Final response language must follow user's language.",
    "",
    "Original user context:",
    basePrompt,
    "",
    "Worker outputs:",
  ];

  for (const result of workerResults) {
    const status = result.error ? `failed: ${result.error}` : "completed";
    const modelInfo = result.candidate ? modelSdkLabel(result.candidate) : "no-model";
    lines.push(`[${result.worker.name}] status=${status} model=${modelInfo}`);
    lines.push(result.output || "No worker output.");
    lines.push("");
  }

  lines.push("Return only the final refined answer for the user.");
  return lines.join("\n");
}

async function executeWorkerWithFallback(
  spec: WorkerExecutionSpec,
  activity: AiLiveActivity,
): Promise<WorkerExecutionResult> {
  let lastError = "No available model for this worker.";

  for (let i = 0; i < spec.candidates.length; i += 1) {
    const candidate = spec.candidates[i];
    activity.setAgentStatus(spec.worker.name, `Running: ${modelSdkLabel(candidate)}`);

    const workerStartedAt = Date.now();
    const workerHeartbeat = setInterval(() => {
      const elapsed = Math.max(1, Math.floor((Date.now() - workerStartedAt) / 1000));
      activity.setAgentStatus(spec.worker.name, `Running (${elapsed}s): ${modelSdkLabel(candidate)}`);
    }, 4000);

    try {
      const result = await withTimeout(
        fetchRouteResponseOnce(candidate, spec.prompt, {
          fastMode: true,
          maxTokensCap: FAST_MAX_TOKENS,
        }),
        WORKER_FAST_TIMEOUT_MS,
        `${spec.worker.name} ${providerDisplayName(candidate.provider)} worker`,
      );
      const normalizedOutput = toPlainTerminalText(stripLeadingWhitespace(result.text || "")).trim() || "No response from AI.";
      const usage = result.usage || buildEstimatedUsage(spec.prompt, normalizedOutput);
      recordUsage(candidateUsageInfo(candidate), usage);
      activity.setAgentStatus(spec.worker.name, `Done: ${modelSdkLabel(candidate)}`);
      return {
        worker: spec.worker,
        candidate,
        output: normalizedOutput,
      };
    } catch (error: any) {
      const errorMessage = (error?.message || "Request failed").trim();
      lastError = errorMessage;
      const hasNext = i < spec.candidates.length - 1;
      if (!hasNext) {
        break;
      }

      activity.trace(
        `[AGENT][fallback] ${spec.worker.name} ${candidate.provider}/${candidate.model.id} failed: ${trimToMaxChars(errorMessage, 140)}`,
      );
      activity.setAgentStatus(spec.worker.name, `Fallback: switching model (${providerDisplayName(candidate.provider)})`);
      if (!shouldFallbackToNextProvider(errorMessage)) {
        // Still fallback to keep worker execution resilient across unknown failures.
        continue;
      }
    } finally {
      clearInterval(workerHeartbeat);
    }
  }

  activity.setAgentStatus(spec.worker.name, `Failed: ${trimToMaxChars(lastError, 70)}`);
  return {
    worker: spec.worker,
    output: `Worker ${spec.worker.name} failed. Error: ${lastError}`,
    error: lastError,
  };
}

async function runParallelAgentOrchestration(
  basePrompt: string,
  plan: ActiveAgentPlan,
  activity: AiLiveActivity,
): Promise<string> {
  if (!plan.workerAgents.length) {
    return buildAgentExecutionPrompt(basePrompt, plan);
  }

  activity.setAgentStatus(plan.mainAgent.name, "Planning sub-agent routing and model assignment");
  const workerPrompts = plan.workerAgents.map((worker) => ({
    worker,
    prompt: buildWorkerPrompt(basePrompt, plan, worker),
  }));

  const roleCandidateCache = new Map<string, Promise<AiRouteCandidate[]>>();
  const candidateLists = await Promise.all(
    workerPrompts.map((item) => {
      const key = item.worker.role || "default";
      if (!roleCandidateCache.has(key)) {
        roleCandidateCache.set(key, buildAiRouteCandidates(item.prompt, { ignoreSelectedOverride: true }));
      }
      return roleCandidateCache.get(key)!;
    }),
  );

  const usedModelKeys = new Set<string>();
  const usedProviders = new Set<AiRouteCandidate["provider"]>();
  const workerSpecs: WorkerExecutionSpec[] = workerPrompts.map((item, index) => ({
    worker: item.worker,
    prompt: item.prompt,
    candidates: prioritizeCandidatesForWorker(candidateLists[index] || [], item.worker.role, usedModelKeys, usedProviders),
  }));

  for (const spec of workerSpecs) {
    if (!spec.candidates.length) {
      activity.setAgentStatus(spec.worker.name, "No authenticated model available");
    } else {
      const selected = spec.candidates[0];
      activity.setAgentStatus(spec.worker.name, `Assigned: ${modelSdkLabel(selected)}`);
    }
  }

  activity.set("Thinking: running sub-agents in parallel");
  const workerResults = await Promise.all(workerSpecs.map((spec) => executeWorkerWithFallback(spec, activity)));
  const completedCount = workerResults.filter((result) => !result.error).length;
  activity.setAgentStatus(
    plan.mainAgent.name,
    `Collecting ${completedCount}/${workerResults.length} sub-agent outputs and refining final answer`,
  );
  activity.trace(`[AGENT][handoff] ${completedCount}/${workerResults.length} workers sent outputs to ${plan.mainAgent.name}`);

  return buildMainRefinementPrompt(basePrompt, plan, workerResults);
}

function disabledCliSkillPlan(): CliSkillPlan {
  return {
    enabled: false,
    mode: "disabled",
    selected: [],
    traces: [],
    catalogSize: 0,
    syncedAt: undefined,
  };
}

function withCodexExecutionPolicy(message: string): string {
  const policyLines = [
    "Execution policy for Codex:",
    "- Protected workspace is fully blocked for file/folder changes",
    "- Outside protected workspace, file/folder create/write/move/delete is allowed when task requires",
    `- Allowed memory path: ${ALLOWED_MEMORY_ROOT}`,
    "- Do not add extra work or extra features",
    "- Do not simulate completion",
    "- Never run destructive/harmful commands (rm -rf /, mkfs, dd wipe, shutdown/reboot, curl|bash, etc.)",
    "- If failed: return exact OS error and exact retry command",
    "- If success: return a short concrete completion summary (not only one word)",
  ];

  if (WORKSPACE_PROTECTION_ENABLED) {
    policyLines.push(`- Protected workspace: ${PROTECTED_WORKSPACE_ROOT}`);
    policyLines.push("- You may read inside protected workspace when needed");
    policyLines.push("- Never write/move/delete inside protected workspace");
    policyLines.push("- Outside protected workspace, read/write only what is needed for the active task");
  } else {
    policyLines.push("- Workspace protection lock is disabled");
  }

  return [
    message,
    "",
    ...policyLines,
  ].join("\n");
}

function userRequestedDoneOnly(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /\b(just|only)\s+done\b/.test(lower) ||
    /\breply\s+done\b/.test(lower) ||
    /\bshudhu\s+done\b/.test(lower) ||
    /\bdone\s+likh\b/.test(lower)
  );
}

function ensureNonTrivialCompletion(userMessage: string, responseText: string): string {
  const normalized = toPlainTerminalText(responseText || "").trim();
  const lower = normalized.toLowerCase();
  const looksTooShort =
    lower === "done" ||
    lower === "ok" ||
    lower === "okay" ||
    lower === "completed" ||
    lower === "success";

  if (!looksTooShort || userRequestedDoneOnly(userMessage)) {
    return normalized || "Completed.";
  }

  const taskHint = trimToMaxChars(userMessage.replace(/\s+/g, " ").trim(), 120);
  if (!taskHint) {
    return "Completed the requested task.";
  }
  return `Completed: ${taskHint}`;
}

function isSystemExecutionPrompt(message: string): boolean {
  const lower = message.toLowerCase();
  const trimmedLower = message.trim().toLowerCase();

  if (
    /^\/(?:cmd|run|command|shell|fs)\b/.test(trimmedLower) ||
    /^(?:!)/.test(trimmedLower)
  ) {
    return true;
  }

  if (
    /^\/browser(?:-live|-ui)?(?:\s|$)/.test(trimmedLower) ||
    /^\/browseruse(?:\s|$)/.test(trimmedLower) ||
    /^\/browser-use(?:\s|$)/.test(trimmedLower) ||
    /^browser-use\s+/.test(trimmedLower)
  ) {
    return true;
  }

  const executionWords = [
    "run",
    "execute",
    "command",
    "terminal",
    "shell",
    "bash",
    "cmd",
    "install",
    "setup",
    "fix",
    "chalao",
    "cholao",
    "chalaw",
    "koro",
    "kor",
  ];
  const systemWords = [
    "system",
    "os",
    "linux",
    "ubuntu",
    "package",
    "installed",
    "service",
    "process",
    "cpu",
    "ram",
    "disk",
    "network",
    "cli",
  ];
  const pathActionWords = [
    "create",
    "make",
    "build",
    "generate",
    "write",
    "save",
    "move",
    "copy",
    "delete",
    "remove",
    "mkdir",
    "touch",
    "banaw",
    "banao",
    "toiri",
  ];

  const hasPath =
    /\/home\//.test(lower) ||
    /(^|\s)~\//.test(lower) ||
    /(^|\s)\.\//.test(lower) ||
    /(^|\s)\.\.\//.test(lower) ||
    /[a-z0-9_.-]+\.(html|css|js|ts|tsx|md|json|txt)\b/i.test(message);

  const hasPathWriteIntent = hasPath && pathActionWords.some((word) => lower.includes(word));
  const asksExecutionDirectly =
    executionWords.some((word) => lower.includes(word)) &&
    (systemWords.some((word) => lower.includes(word)) || /\binstalled apps?\b/.test(lower));
  const hasCommandLikeSnippet =
    /(^|\s)(ls|pwd|cd|git|npm|npx|bun|pnpm|yarn|python|node|docker|kubectl|cat|grep|rg|find|mkdir|touch|cp|mv|rm)\b/i.test(
      message,
    );
  const asksForInventory = /\b(list|show|display|check|chek|status|version|ki ki)\b/.test(lower) &&
    /\b(installed|app|application|package|software|tool|cli)\b/.test(lower);
  const installedInventoryHint =
    /\b(installed|install)\b/.test(lower) &&
    /\b(app|application|package|software|cli|tool|command)\b/.test(lower);

  return (
    hasPathWriteIntent ||
    hasCommandLikeSnippet ||
    asksExecutionDirectly ||
    asksForInventory ||
    installedInventoryHint
  );
}

function shouldUseTodoOrchestration(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (/^\/executor\b/.test(lower) && /\b(todo|plan)\b/.test(lower)) {
    return true;
  }
  return (
    /\b(todo|to-do|step by step|step-by-step|execution plan|plan file|workflow-execute-plans)\b/.test(lower) &&
    /\b(run|execute|koro|kor|chalao|cholao|chalaw)\b/.test(lower)
  );
}

function inferDirectSystemCommand(message: string): { command: string; label: string } | null {
  const lower = message.toLowerCase();

  const asksInstalledApps =
    (
      /\binstalled apps?\b/.test(lower) ||
      /\blist installed apps?\b/.test(lower) ||
      /\bshow installed apps?\b/.test(lower) ||
      /\binstalled applications?\b/.test(lower) ||
      /\bapp list\b/.test(lower) ||
      /\bsoftware list\b/.test(lower)
    ) &&
    /\b(app|apps|application|applications|software|package|packages)\b/.test(lower);
  if (asksInstalledApps) {
    return {
      label: "Installed application list",
      command:
        'if command -v apt >/dev/null 2>&1; then apt list --installed 2>/dev/null | sed -n "1,220p"; ' +
        'elif command -v dpkg >/dev/null 2>&1; then dpkg -l | sed -n "1,220p"; ' +
        'elif command -v rpm >/dev/null 2>&1; then rpm -qa | sed -n "1,220p"; ' +
        'else echo "No supported package manager found."; fi',
    };
  }

  const asksAiCli =
    /\b(ai cli|cli tools|ai tools)\b/.test(lower) &&
    /\b(installed|list|show|check|chek|version)\b/.test(lower);
  if (asksAiCli) {
    return {
      label: "Installed AI CLI tools",
      command:
        'for c in codex gemini openai q qchat claude aider; do ' +
        'if command -v "$c" >/dev/null 2>&1; then ' +
        'v="$($c --version 2>/dev/null | head -1)"; ' +
        'printf "%s: %s\\n" "$c" "${v:-installed}"; fi; done',
    };
  }

  const asksPythonNodeVersion =
    /\b(python|node|nodejs|version)\b/.test(lower) &&
    /\b(check|chek|show|list|what|koto|version)\b/.test(lower);
  if (asksPythonNodeVersion) {
    return {
      label: "Runtime versions",
      command:
        'python3 --version 2>/dev/null; node --version 2>/dev/null',
    };
  }

  return null;
}

function normalizeBrowserProfileToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractRequestedBrowserProfileHint(message: string): string | null {
  const text = message.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const quoted = text.match(/["'`]([^"'`]{2,48})["'`]/);
  if (quoted?.[1]) {
    const q = quoted[1].trim();
    if (/\b(ai[\s\-_]?\d+|profile[\s\-_]*\d+|default)\b/i.test(q)) {
      return q;
    }
  }

  const aiMatch = lower.match(/\bai[\s\-_]?(\d{1,2})\b/);
  if (aiMatch?.[1]) {
    return `ai-${aiMatch[1]}`;
  }

  const profileMatch = lower.match(/\bprofile[\s\-_]*(\d{1,2})\b/);
  if (profileMatch?.[1]) {
    return `profile ${profileMatch[1]}`;
  }

  const wantsDefault =
    /\bdefault\b/.test(lower) &&
    /\b(profile|pofile|profiel|browser|brwsher|brwser|chrome)\b/.test(lower);
  if (wantsDefault) {
    return "default";
  }

  return null;
}

function isBrowserProfileSelectionOnlyPrompt(message: string): boolean {
  const lower = message.toLowerCase();
  const mentionsBrowser = /\b(browser|brwsher|brwser|chrome)\b/.test(lower);
  const mentionsUseAction = /\b(use|us|set|select|slect|lock|koro|korbo|korte)\b/.test(lower);
  const mentionsProfileSignal = /\b(profile|pofile|profiel|default|ai[\s\-_]?\d+)\b/.test(lower);
  const mentionsWorkTask = /\b(open|check|chek|find|search|collect|summary|gmail|amazon|tab|history|run|task)\b/.test(lower);
  return mentionsBrowser && mentionsUseAction && mentionsProfileSignal && !mentionsWorkTask;
}

function scoreBrowserProfileOption(option: BrowserProfileOption, hint: string): number {
  const normalizedHint = normalizeBrowserProfileToken(hint);
  if (!normalizedHint) return 0;

  const normalizedCandidates = new Set<string>([normalizedHint]);
  const aiMatch = normalizedHint.match(/^ai(\d{1,2})$/);
  if (aiMatch?.[1]) {
    normalizedCandidates.add(`profile${aiMatch[1]}`);
  }
  const profileMatch = normalizedHint.match(/^profile(\d{1,2})$/);
  if (profileMatch?.[1]) {
    normalizedCandidates.add(`ai${profileMatch[1]}`);
  }

  const rawTerms = [
    option.id,
    option.label,
    option.description,
    option.profileName || "",
    option.sessionName || "",
  ].filter(Boolean);
  if (option.id.startsWith("managed:")) {
    rawTerms.push(option.id.slice("managed:".length));
  }
  if (option.id.startsWith("system:")) {
    const parts = option.id.split(":");
    if (parts.length >= 3) {
      rawTerms.push(parts.slice(2).join(":"));
    }
  }

  const normalizedTerms = rawTerms
    .map((term) => normalizeBrowserProfileToken(term))
    .filter(Boolean);

  let best = 0;
  for (const candidate of normalizedCandidates) {
    for (const term of normalizedTerms) {
      if (term === candidate) {
        best = Math.max(best, 100);
      } else if (term.startsWith(candidate) || candidate.startsWith(term)) {
        best = Math.max(best, 80);
      } else if (term.includes(candidate) || candidate.includes(term)) {
        best = Math.max(best, 60);
      }
    }
  }

  if (normalizedCandidates.has("default") && option.profileName === "Default") {
    best = Math.max(best, 95);
  }

  return best;
}

async function resolveRequestedBrowserProfileFromMessage(
  message: string,
): Promise<{ hint: string; option: BrowserProfileOption | null }> {
  const hint = extractRequestedBrowserProfileHint(message);
  if (!hint) {
    return { hint: "", option: null };
  }

  const options = await listBrowserProfileOptions();
  if (!options.length) {
    return { hint, option: null };
  }

  let bestOption: BrowserProfileOption | null = null;
  let bestScore = 0;
  for (const option of options) {
    const score = scoreBrowserProfileOption(option, hint);
    if (score > bestScore) {
      bestScore = score;
      bestOption = option;
    }
  }

  if (bestScore < 60) {
    return { hint, option: null };
  }

  return { hint, option: bestOption };
}

async function runDirectSystemCommand(command: string): Promise<string> {
  const result = await runShellCommand(command);
  const normalized = trimToMaxChars(stripAnsi(result.output || "").trim(), 7000);

  if (result.exitCode !== 0) {
    throw new Error(normalized || `Command failed with exit code ${result.exitCode ?? "unknown"}`);
  }

  return normalized || "Completed.";
}

type DirectSystemCommand = {
  command: string;
  label: string;
  note?: string;
};

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function hasLongFlag(rawArgs: string, flag: string): boolean {
  const pattern = new RegExp(`(^|\\s)--${flag}(\\s|=)`);
  return pattern.test(rawArgs);
}

function normalizeBrowserUseModelHint(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return "gpt-4o-mini";

  const withoutProviderPrefix = trimmed.includes("/")
    ? trimmed.split("/").slice(1).join("/")
    : trimmed;
  const canonical = withoutProviderPrefix
    .split(":")[0]
    .replace(/^models\//i, "")
    .replace(/_/g, "-")
    .toLowerCase();

  const claudeIndex = canonical.indexOf("claude");
  if (claudeIndex >= 0) {
    return canonical.slice(claudeIndex);
  }

  const geminiIndex = canonical.indexOf("gemini");
  if (geminiIndex >= 0) {
    return canonical.slice(geminiIndex);
  }

  const gptIndex = canonical.indexOf("gpt-");
  if (gptIndex >= 0) {
    return canonical.slice(gptIndex);
  }

  if (canonical.startsWith("o1") || canonical.startsWith("o3") || canonical.startsWith("o4")) {
    return "gpt-4o-mini";
  }

  return "gpt-4o-mini";
}

async function loadCodexApiKeyFromAuthFile(): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    const authPath = resolve(CLI_HOME_DIR, ".codex", "auth.json");
    const raw = await fs.readFile(authPath, "utf-8");
    const parsed = JSON.parse(raw) as { OPENAI_API_KEY?: string };
    const key = parsed.OPENAI_API_KEY?.trim();
    return key || null;
  } catch {
    return null;
  }
}

async function detectPreferredChromeProfileName(): Promise<string | undefined> {
  const fs = await import("node:fs/promises");
  const chromeRoot = resolve(CLI_HOME_DIR, ".config", "google-chrome");
  const chromiumRoot = resolve(CLI_HOME_DIR, ".config", "chromium");

  const candidates: Array<{ profileName: string; historyPath: string }> = [];

  try {
    const entries = await fs.readdir(chromeRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (!(name === "Default" || /^Profile \d+$/i.test(name))) continue;
      const historyPath = resolve(chromeRoot, name, "History");
      try {
        const stat = await fs.stat(historyPath);
        if (stat.isFile()) {
          candidates.push({ profileName: name, historyPath });
        }
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }

  try {
    const chromiumHistory = resolve(chromiumRoot, "Default", "History");
    const stat = await fs.stat(chromiumHistory);
    if (stat.isFile() && candidates.length === 0) {
      return "Default";
    }
  } catch {
    // ignore
  }

  if (!candidates.length) return undefined;
  if (candidates.some((item) => item.profileName === "Default")) {
    return "Default";
  }

  let latest: { profileName: string; mtimeMs: number } | null = null;
  for (const item of candidates) {
    try {
      const stat = await fs.stat(item.historyPath);
      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = { profileName: item.profileName, mtimeMs: stat.mtimeMs };
      }
    } catch {
      continue;
    }
  }
  return latest?.profileName;
}

function buildTabHistoryReportShellCommand(profileName?: string): string {
  const profileLiteral = profileName ? shellSingleQuote(profileName) : "''";
  return `bash <<'BASH'
set -u
BU="$HOME/.hakathone/browser-use/.venv/bin/browser-use"
if [ ! -x "$BU" ]; then
  echo "browser-use not installed at $BU"
  exit 1
fi
PROFILE=${profileLiteral}
SESSION="khalid_tab_report_$$"

run_cmd() {
  if [ -n "$PROFILE" ]; then
    "$BU" --browser real --headed --session "$SESSION" --profile "$PROFILE" "$@"
  else
    "$BU" --browser real --headed --session "$SESSION" "$@"
  fi
}

run_bu() {
  local out=""
  local rc=1
  local attempt
  for attempt in 1 2 3; do
    out="$(run_cmd "$@" 2>&1)"
    rc=$?
    if [ $rc -eq 0 ]; then
      printf "%s" "$out"
      return 0
    fi
    sleep 0.25
  done
  printf "%s" "$out"
  return $rc
}

echo "Open tabs (personal browser):"
if [ -n "$PROFILE" ]; then
  echo "- Profile: $PROFILE"
fi
# Warm up the same live session once, then keep all commands on this session.
run_bu state >/dev/null 2>&1 || true
tab_found=0
for idx in $(seq 0 20); do
  sw="$(run_bu switch "$idx")"
  sw_rc=$?

  if printf "%s" "$sw" | grep -qi "Invalid tab index"; then
    break
  fi

  if [ $sw_rc -ne 0 ] && ! printf "%s" "$sw" | grep -qi "switched:"; then
    continue
  fi

  title="$(run_bu get title | sed -n "s/^title:[[:space:]]*//p" | head -n1)"
  url="$(run_bu eval "location.href" | sed -n "s/^result:[[:space:]]*//p" | head -n1)"
  if [ -z "$url" ] || printf "%s" "$url" | grep -Eq "^(about:blank|chrome-error://|chrome://|edge://)$"; then
    continue
  fi
  [ -z "$title" ] && title="(untitled)"
  tab_found=1
  printf "[%s] %s | %s\\n" "$idx" "$title" "$url"
done

if [ "$tab_found" -eq 0 ]; then
  echo "- Could not read open tabs from the live browser bridge for this profile."
fi

echo
echo "Most used websites:"
found_history=0
for root in "$HOME/.config/google-chrome" "$HOME/.config/chromium"; do
  [ -d "$root" ] || continue
  for dir in "$root"/Default "$root"/Profile\ *; do
    [ -d "$dir" ] || continue
    hist="$dir/History"
    [ -f "$hist" ] || continue
    found_history=1
    tmp_db="$(mktemp)"
    cp "$hist" "$tmp_db" 2>/dev/null || { rm -f "$tmp_db"; continue; }
    browser_name="$(basename "$root")"
    profile_name="$(basename "$dir")"
    echo "- \${browser_name}/\${profile_name}"
    rows="$(sqlite3 -tabs "$tmp_db" "SELECT visit_count, title, url FROM urls WHERE url LIKE 'http%' ORDER BY visit_count DESC LIMIT 12;" 2>/dev/null)"
    if [ -z "$rows" ]; then
      echo "  * (no history entries)"
    else
      printf "%s\\n" "$rows" | sed -E "s/\\t/ | /g; s/^/  * /"
    fi
    rm -f "$tmp_db"
  done
done

if [ "$found_history" -eq 0 ]; then
  echo "No Chrome/Chromium history database found."
fi
BASH`;
}

async function resolveBrowserUseRuntimeCommand(intent: BrowserUseCommandIntent): Promise<DirectSystemCommand> {
  let runtimeMode = intent.browserMode;
  let selectedProfile = intent.profileName?.trim() || "";
  let selectedSession = intent.sessionName?.trim() || "";
  let selectedByPreferenceLabel = "";

  if (
    runtimeMode !== "remote" &&
    !intent.modeExplicit &&
    !selectedProfile &&
    !selectedSession
  ) {
    const preferred = await resolveBrowserRuntimeSelection();
    if (preferred) {
      runtimeMode = preferred.browserMode;
      selectedProfile = preferred.profileName?.trim() || "";
      selectedSession = preferred.sessionName?.trim() || "";
      selectedByPreferenceLabel = preferred.label;
    }
  }

  if (runtimeMode === "real" && !selectedProfile) {
    selectedProfile = (await detectPreferredChromeProfileName()) || "";
  }

  if (runtimeMode === "default") {
    if (selectedSession) {
      runtimeMode = "chromium";
    } else {
      const systemProfiles = await listSystemBrowserProfiles();
      runtimeMode = systemProfiles.length ? "real" : "chromium";
    }
  }

  if (intent.tabHistoryReport) {
    return {
      command: buildTabHistoryReportShellCommand(selectedProfile || undefined),
      label: intent.summary,
      note: selectedProfile
        ? `Collected from personal browser tabs + local Chrome/Chromium history (profile: ${selectedProfile}).`
        : "Collected from personal browser tabs + local Chrome/Chromium history.",
    };
  }

  const env: Record<string, string> = {};
  const notes: string[] = [];
  let llmModel = "gpt-4o-mini";
  let routeLabel = "auto";

  const modeLabel =
    runtimeMode === "real"
      ? "Personal Browser (real)"
      : runtimeMode === "remote"
      ? "Browser-Use Cloud (remote)"
      : runtimeMode === "chromium"
      ? "Local Chromium"
      : "Default browser mode";
  notes.push(`Browser mode: ${modeLabel}. Live UI: ${intent.liveUi ? "ON" : "OFF"}.`);
  if (selectedByPreferenceLabel) {
    notes.push(`Selected by Browser profile setting: ${selectedByPreferenceLabel}.`);
  }
  if (selectedProfile) {
    notes.push(`Profile: ${selectedProfile}.`);
  }
  if (selectedSession) {
    notes.push(`Session: ${selectedSession}.`);
  }

  const candidates = await buildAiRouteCandidates("browser-use local automation");
  const primary = candidates[0];

  if (primary) {
    routeLabel = `${providerDisplayName(primary.provider)}: ${primary.model.name}`;
    llmModel = normalizeBrowserUseModelHint(primary.model.id);

    if (primary.provider === "openrouter") {
      env.OPENAI_API_KEY = primary.token.apiKey;
      env.OPENAI_BASE_URL = primary.baseUrl;
    } else if (primary.provider === "kilo") {
      env.OPENAI_API_KEY = primary.token.apiKey;
      env.OPENAI_BASE_URL = primary.baseUrl;
    } else if (primary.provider === "qwen") {
      env.OPENAI_API_KEY = primary.token.access;
      env.OPENAI_BASE_URL = primary.baseUrl;
      notes.push("Qwen OpenAI-compatible browser-use mode is experimental.");
    } else if (primary.provider === "codex") {
      const codexApiKey = await loadCodexApiKeyFromAuthFile();
      if (codexApiKey) {
        env.OPENAI_API_KEY = codexApiKey;
        env.OPENAI_BASE_URL = "https://api.openai.com/v1";
      } else {
        notes.push("Codex is connected with ChatGPT OAuth, no OPENAI_API_KEY found in local auth file.");
      }
    } else {
      notes.push(`${providerDisplayName(primary.provider)} cannot be mapped directly to browser-use local LLM.`);
    }
  }

  if (!env.OPENAI_API_KEY) {
    const openRouter = await loadOpenRouterToken();
    if (openRouter) {
      env.OPENAI_API_KEY = openRouter.apiKey;
      env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
      notes.push("Using OpenRouter fallback for browser-use local LLM.");
    }
  }

  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY && !env.GOOGLE_API_KEY) {
    const codexApiKey = await loadCodexApiKeyFromAuthFile();
    if (codexApiKey) {
      env.OPENAI_API_KEY = codexApiKey;
      env.OPENAI_BASE_URL = "https://api.openai.com/v1";
      notes.push("Using OpenAI API key from Codex auth file as fallback.");
    }
  }

  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY && !env.GOOGLE_API_KEY) {
    const hasExistingEnvKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_API_KEY);
    if (!hasExistingEnvKey && intent.requiresLlm && !hasLongFlag(intent.rawArgs, "api-key")) {
      throw new Error(
        "No local LLM key found for browser-use. Connect OpenRouter/Kilo/Codex API key or set OPENAI_API_KEY.",
      );
    }
  }

  let runtimeArgs = intent.rawArgs;
  if (intent.requiresLlm && !hasLongFlag(runtimeArgs, "llm")) {
    runtimeArgs = `${runtimeArgs} --llm ${llmModel}`;
  }

  const topLevelFlags: string[] = [];
  topLevelFlags.push(`--browser ${runtimeMode}`);
  if (intent.headed) {
    topLevelFlags.push("--headed");
  }
  if (selectedProfile) {
    topLevelFlags.push(`--profile ${shellSingleQuote(selectedProfile)}`);
  }
  if (selectedSession) {
    topLevelFlags.push(`--session ${shellSingleQuote(selectedSession)}`);
  }

  const assignments = ['PATH="$HOME/.local/bin:$PATH"'];
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    assignments.push(`${key}=${shellSingleQuote(value)}`);
  }
  const cliArgs = [...topLevelFlags, runtimeArgs].join(" ").trim();

  return {
    command: `${assignments.join(" ")} "${BROWSER_USE_HOME}/.venv/bin/browser-use" ${cliArgs}`,
    label: `${intent.summary}${intent.requiresLlm ? ` (${routeLabel})` : ""}`,
    note: notes.join(" ").trim() || undefined,
  };
}

function parseTodoPlanTasks(rawText: string): string[] {
  const clean = stripAnsi(rawText || "").trim();
  if (!clean) return [];

  const candidates: string[] = [clean];
  const fenced = clean.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.unshift(fenced[1].trim());
  }

  const looseObject = clean.match(/\{[\s\S]*\}/);
  if (looseObject?.[0]) {
    candidates.unshift(looseObject[0].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { tasks?: Array<string | { title?: string; name?: string; task?: string }> };
      if (!Array.isArray(parsed.tasks)) continue;

      const tasks = parsed.tasks
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (typeof entry?.title === "string") return entry.title;
          if (typeof entry?.name === "string") return entry.name;
          if (typeof entry?.task === "string") return entry.task;
          return "";
        })
        .map((item) => item.trim())
        .filter(Boolean);

      const unique = Array.from(new Set(tasks.map((item) => item.toLowerCase())))
        .map((key) => tasks.find((item) => item.toLowerCase() === key) as string)
        .slice(0, 16);

      if (unique.length) {
        return unique;
      }
    } catch {
      continue;
    }
  }

  return [];
}

async function buildTodoTasksForObjective(
  objective: string,
  onProgress?: (status: string) => void,
): Promise<string[]> {
  const fallback = deriveTodoTasksFromPrompt(objective);
  try {
    onProgress?.("planning todo steps");
    const plannerPrompt = buildTodoPlannerPrompt(objective);
    const planningText = await fetchLocalSystemExecutorResponse(
      plannerPrompt,
      (status) => onProgress?.(`planner: ${status}`),
      { applyExecutionPolicy: false },
    );
    const parsed = parseTodoPlanTasks(planningText);
    if (parsed.length >= 2) {
      return parsed;
    }
  } catch (error: any) {
    onProgress?.(`planner fallback: ${error?.message || "unable to parse planner output"}`);
  }
  return fallback;
}

async function runTodoOrchestratedExecution(
  objective: string,
  activity: AiLiveActivity,
): Promise<string> {
  activity.set("Thinking: building todo plan");
  const tasks = await buildTodoTasksForObjective(objective, (status) => {
    activity.set(`[PLAN] ${status}`);
  });
  const run = await createTodoRun(objective, tasks);

  activity.set(`Thinking: todo created with ${run.tasks.length} steps`);
  recordExecutorLogEvent("system", "todo plan created", `todo run created with ${run.tasks.length} steps`);
  let lastStepOutput = "";

  for (const task of run.tasks) {
    await setTodoTaskStatus(run.runId, task.id, "in_progress", "step execution started");
    activity.set(`Thinking: step ${task.id}/${run.tasks.length} running`);
    recordExecutorLogEvent("system", "todo step running", `step ${task.id}/${run.tasks.length} running`);

    const currentRun = (await loadTodoRun(run.runId)) || run;
    const currentTask = currentRun.tasks.find((item) => item.id === task.id) || task;
    const stepPrompt = buildTodoExecutionPrompt(currentRun, currentTask);

    try {
      const stepOutput = await fetchLocalSystemExecutorResponse(stepPrompt, (status, detail) => {
        activity.set(`[PLAN] step ${task.id}/${run.tasks.length} ${status}`);
        if (detail) {
          activity.trace(detail);
        }
      });
      lastStepOutput = stepOutput;
      const stepNote = trimToMaxChars(toPlainTerminalText(stepOutput), 280);
      const updated = await setTodoTaskStatus(run.runId, task.id, "completed", stepNote);
      if (updated) {
        activity.set(`Thinking: ${formatTodoProgress(updated)}`);
        recordExecutorLogEvent("system", "todo step completed", formatTodoProgress(updated));
      }
    } catch (error: any) {
      const message = error?.message || "Unknown error";
      await setTodoTaskStatus(run.runId, task.id, "failed", message);
      recordExecutorLogEvent("system", "todo step failed", `todo step ${task.id} failed: ${message}`);
      throw new Error(`Todo step ${task.id} failed: ${message}`);
    }
  }

  const finalRun = (await loadTodoRun(run.runId)) || run;
  const finalText = [
    "Large task execution complete.",
    formatTodoProgress(finalRun),
    `Todo run id: ${run.runId}`,
    `Todo store: ${getTodoStorePath()}`,
    "",
    "Final step result:",
    trimToMaxChars(toPlainTerminalText(lastStepOutput || "Completed"), 2400),
  ].join("\n");

  return finalText;
}

const logo = `${orange}██╗  ██╗██╗  ██╗ █████╗ ██╗     ██╗██████╗      █████╗ ██╗   ██╗ █████╗  █████╗ ███╗   ██╗    ██╗   ██╗${reset}
${orange}██║ ██╔╝██║  ██║██╔══██╗██║     ██║██╔══██╗    ██╔══██╗╚██╗ ██╔╝██╔══██╗██╔══██╗████╗  ██║    ╚██╗ ██╔╝${reset}
${orange}█████╔╝ ███████║███████║██║     ██║██║  ██║    ███████║ ╚████╔╝ ███████║███████║██╔██╗ ██║     ╚████╔╝${reset}
${orange}██╔═██╗ ██╔══██║██╔══██║██║     ██║██║  ██║    ██╔══██║  ╚██╔╝  ██╔══██║██╔══██║██║╚██╗██║      ╚██╔╝${reset}
${orange}██║  ██╗██║  ██║██║  ██║███████╗██║██████╔╝    ██║  ██║   ██║   ██║  ██║██║  ██║██║ ╚████║       ██║${reset}
${orange}╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝╚═════╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝       ╚═╝${reset}`;

function showLoading(): Promise<void> {
  return new Promise((resolve) => {
    let progress = 0;
    const barWidth = 50;

    // Hide cursor
    process.stdout.write('\x1b[?25l');

    const interval = setInterval(() => {
      progress += 2;
      const filledWidth = Math.floor((progress / 100) * barWidth);
      const emptyWidth = barWidth - filledWidth;

      // Build solid orange bar (exact orange-500 color)
      let bar = '';
      for (let i = 0; i < filledWidth; i++) {
        bar += `${orange}█${reset}`;
      }
      bar += `${gray}${'░'.repeat(emptyWidth)}${reset}`;

      // Move to top-left and clear to end, then print on single line
      process.stdout.write(`\x1b[1;1H\x1b[K${gray}Loading${reset} ${bar} ${progress}%`);

      if (progress >= 100) {
        clearInterval(interval);
        // Show cursor
        process.stdout.write('\x1b[?25h');
        console.log('\n');
        setTimeout(resolve, 300);
      }
    }, 50);
  });
}

function showLogo() {
  console.log(logo);
  console.log('');
}

function showMainInterface() {
  console.log(`${orange}● ● ●${reset}  ${bold}${orange}Khalid AI${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log(`${bold}Available Commands${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log(`  ${orange}▸${reset} ${orange}/ai       ${reset} ${gray}│${reset} AI features and default model`);
  console.log(`  ${orange}▸${reset} ${orange}/model    ${reset} ${gray}│${reset} Select AI model`);
  console.log(`  ${orange}▸${reset} ${orange}/connect  ${reset} ${gray}│${reset} Connect providers and tools`);
  console.log(`  ${orange}▸${reset} ${orange}/skills   ${reset} ${gray}│${reset} CLI skills auto-routing settings`);
  console.log(`  ${orange}▸${reset} ${orange}/telegram ${reset} ${gray}│${reset} Telegram bot auth and agent`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log(`${white}Welcome to Khalid AI CLI!${reset}`);
  console.log(`${gray}Type any command to get started${reset}`);
  console.log(`${gray}Use /help to see available commands${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log('');
}

function showAgentInterface(agentLabel: string) {
  const label = agentLabel.trim() || "Agent";
  console.log(`${orange}● ● ●${reset}  ${bold}${orange}${label}${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log(`${white}Agent Mode Active${reset}`);
  console.log(`${gray}Main AI is selected. Default is single-flow task execution with auto model routing.${reset}`);
  console.log(`${gray}Sub-agents run in parallel only if explicitly requested in your prompt.${reset}`);
  console.log(`${gray}Type your task to start. Use /ai anytime to switch agent or mode.${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log("");
}

async function renderPostAiInterface(): Promise<void> {
  const activeLabel = await getAgentPromptLabel().catch(() => null);
  console.clear();
  if (activeLabel) {
    await showLoading();
    showAgentInterface(activeLabel);
    return;
  }
  showLogo();
  showMainInterface();
}

async function renderPromptStatus(): Promise<void> {
  const routerConfig = await loadAiRouterConfig();
  const selected = routerConfig.selectedModel;

  let mode = "default routing";
  let contextWindow = 0;
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  if (selected.enabled && selected.provider) {
    mode = "personal selection";
  } else if (routerConfig.defaultProvider !== "auto") {
    mode = "default provider";
  }

  if (currentRouteInfo) {
    contextWindow = currentRouteInfo.contextWindow;
    usage = usageByModel.get(getUsageKey(currentRouteInfo)) || usage;
  }

  const remaining = contextWindow > 0 ? Math.max(contextWindow - usage.totalTokens, 0) : 0;
  const contextText = contextWindow > 0 ? `${remaining.toLocaleString()} left` : "unknown";

  console.log(
    `${gray}Mode:${reset} ${white}${mode}${reset} ${gray}| Tokens:${reset} used ${white}${usage.totalTokens.toLocaleString()}${reset} ${gray}| prompt ${white}${usage.promptTokens.toLocaleString()}${reset} ${gray}| completion ${white}${usage.completionTokens.toLocaleString()}${reset} ${gray}| remaining ${white}${contextText}${reset}`,
  );
}

async function prompt(): Promise<string> {
  const customLabel = await getAgentPromptLabel().catch(() => null);
  const promptLabel = customLabel || "Khalid Ai";

  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdout.write(`${orange}${promptLabel}${reset} ${white}>${reset} `);

    let input = '';

    const handleData = (data: Buffer) => {
      const char = data.toString();

      if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        console.log('');
        resolve(input);
      } else if (char === '\u0003') {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        console.log('');
        resolve('__CTRL_C__');
      } else if (char === '\u007f') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (char >= ' ') {
        input += char;
        process.stdout.write(char);
      }
    };

    process.stdin.on('data', handleData);
    process.stdin.setRawMode?.(true);
  });
}

async function renderQwenStreamResponse(
  route: Extract<AiRouteCandidate, { provider: "qwen" }>,
  message: string,
  activity: AiLiveActivity,
  mode: ChatFlowMode = "chat",
): Promise<{ responseText: string; usage: TokenUsage }> {
  const actionLabel = mode === "command-summary" ? "Summary" : "Thinking";
  const responderLabel = buildProviderModelLabel("qwen", route.model.name);
  activity.setActor(responderLabel);
  activity.set(`${actionLabel}: connecting to Qwen API`);
  const response = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.access}`,
    },
    body: JSON.stringify({
      model: route.model.id,
      messages: [{ role: "user", content: message }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: Math.min(route.model.maxTokens, 2048),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    activity.stop();
    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || "No response from AI";
    const rendered = await printModelResponseLive(responderLabel, aiResponse);
    return {
      responseText: rendered,
      usage: normalizeUsage(data?.usage) || buildEstimatedUsage(message, rendered),
    };
  }

  activity.set(`${actionLabel}: waiting for first token`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let printedAnyToken = false;
  let responseText = "";
  let usage: TokenUsage | undefined;
  let wroteVisibleText = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    let boundary = sseBuffer.indexOf("\n\n");

    while (boundary !== -1) {
      const event = sseBuffer.slice(0, boundary);
      sseBuffer = sseBuffer.slice(boundary + 2);

      const lines = event.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const usageChunk = normalizeUsage(parsed?.usage);
        if (usageChunk) {
          usage = usageChunk;
        }

        const rawDelta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? "";
        if (!rawDelta) continue;
        const delta = wroteVisibleText ? rawDelta : stripLeadingWhitespace(rawDelta);
        if (!delta) continue;

        if (!printedAnyToken) {
          activity.stop();
          process.stdout.write(`${cyan}${responderLabel}${reset} ${white}> ${reset}${white}`);
          printedAnyToken = true;
        }
        await writeChunkLive(delta);
        responseText += delta;
        wroteVisibleText = true;
      }

      boundary = sseBuffer.indexOf("\n\n");
    }
  }

  if (!printedAnyToken) {
    activity.stop();
    responseText = await printModelResponseLive(responderLabel, "No response from AI");
  } else {
    process.stdout.write(`${reset}\n`);
  }

  return {
    responseText,
    usage: usage || buildEstimatedUsage(message, responseText),
  };
}

async function renderOpenRouterStreamResponse(
  route: Extract<AiRouteCandidate, { provider: "openrouter" }>,
  message: string,
  activity: AiLiveActivity,
  mode: ChatFlowMode = "chat",
): Promise<{ responseText: string; usage: TokenUsage }> {
  const actionLabel = mode === "command-summary" ? "Summary" : "Thinking";
  const responderLabel = buildProviderModelLabel("openrouter", route.model.name);
  activity.setActor(responderLabel);
  activity.set(`${actionLabel}: connecting to OpenRouter API`);

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
      messages: [{ role: "user", content: message }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: Math.min(route.model.maxTokens, 2048),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    activity.stop();
    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || "No response from AI";
    const rendered = await printModelResponseLive(responderLabel, aiResponse);
    return {
      responseText: rendered,
      usage: normalizeUsage(data?.usage) || buildEstimatedUsage(message, rendered),
    };
  }

  activity.set(`${actionLabel}: waiting for first token`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let printedAnyToken = false;
  let responseText = "";
  let usage: TokenUsage | undefined;
  let wroteVisibleText = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    let boundary = sseBuffer.indexOf("\n\n");

    while (boundary !== -1) {
      const event = sseBuffer.slice(0, boundary);
      sseBuffer = sseBuffer.slice(boundary + 2);

      const lines = event.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const usageChunk = normalizeUsage(parsed?.usage);
        if (usageChunk) {
          usage = usageChunk;
        }

        const rawDelta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? "";
        if (!rawDelta) continue;
        const delta = wroteVisibleText ? rawDelta : stripLeadingWhitespace(rawDelta);
        if (!delta) continue;

        if (!printedAnyToken) {
          activity.stop();
          process.stdout.write(`${cyan}${responderLabel}${reset} ${white}> ${reset}${white}`);
          printedAnyToken = true;
        }
        await writeChunkLive(delta);
        responseText += delta;
        wroteVisibleText = true;
      }

      boundary = sseBuffer.indexOf("\n\n");
    }
  }

  if (!printedAnyToken) {
    activity.stop();
    responseText = await printModelResponseLive(responderLabel, "No response from AI");
  } else {
    process.stdout.write(`${reset}\n`);
  }

  return {
    responseText,
    usage: usage || buildEstimatedUsage(message, responseText),
  };
}

async function renderKiloStreamResponse(
  route: Extract<AiRouteCandidate, { provider: "kilo" }>,
  message: string,
  activity: AiLiveActivity,
  mode: ChatFlowMode = "chat",
): Promise<{ responseText: string; usage: TokenUsage }> {
  const actionLabel = mode === "command-summary" ? "Summary" : "Thinking";
  const responderLabel = buildProviderModelLabel("kilo", route.model.name);
  activity.setActor(responderLabel);
  activity.set(`${actionLabel}: connecting to Kilo API`);

  const response = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.apiKey}`,
    },
    body: JSON.stringify({
      model: route.model.id,
      messages: [{ role: "user", content: message }],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: Math.min(route.model.maxTokens, 2048),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    activity.stop();
    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || "No response from AI";
    const rendered = await printModelResponseLive(responderLabel, aiResponse);
    return {
      responseText: rendered,
      usage: normalizeUsage(data?.usage) || buildEstimatedUsage(message, rendered),
    };
  }

  activity.set(`${actionLabel}: waiting for first token`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let printedAnyToken = false;
  let responseText = "";
  let usage: TokenUsage | undefined;
  let wroteVisibleText = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    let boundary = sseBuffer.indexOf("\n\n");

    while (boundary !== -1) {
      const event = sseBuffer.slice(0, boundary);
      sseBuffer = sseBuffer.slice(boundary + 2);

      const lines = event.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        const usageChunk = normalizeUsage(parsed?.usage);
        if (usageChunk) {
          usage = usageChunk;
        }

        const rawDelta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? "";
        if (!rawDelta) continue;
        const delta = wroteVisibleText ? rawDelta : stripLeadingWhitespace(rawDelta);
        if (!delta) continue;

        if (!printedAnyToken) {
          activity.stop();
          process.stdout.write(`${cyan}${responderLabel}${reset} ${white}> ${reset}${white}`);
          printedAnyToken = true;
        }
        await writeChunkLive(delta);
        responseText += delta;
        wroteVisibleText = true;
      }

      boundary = sseBuffer.indexOf("\n\n");
    }
  }

  if (!printedAnyToken) {
    activity.stop();
    responseText = await printModelResponseLive(responderLabel, "No response from AI");
  } else {
    process.stdout.write(`${reset}\n`);
  }

  return {
    responseText,
    usage: usage || buildEstimatedUsage(message, responseText),
  };
}

async function fetchQwenResponse(
  route: Extract<AiRouteCandidate, { provider: "qwen" }>,
  message: string,
  options?: { maxTokensCap?: number },
): Promise<{ text: string; usage?: TokenUsage }> {
  const response = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.access}`,
    },
    body: JSON.stringify({
      model: route.model.id,
      messages: [{ role: "user", content: message }],
      max_tokens: Math.min(route.model.maxTokens, options?.maxTokensCap || 2048),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    text: data?.choices?.[0]?.message?.content || "No response from AI.",
    usage: normalizeUsage(data?.usage),
  };
}

async function fetchOpenRouterResponse(
  route: Extract<AiRouteCandidate, { provider: "openrouter" }>,
  message: string,
  options?: { maxTokensCap?: number },
): Promise<{ text: string; usage?: TokenUsage }> {
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
      messages: [{ role: "user", content: message }],
      max_tokens: Math.min(route.model.maxTokens, options?.maxTokensCap || 2048),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    text: data?.choices?.[0]?.message?.content || "No response from AI.",
    usage: normalizeUsage(data?.usage),
  };
}

async function fetchKiloResponse(
  route: Extract<AiRouteCandidate, { provider: "kilo" }>,
  message: string,
  options?: { maxTokensCap?: number },
): Promise<{ text: string; usage?: TokenUsage }> {
  const response = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.apiKey}`,
    },
    body: JSON.stringify({
      model: route.model.id,
      messages: [{ role: "user", content: message }],
      max_tokens: Math.min(route.model.maxTokens, options?.maxTokensCap || 2048),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    text: data?.choices?.[0]?.message?.content || "No response from AI.",
    usage: normalizeUsage(data?.usage),
  };
}

async function fetchMiniMaxResponse(
  route: Extract<AiRouteCandidate, { provider: "minimax" }>,
  message: string,
  options?: { maxTokensCap?: number },
): Promise<{ text: string; usage?: TokenUsage }> {
  const response = await fetch(`${route.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${route.token.access}`,
    },
    body: JSON.stringify({
      model: route.model.id,
      max_tokens: Math.min(route.model.maxTokens, options?.maxTokensCap || 2048),
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const parsedUsage = normalizeUsage(data?.usage);
  if (Array.isArray(data.content)) {
    const text = data.content
      .filter((item: any) => item?.type === "text" && typeof item?.text === "string")
      .map((item: any) => item.text)
      .join("");
    if (text) return { text, usage: parsedUsage };
  }
  return {
    text: data.choices?.[0]?.message?.content || data.reply || data.base_resp?.status_msg || "No response from AI",
    usage: parsedUsage,
  };
}

async function fetchRouteResponseOnce(
  candidate: AiRouteCandidate,
  prompt: string,
  options?: { fastMode?: boolean; maxTokensCap?: number },
): Promise<{ text: string; usage?: TokenUsage }> {
  const effectivePrompt = options?.fastMode
    ? `${prompt}\n\nSpeed mode: keep output concise and task-focused.`
    : prompt;
  const maxTokensCap = options?.maxTokensCap;

  if (candidate.provider === "qwen") {
    return await fetchQwenResponse(candidate, effectivePrompt, { maxTokensCap });
  }
  if (candidate.provider === "openrouter") {
    return await fetchOpenRouterResponse(candidate, effectivePrompt, { maxTokensCap });
  }
  if (candidate.provider === "kilo") {
    return await fetchKiloResponse(candidate, effectivePrompt, { maxTokensCap });
  }
  if (candidate.provider === "minimax") {
    return await fetchMiniMaxResponse(candidate, effectivePrompt, { maxTokensCap });
  }
  if (candidate.provider === "antigravity") {
    return await fetchAntigravityResponse(candidate, effectivePrompt);
  }

  const text = await fetchCodexResponse(candidate, withCodexExecutionPolicy(effectivePrompt));
  return {
    text: toPlainTerminalText(stripLeadingWhitespace(text || "")).trim() || "No response from AI.",
    usage: buildEstimatedUsage(effectivePrompt, text),
  };
}

async function fetchCodexResponse(
  route: Extract<AiRouteCandidate, { provider: "codex" }>,
  message: string,
  onProgress?: (status: string, detail?: string) => void,
): Promise<string> {
  const { spawn } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const fs = await import("node:fs/promises");

  const outputFile = join(tmpdir(), `hakathone-codex-${randomUUID()}.txt`);
  let stdout = "";
  let stderr = "";
  let lastProgressSummary = "";
  let lastProgressDetail = "";
  let lastProgressAt = 0;

  const reportProgress = (chunk: string, source: "stdout" | "stderr") => {
    for (const line of extractProgressLines(chunk)) {
      if (shouldIgnoreCliProgressLine(line)) {
        continue;
      }
      const normalized = line.replace(/\s+/g, " ").trim();
      if (!normalized) {
        continue;
      }
      const summary = summarizeExecutorProgressLine(normalized, source);
      const detail = formatExecutorLiveDetail(summary, normalized);
      recordExecutorLogEvent(source, summary, detail);
      if (!onProgress || !summary) {
        continue;
      }

      const now = Date.now();
      const summaryChanged = summary !== lastProgressSummary;
      const detailChanged = detail !== lastProgressDetail;
      const shouldPulseDetail = !summaryChanged && detailChanged && now - lastProgressAt >= 1200;
      if (!summaryChanged && !shouldPulseDetail) {
        continue;
      }

      lastProgressSummary = summary;
      lastProgressDetail = detail;
      lastProgressAt = now;
      onProgress(formatExecutorLiveSummary(summary), detail);
    }
  };

  await new Promise<void>((resolve, reject) => {
    onProgress?.(formatExecutorLiveSummary("starting runtime"), "starting Codex process");
    recordExecutorLogEvent("system", "starting runtime", "starting Codex process");
    const args = [
      "exec",
      ...CODEX_MCP_DISABLE_OVERRIDES,
      "--sandbox",
      "workspace-write",
      "--ephemeral",
      "--skip-git-repo-check",
      "--add-dir",
      CLI_HOME_DIR,
      "--color",
      "never",
      "--output-last-message",
      outputFile,
      "--model",
      route.model.id,
      "--cd",
      CLI_HOME_DIR,
      message,
    ];

    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      reportProgress(text, "stdout");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      reportProgress(text, "stderr");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `codex exec failed with exit code ${code}`));
      }
    });
  });

  try {
    onProgress?.(formatExecutorLiveSummary("finalizing response"), "finalizing Codex output");
    recordExecutorLogEvent("system", "finalizing response", "finalizing Codex output");
    const content = (await fs.readFile(outputFile, "utf-8")).trim();
    if (content) return content;
  } finally {
    await fs.rm(outputFile, { force: true }).catch(() => undefined);
  }

  const fallback = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();

  if (fallback) return fallback;
  throw new Error("Codex returned an empty response.");
}

async function fetchLocalSystemExecutorResponse(
  message: string,
  onProgress?: (status: string, detail?: string) => void,
  options?: { applyExecutionPolicy?: boolean },
): Promise<string> {
  const { spawn } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const fs = await import("node:fs/promises");

  const outputFile = join(tmpdir(), `hakathone-system-exec-${randomUUID()}.txt`);
  let stdout = "";
  let stderr = "";
  let lastProgressSummary = "";
  let lastProgressDetail = "";
  let lastProgressAt = 0;

  const reportProgress = (chunk: string, source: "stdout" | "stderr") => {
    for (const line of extractProgressLines(chunk)) {
      if (shouldIgnoreCliProgressLine(line)) {
        continue;
      }
      const normalized = line.replace(/\s+/g, " ").trim();
      if (!normalized) {
        continue;
      }
      const summary = summarizeExecutorProgressLine(normalized, source);
      const detail = formatExecutorLiveDetail(summary, normalized);
      recordExecutorLogEvent(source, summary, detail);
      if (!onProgress || !summary) {
        continue;
      }

      const now = Date.now();
      const summaryChanged = summary !== lastProgressSummary;
      const detailChanged = detail !== lastProgressDetail;
      const shouldPulseDetail = !summaryChanged && detailChanged && now - lastProgressAt >= 1200;
      if (!summaryChanged && !shouldPulseDetail) {
        continue;
      }

      lastProgressSummary = summary;
      lastProgressDetail = detail;
      lastProgressAt = now;
      onProgress(formatExecutorLiveSummary(summary), detail);
    }
  };

  await new Promise<void>((resolve, reject) => {
    onProgress?.(formatExecutorLiveSummary("starting runtime"), "starting system executor");
    recordExecutorLogEvent("system", "starting runtime", "starting system executor");
    const args = [
      "exec",
      ...CODEX_MCP_DISABLE_OVERRIDES,
      "--sandbox",
      "workspace-write",
      "--ephemeral",
      "--skip-git-repo-check",
      "--add-dir",
      CLI_HOME_DIR,
      "--color",
      "never",
      "--output-last-message",
      outputFile,
      "--cd",
      CLI_HOME_DIR,
      options?.applyExecutionPolicy === false ? message : withCodexExecutionPolicy(message),
    ];

    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      reportProgress(text, "stdout");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      reportProgress(text, "stderr");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `system executor failed with exit code ${code}`));
      }
    });
  });

  try {
    onProgress?.(formatExecutorLiveSummary("finalizing response"), "finalizing system executor output");
    recordExecutorLogEvent("system", "finalizing response", "finalizing system executor output");
    const content = (await fs.readFile(outputFile, "utf-8")).trim();
    if (content) return content;
  } finally {
    await fs.rm(outputFile, { force: true }).catch(() => undefined);
  }

  const fallback = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();

  if (fallback) return fallback;
  throw new Error("System executor returned an empty response.");
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

function buildAntigravityRequest(route: Extract<AiRouteCandidate, { provider: "antigravity" }>, message: string) {
  const normalizedModelId = normalizeAntigravityModelId(route.model.id);
  return {
    project: route.token.projectId,
    model: normalizedModelId,
    request: {
      contents: [{ role: "user", parts: [{ text: message }] }],
      systemInstruction: {
        role: "user",
        parts: [
          { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
          {
            text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]`,
          },
        ],
      },
    },
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  };
}

function parseAntigravitySseText(rawSse: string): string {
  let output = "";
  const lines = rawSse.split("\n");

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    let chunk: any;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }

    const parts = chunk?.response?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.length > 0) {
        output += part.text;
      }
    }
  }

  return output.trim();
}

function extractAntigravityChunkText(payload: any): string {
  const parts = payload?.response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  let text = "";
  for (const part of parts) {
    if (typeof part?.text === "string" && part.text.length > 0) {
      text += part.text;
    }
  }
  return text;
}

async function renderAntigravityStreamResponse(
  route: Extract<AiRouteCandidate, { provider: "antigravity" }>,
  message: string,
  activity: AiLiveActivity,
  mode: ChatFlowMode = "chat",
): Promise<{ responseText: string; usage: TokenUsage }> {
  const actionLabel = mode === "command-summary" ? "Summary" : "Thinking";
  const responderLabel = buildProviderModelLabel("antigravity", route.model.name);
  activity.setActor(responderLabel);
  const requestBody = buildAntigravityRequest(route, message);
  const modelIdLower = normalizeAntigravityModelId(route.model.id).toLowerCase();
  const endpoints = [
    route.baseUrl,
    ANTIGRAVITY_ENDPOINT_DAILY,
    ANTIGRAVITY_ENDPOINT_PROD,
  ].filter((value, index, list) => value && list.indexOf(value) === index);

  let lastError = "Antigravity request failed";

  for (const endpoint of endpoints) {
    activity.set(`${actionLabel}: connecting to Antigravity API`);
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
      const errText = await response.text();
      lastError = errText || `${response.status} ${response.statusText}`;
      continue;
    }

    if (!response.body) {
      activity.stop();
      const rawSse = await response.text();
      const text = parseAntigravitySseText(rawSse);
      const rendered = await printModelResponseLive(responderLabel, text || "No response from AI");
      return {
        responseText: rendered,
        usage: buildEstimatedUsage(message, rendered),
      };
    }

    activity.set(`${actionLabel}: waiting for first token`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let responseText = "";
    let printedAnyToken = false;
    let previousSnapshot = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      let boundary = sseBuffer.indexOf("\n\n");

      while (boundary !== -1) {
        const event = sseBuffer.slice(0, boundary);
        sseBuffer = sseBuffer.slice(boundary + 2);

        const lines = event.split("\n");
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let parsed: any;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }

          const snapshot = extractAntigravityChunkText(parsed);
          if (!snapshot) continue;

          let delta = snapshot;
          if (previousSnapshot && snapshot.startsWith(previousSnapshot)) {
            delta = snapshot.slice(previousSnapshot.length);
          }
          previousSnapshot = snapshot.length >= previousSnapshot.length ? snapshot : previousSnapshot;

          if (!delta) continue;
          const visibleDelta = responseText ? delta : stripLeadingWhitespace(delta);
          if (!visibleDelta) continue;

          if (!printedAnyToken) {
            activity.stop();
            process.stdout.write(`${cyan}${responderLabel}${reset} ${white}> ${reset}${white}`);
            printedAnyToken = true;
          }
          await writeChunkLive(visibleDelta);
          responseText += visibleDelta;
        }

        boundary = sseBuffer.indexOf("\n\n");
      }
    }

    if (!responseText.trim()) {
      continue;
    }

    if (!printedAnyToken) {
      activity.stop();
      responseText = await printModelResponseLive(responderLabel, responseText);
    } else {
      process.stdout.write(`${reset}\n`);
    }

    return {
      responseText,
      usage: buildEstimatedUsage(message, responseText),
    };
  }

  throw new Error(lastError);
}

async function fetchAntigravityResponse(
  route: Extract<AiRouteCandidate, { provider: "antigravity" }>,
  message: string,
): Promise<{ text: string; usage?: TokenUsage }> {
  const requestBody = buildAntigravityRequest(route, message);
  const modelIdLower = normalizeAntigravityModelId(route.model.id).toLowerCase();
  const endpoints = [
    route.baseUrl,
    ANTIGRAVITY_ENDPOINT_DAILY,
    ANTIGRAVITY_ENDPOINT_PROD,
  ].filter((value, index, list) => value && list.indexOf(value) === index);

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
      const errText = await response.text();
      lastError = errText || `${response.status} ${response.statusText}`;
      continue;
    }

    const rawSse = await response.text();
    const text = parseAntigravitySseText(rawSse);
    if (text) {
      return { text };
    }

    lastError = "Cloud Code Assist API returned an empty response";
  }

  throw new Error(lastError);
}

async function executeFirecrawlIntentWithActivity(
  objective: string,
  intent: FirecrawlRunIntent,
): Promise<string> {
  beginExecutorLogSession("Firecrawl", objective);
  const activity = new AiLiveActivity();
  activity.start("Thinking: preparing Firecrawl request", "Firecrawl");

  try {
    activity.set(`Thinking: running Firecrawl ${intent.kind}`);
    const responseText = await executeFirecrawlRunIntent(intent);
    activity.stop();
    completeExecutorLogSession(responseText);
    return responseText;
  } catch (error) {
    activity.stop();
    const message = error instanceof Error ? error.message : "Unknown Firecrawl error";
    failExecutorLogSession(message);
    throw new Error(message);
  }
}

async function runUniversalSystemExecution(message: string): Promise<boolean> {
  if (!isSystemExecutionPrompt(message)) {
    return false;
  }

  const directFsIntent = extractFileSystemIntent(message);

  // For short FS intents, execute directly (with workspace protection checks).
  if (directFsIntent) {
    beginExecutorLogSession("File System", message);
    const fsActivity = new AiLiveActivity();
    fsActivity.start(`detected file task: ${directFsIntent.kind}`, "File System");
    let targetPath = "";
    try {
      targetPath = resolvePathFromInput(directFsIntent.path);
    } catch (error: any) {
      fsActivity.stop();
      failExecutorLogSession(error?.message || "Invalid path");
      console.log(`${red}File task failed:${reset} ${white}${error?.message || "Invalid path"}${reset}`);
      console.log("");
      return true;
    }

    const policyConfig = await loadPolicyConfig(PROTECTED_WORKSPACE_ROOT);
    if (
      policyConfig.enabled &&
      policyConfig.readOnlyWorkspace &&
      isWriteLikeFsIntentKind(directFsIntent.kind) &&
      isWorkspacePath(targetPath)
    ) {
      fsActivity.stop();
      failExecutorLogSession("Workspace write blocked by policy engine");
      console.log(`${red}Blocked:${reset} workspace write blocked by policy engine (read-only workspace mode).`);
      console.log("");
      return true;
    }

    if (isProtectedWorkspacePath(targetPath)) {
      fsActivity.stop();
      failExecutorLogSession("Protected workspace path is blocked");
      console.log(`${red}Blocked:${reset} protected workspace access is disabled for now.`);
      console.log(`${gray}Target:${reset} ${white}${targetPath}${reset}`);
      console.log(`${gray}Protected:${reset} ${white}${PROTECTED_WORKSPACE_ROOT}${reset}`);
      console.log("");
      return true;
    }

    try {
      fsActivity.set(`executing ${directFsIntent.kind}`);
      const result = await runFileSystemIntent(directFsIntent);
      fsActivity.stop();
      completeExecutorLogSession(`${result.message} at ${result.absolutePath}`);
      console.log(`${green}${result.message}.${reset}`);
      console.log(`${gray}Path:${reset} ${white}${result.absolutePath}${reset}`);
      console.log("");
      return true;
    } catch (error: any) {
      fsActivity.stop();
      const errorMessage = error?.message || "Unknown file task error";
      failExecutorLogSession(errorMessage);
      console.log(`${red}File task failed:${reset} ${white}${errorMessage}${reset}`);
      console.log("");
      return true;
    }
  }

  if (referencesProtectedWorkspaceWriteIntent(message)) {
    console.log(`${red}Blocked:${reset} write access to protected workspace is disabled.`);
    console.log(`${gray}Protected:${reset} ${white}${PROTECTED_WORKSPACE_ROOT}${reset}`);
    console.log("");
    return true;
  }

  if (isBrowserUseSetupIntent(message)) {
    beginExecutorLogSession("Browser Use Setup", message);
    const activity = new AiLiveActivity();
    activity.start("Thinking: preparing browser-use local setup", "Browser Use Setup");
    try {
      const setupResult = await setupBrowserUseLocalStack((status) => {
        activity.set(`Thinking: ${status}`);
      });
      activity.stop();
      const detailTail = setupResult.details.slice(-8).join("\n");
      const response = setupResult.success
        ? `${setupResult.summary}\n\n${detailTail}`
        : `Setup failed: ${setupResult.summary}\n\n${detailTail}`;
      completeExecutorLogSession(response);
      const rendered = await printModelResponseLive("Browser Use Setup", response);
      void saveChatTurn(message, rendered, "system-browser-use", "Browser Use Setup").catch(() => undefined);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    } catch (error: any) {
      activity.stop();
      const errorMessage = error?.message || "Browser-Use setup failed";
      failExecutorLogSession(errorMessage);
      console.log(`${red}System execution failed:${reset} ${white}${errorMessage}${reset}`);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    }
  }

  const firecrawlIntent = resolveFirecrawlNaturalIntent(message);
  if (firecrawlIntent) {
    try {
      const text = await executeFirecrawlIntentWithActivity(message, firecrawlIntent);
      const rendered = await printModelResponseLive("Firecrawl", text);
      void saveChatTurn(message, rendered, "system-firecrawl", "Firecrawl").catch(() => undefined);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Firecrawl request failed.";
      console.log(`${red}System execution failed:${reset} ${white}${errorMessage}${reset}`);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    }
  }

  const directCommand = inferDirectSystemCommand(message);
  const browserUseIntent = resolveBrowserUseCommandIntent(message) || inferBrowserUseNaturalIntent(message);
  const requestedBrowserProfile = await resolveRequestedBrowserProfileFromMessage(message);

  if (!directCommand && !browserUseIntent && isBrowserProfileSelectionOnlyPrompt(message)) {
    beginExecutorLogSession("System Executor", message);
    const activity = new AiLiveActivity();
    activity.start("Thinking: resolving browser profile lock", "System Executor");

    try {
      const profileOption = requestedBrowserProfile.option;
      if (!profileOption) {
        const options = await listBrowserProfileOptions();
        const topProfiles = options.slice(0, 8).map((item) => `- ${item.label}`).join("\n");
        const response = options.length
          ? `Browser profile not found for "${requestedBrowserProfile.hint || "requested profile"}".\nAvailable profiles:\n${topProfiles}`
          : "No browser profiles found. Use /connect -> Tools -> Browser -> Add Brwser Profile first.";
        activity.stop();
        completeExecutorLogSession(response);
        const rendered = await printModelResponseLive("System Executor", response);
        void saveChatTurn(message, rendered, "system-browser-profile", "System Executor").catch(() => undefined);
        console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
        console.log("");
        return true;
      }

      await setBrowserProfilePreferenceManual(profileOption.id);
      const modeLabel = profileOption.browserMode === "real" ? "Personal Browser (real)" : "CLI Browser (chromium)";
      const response = [
        `Browser profile locked: ${profileOption.label}`,
        `Mode: ${modeLabel}`,
        "Next browser tasks will use this profile by default.",
      ].join("\n");
      activity.stop();
      completeExecutorLogSession(response);
      const rendered = await printModelResponseLive("System Executor", response);
      void saveChatTurn(message, rendered, "system-browser-profile", "System Executor").catch(() => undefined);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    } catch (error: unknown) {
      activity.stop();
      const errorMessage = error instanceof Error ? error.message : "Unable to lock browser profile.";
      failExecutorLogSession(errorMessage);
      console.log(`${red}System execution failed:${reset} ${white}${errorMessage}${reset}`);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    }
  }

  let chosenDirectCommand: DirectSystemCommand | null = directCommand;
  if (browserUseIntent) {
    try {
      let effectiveBrowserIntent = browserUseIntent;
      if (
        requestedBrowserProfile.option &&
        !browserUseIntent.profileName &&
        !browserUseIntent.sessionName &&
        !browserUseIntent.modeExplicit
      ) {
        const profileOption = requestedBrowserProfile.option;
        effectiveBrowserIntent = {
          ...browserUseIntent,
          browserMode: profileOption.browserMode,
          modeExplicit: true,
          profileName: profileOption.profileName,
          sessionName: profileOption.sessionName,
          liveUi: profileOption.browserMode === "real" && browserUseIntent.headed,
          summary: `${browserUseIntent.summary} [profile: ${profileOption.label}]`,
        };
        await setBrowserProfilePreferenceManual(profileOption.id);
      }
      chosenDirectCommand = await resolveBrowserUseRuntimeCommand(effectiveBrowserIntent);
    } catch (error: any) {
      const errorMessage = error?.message || "Unable to prepare browser-use runtime.";
      beginExecutorLogSession("System Executor", message);
      failExecutorLogSession(errorMessage);
      console.log(`${red}System execution failed:${reset} ${white}${errorMessage}${reset}`);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    }
  }
  if (chosenDirectCommand) {
    beginExecutorLogSession("System Executor", message);
    const activity = new AiLiveActivity();
    activity.start(`Thinking: running direct command for ${chosenDirectCommand.label}`, "System Executor");
    try {
      const policyConfig = await loadPolicyConfig(PROTECTED_WORKSPACE_ROOT);
      const policyDecision = evaluateCommandPolicy(chosenDirectCommand.command, message, policyConfig);
      if (!policyDecision.allowed) {
        throw new Error(policyDecision.reason || "Direct command blocked by policy engine.");
      }
      if (policyDecision.requiresConfirmation) {
        const hint = policyDecision.confirmHint ? ` Add permission phrase: ${policyDecision.confirmHint}` : "";
        throw new Error(`${policyDecision.reason || "Direct command requires explicit permission."}${hint}`);
      }
      activity.set(`Thinking: executing ${chosenDirectCommand.label}`);
      const text = await runDirectSystemCommand(chosenDirectCommand.command);
      activity.stop();
      const response = chosenDirectCommand.note
        ? `${chosenDirectCommand.label}:\n${text}\n\nNote: ${chosenDirectCommand.note}`
        : `${chosenDirectCommand.label}:\n${text}`;
      completeExecutorLogSession(response);
      const rendered = await printModelResponseLive("System Executor", response);
      void saveChatTurn(message, rendered, "system-command", "System Executor").catch(() => undefined);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    } catch (error: any) {
      activity.stop();
      const errorMessage = error?.message || "Direct system command failed";
      failExecutorLogSession(errorMessage);
      console.log(`${red}System execution failed:${reset} ${white}${errorMessage}${reset}`);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
      return true;
    }
  }

  const useTodoOrchestration = shouldUseTodoOrchestration(message);
  const executorName = useTodoOrchestration ? "Todo Executor" : "System Executor";
  beginExecutorLogSession(executorName, message);
  const activity = new AiLiveActivity();
  activity.start(
    useTodoOrchestration ? "Thinking: preparing todo orchestration" : "Thinking: preparing system execution",
    executorName,
  );

  activity.set(
    useTodoOrchestration ? "Thinking: running multi-step todo workflow" : "Thinking: running task on local filesystem",
  );
  recordExecutorLogEvent(
    "system",
    "task started",
    useTodoOrchestration ? "running multi-step todo workflow" : "running task on local filesystem",
  );

  const startedAt = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (!useTodoOrchestration) {
    heartbeat = setInterval(() => {
      const elapsedSec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      activity.set(`Thinking: executing steps (${elapsedSec}s)`);
    }, 4000);
  }

  try {
    const text = useTodoOrchestration
      ? await runTodoOrchestratedExecution(message, activity)
      : await fetchLocalSystemExecutorResponse(message, (status, detail) => {
          activity.set(status);
          if (detail) {
            activity.trace(detail);
          }
        });
    if (heartbeat) clearInterval(heartbeat);
    activity.stop();
    const normalizedText = ensureNonTrivialCompletion(message, text);
    completeExecutorLogSession(normalizedText);
    const rendered = await printModelResponseLive(executorName, normalizedText);
    void saveChatTurn(message, rendered, useTodoOrchestration ? "system-todo" : "system", executorName).catch(
      () => undefined,
    );
    console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
    console.log("");
    return true;
  } catch (error: any) {
    if (heartbeat) clearInterval(heartbeat);
    activity.stop();
    const errorMessage = error?.message || "Unknown error";
    failExecutorLogSession(errorMessage);
    console.log(`${red}System execution failed:${reset} ${white}${errorMessage}${reset}`);
    console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
    console.log("");
    return true;
  }
}

async function chatWithAI(message: string, options: ChatWithAiOptions = {}) {
  const chatPerfStartedAt = Date.now();
  if ((options.mode ?? "chat") === "chat") {
    if (isSystemExecutionPrompt(message)) {
      const gateState = await loadEvalGateState().catch(() => null);
      if (gateState?.blocked) {
        console.log(`${red}Blocked:${reset} Eval regression gate is active.`);
        console.log(`${gray}Run:${reset} ${white}/eval run${reset} ${gray}or clear manually:${reset} ${white}/eval unblock${reset}`);
        console.log("");
        return;
      }
    }

    const executed = await runUniversalSystemExecution(message);
    if (executed) {
      return;
    }
  }

  const mode = options.mode ?? "chat";
  const actionLabel = mode === "command-summary" ? "Summary" : "Thinking";
  const [cliSkillPlan, cliSkillsState, routerConfig, schedulerConfig] =
    mode === "chat"
      ? await Promise.all([
          resolveCliSkillPlan(message).catch(() => disabledCliSkillPlan()),
          loadCliSkillsState().catch(() => null),
          loadAiRouterConfig(),
          loadSchedulerConfig(),
        ])
      : [disabledCliSkillPlan(), null, await loadAiRouterConfig(), await loadSchedulerConfig()];
  const preflightMs = Date.now() - chatPerfStartedAt;

  let agentPlan: ActiveAgentPlan | null = null;
  const useParallelAgentExecution = false;
  const enforceTaskAwareAutoRouting = false;
  activeAgentResponseLabel = null;
  const selectedOverrideActive = Boolean(routerConfig.selectedModel.enabled && routerConfig.selectedModel.provider);
  const allowProviderFallback = routerConfig.defaultProvider === "auto" && !selectedOverrideActive;
  const routeDiscoveryStartedAt = Date.now();
  const candidates = await buildAiRouteCandidates(message, { config: routerConfig });
  const routeDiscoveryMs = Date.now() - routeDiscoveryStartedAt;
  const forcedProvider = selectedOverrideActive ? routerConfig.selectedModel.provider : undefined;
  const effectiveCandidates = forcedProvider
    ? candidates.filter((candidate) => candidate.provider === forcedProvider)
    : candidates;
  const routeCandidates = reorderCandidatesWithScheduler(
    prioritizeHealthyCandidates(effectiveCandidates),
    message,
    schedulerConfig,
  );

  if (!routeCandidates.length) {
    console.log(
      `${gray}No authenticated provider found. Run /model and authenticate Qwen, MiniMax, Codex, Antigravity, OpenRouter, or Kilo.${reset}`,
    );
    console.log("");
    return;
  }

  const activity = new AiLiveActivity();
  activity.start(`${actionLabel}: preparing request`, "Router");
  const skillNames = cliSkillPlan.enabled
    ? (cliSkillPlan.selected.slice(0, 4).map((item) => item.skill.id).join(", ") || "None")
    : "Disabled";
  activity.setAgentStatus("Skills", skillNames);
  activity.setAgentStatus("Route", selectedOverrideActive ? "Manual model" : "Auto");
  activity.setAgentStatus(
    "Scheduler",
    schedulerConfig.enabled
      ? `${schedulerConfig.qualityTarget}${schedulerConfig.maxUsdPerTask ? ` | budget $${schedulerConfig.maxUsdPerTask.toFixed(4)}` : ""}`
      : "disabled",
  );
  activity.trace(`perf: preflight ${preflightMs}ms | routing ${routeDiscoveryMs}ms`);
  if (cliSkillPlan.enabled) {
    activity.set(`${actionLabel}: applying skills route`);
  }
  const shipFasterCarryoverEnabled =
    mode === "chat" &&
    (cliSkillsState?.preferShipFaster !== false) &&
    (cliSkillsState?.shipFasterSessionCarryover !== false);

  const baseMessage =
    mode === "command-summary"
      ? message
      : await buildMessageWithMemoryContext(message, (status) => {
          activity.set(`${actionLabel}: ${status}`);
        }, {
          forceSessionCarryover: shipFasterCarryoverEnabled,
        });
  const memoryContextMs = Date.now() - chatPerfStartedAt - preflightMs - routeDiscoveryMs;
  activity.trace(`perf: memory ${Math.max(0, memoryContextMs)}ms`);
  let preparedMessage = withTerminalStyleInstruction(baseMessage);
  if (cliSkillPlan.enabled && cliSkillPlan.selected.length) {
    const chiferEnabled = await isChiferMcpEnabled().catch(() => false);
    preparedMessage = buildCliSkillsExecutionPrompt(preparedMessage, cliSkillPlan, {
      chiferEnabled,
      shipFasterCarryoverEnabled,
    });
  }
  let lastError = "Request failed";

  for (let i = 0; i < routeCandidates.length; i++) {
    const candidate = routeCandidates[i];
    const hasNext = i < routeCandidates.length - 1;
    const candidateStartedAt = Date.now();
    let usageForTelemetry: TokenUsage | null = null;

    try {
      currentRouteInfo = {
        provider: candidate.provider,
        modelId: candidate.model.id,
        modelName: candidate.model.name,
        contextWindow: candidate.model.contextWindow,
      };

      activity.setActor(buildProviderModelLabel(candidate.provider, candidate.model.name));
      activity.set(`${actionLabel}: selecting ${candidate.provider} route`);
      activity.setAgentStatus("Model", `${providerDisplayName(candidate.provider)} / ${candidate.model.id}`);
      activity.setAgentStatus("SDK", sdkLabelForProvider(candidate.provider));

      if (useParallelAgentExecution) {
        const mainStartedAt = Date.now();
        const mainHeartbeat = setInterval(() => {
          const elapsed = Math.max(1, Math.floor((Date.now() - mainStartedAt) / 1000));
          activity.setAgentStatus(
            "Main",
            `Refining (${elapsed}s): ${providerDisplayName(candidate.provider)} / ${candidate.model.id} | ${sdkLabelForProvider(candidate.provider)}`,
          );
        }, 4000);

        let resultText = "";
        let usage: TokenUsage | undefined;
        try {
          const result = await withTimeout(
            fetchRouteResponseOnce(candidate, preparedMessage, {
              fastMode: true,
              maxTokensCap: 1400,
            }),
            MAIN_FAST_TIMEOUT_MS,
            `Main refine ${providerDisplayName(candidate.provider)}`,
          );
          resultText = toPlainTerminalText(stripLeadingWhitespace(result.text || "")).trim() || "No response from AI.";
          usage = result.usage || buildEstimatedUsage(preparedMessage, resultText);
        } finally {
          clearInterval(mainHeartbeat);
        }

        recordUsage(currentRouteInfo, usage!);
        usageForTelemetry = usage!;
        activity.stop();
        const rendered = await printModelResponseLive(
          buildProviderModelLabel(candidate.provider, candidate.model.name),
          resultText,
        );
        const memoryUserMessage = options.saveUserMessage || message;
        void saveChatTurn(memoryUserMessage, rendered, candidate.provider, candidate.model.name).catch(() => undefined);
        await recordLastUsedModel(candidate.provider, candidate.model.id);
        if (usageForTelemetry) {
          void recordSchedulerTelemetry({
            provider: candidate.provider,
            modelId: candidate.model.id,
            usage: usageForTelemetry,
            latencyMs: Date.now() - candidateStartedAt,
            success: true,
          }).catch(() => undefined);
        }
        console.log("");
        return;
      }

      let finalResponseText = "";

      if (candidate.provider === "qwen") {
        const result = await renderQwenStreamResponse(candidate, preparedMessage, activity, mode);
        recordUsage(currentRouteInfo, result.usage);
        usageForTelemetry = result.usage;
        finalResponseText = result.responseText;
      } else if (candidate.provider === "openrouter") {
        const result = await renderOpenRouterStreamResponse(candidate, preparedMessage, activity, mode);
        recordUsage(currentRouteInfo, result.usage);
        usageForTelemetry = result.usage;
        finalResponseText = result.responseText;
      } else if (candidate.provider === "kilo") {
        const result = await renderKiloStreamResponse(candidate, preparedMessage, activity, mode);
        recordUsage(currentRouteInfo, result.usage);
        usageForTelemetry = result.usage;
        finalResponseText = result.responseText;
      } else if (candidate.provider === "minimax") {
        activity.set(`${actionLabel}: requesting MiniMax response`);
        const result = await fetchMiniMaxResponse(candidate, preparedMessage);
        activity.stop();
        const rendered = await printModelResponseLive(
          buildProviderModelLabel(candidate.provider, candidate.model.name),
          result.text,
        );
        finalResponseText = rendered;
        const usage = result.usage || buildEstimatedUsage(preparedMessage, rendered);
        recordUsage(currentRouteInfo, usage);
        usageForTelemetry = usage;
      } else if (candidate.provider === "antigravity") {
        const result = await renderAntigravityStreamResponse(candidate, preparedMessage, activity, mode);
        finalResponseText = result.responseText;
        recordUsage(currentRouteInfo, result.usage);
        usageForTelemetry = result.usage;
      } else {
        activity.set(`${actionLabel}: requesting Codex response`);
        const codexMessage = withCodexExecutionPolicy(preparedMessage);
        const codexStart = Date.now();
        const heartbeat = setInterval(() => {
          const elapsedSec = Math.max(1, Math.floor((Date.now() - codexStart) / 1000));
          activity.set(`${actionLabel}: Codex working (${elapsedSec}s)`);
        }, 4000);

        let text = "";
        try {
          text = await fetchCodexResponse(candidate, codexMessage, (status, detail) => {
            activity.set(status);
          });
        } finally {
          clearInterval(heartbeat);
        }
        activity.stop();
        const rendered = await printModelResponseLive(
          buildProviderModelLabel(candidate.provider, candidate.model.name),
          text,
        );
        finalResponseText = rendered;
        const usage = buildEstimatedUsage(preparedMessage, rendered);
        recordUsage(currentRouteInfo, usage);
        usageForTelemetry = usage;
      }

      activity.stop();
      const memoryUserMessage = options.saveUserMessage || message;
      void saveChatTurn(memoryUserMessage, finalResponseText, candidate.provider, candidate.model.name).catch(() => undefined);
      await recordLastUsedModel(candidate.provider, candidate.model.id);
      providerFailureCooldownUntil.delete(candidate.provider);
      if (usageForTelemetry) {
        const costUsd = estimateUsageCostUsd(candidate.provider, usageForTelemetry);
        void recordSchedulerTelemetry({
          provider: candidate.provider,
          modelId: candidate.model.id,
          usage: usageForTelemetry,
          latencyMs: Date.now() - candidateStartedAt,
          success: true,
        }).catch(() => undefined);
        if (schedulerConfig.enabled) {
          const costLabel = costUsd > 0 ? `$${costUsd.toFixed(5)}` : "$0.00000";
          console.log(`${gray}Scheduler:${reset} ${white}${candidate.provider}/${candidate.model.id}${reset} ${gray}| est cost ${costLabel}${reset}`);
        }
      }
      console.log("");
      return;
    } catch (error: any) {
      activity.stop();
      lastError = error?.message || "Request failed";
      void recordSchedulerTelemetry({
        provider: candidate.provider,
        modelId: candidate.model.id,
        usage: usageForTelemetry || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: Date.now() - candidateStartedAt,
        success: false,
      }).catch(() => undefined);

      if (hasNext && allowProviderFallback && shouldFallbackToNextProvider(lastError)) {
        providerFailureCooldownUntil.set(candidate.provider, Date.now() + PROVIDER_COOLDOWN_MS);
        console.log(`${gray}Provider limit reached. Switching to fallback provider...${reset}`);
        continue;
      }

      if (hasNext && allowProviderFallback) {
        providerFailureCooldownUntil.set(candidate.provider, Date.now() + PROVIDER_COOLDOWN_MS);
        console.log(`${gray}Current provider failed. Trying next provider...${reset}`);
        continue;
      }
    }
  }

  const responder = currentRouteInfo
    ? buildProviderModelLabel(currentRouteInfo.provider, currentRouteInfo.modelName)
    : "AI";
  console.log(`${cyan}${responder}${reset} ${red}>${reset} ${white}${lastError}${reset}`);
  console.log("");
}

async function summarizeCommandExecution(
  command: string,
  result: Awaited<ReturnType<typeof runShellCommand>>,
): Promise<void> {
  const prompt = buildCommandSummaryPrompt(command, result.exitCode, result.durationMs, result.output);
  await chatWithAI(prompt, {
    mode: "command-summary",
    saveUserMessage: `Command: ${command}`,
  });
}

function parseOnOffToken(value?: string): boolean | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "on" || lower === "true" || lower === "enable" || lower === "enabled") {
    return true;
  }
  if (lower === "off" || lower === "false" || lower === "disable" || lower === "disabled") {
    return false;
  }
  return null;
}

async function handleSchedulerCommand(rawCommand: string): Promise<void> {
  const tokens = rawCommand.trim().split(/\s+/);
  const sub = (tokens[1] || "status").toLowerCase();

  if (sub === "on" || sub === "off") {
    const next = await setSchedulerEnabled(sub === "on");
    console.log(`${green}Scheduler updated.${reset}`);
    for (const line of formatSchedulerConfigLines(next)) {
      console.log(`${white}${line}${reset}`);
    }
    console.log("");
    return;
  }

  if (sub === "quality") {
    const value = (tokens[2] || "").toLowerCase();
    if (value !== "economy" && value !== "balanced" && value !== "high") {
      console.log(`${red}Usage:${reset} /scheduler quality <economy|balanced|high>`);
      console.log("");
      return;
    }
    const next = await setSchedulerQualityTarget(value as SchedulerQualityTarget);
    console.log(`${green}Scheduler quality target updated to ${next.qualityTarget}.${reset}`);
    console.log("");
    return;
  }

  if (sub === "budget") {
    const value = (tokens[2] || "").toLowerCase();
    if (!value || value === "none" || value === "off") {
      const next = await setSchedulerMaxBudgetUsd(undefined);
      console.log(`${green}Scheduler budget cap cleared.${reset}`);
      for (const line of formatSchedulerConfigLines(next)) {
        console.log(`${white}${line}${reset}`);
      }
      console.log("");
      return;
    }

    const budget = Number.parseFloat(value);
    if (!Number.isFinite(budget) || budget <= 0) {
      console.log(`${red}Usage:${reset} /scheduler budget <usd|none>`);
      console.log("");
      return;
    }

    const next = await setSchedulerMaxBudgetUsd(budget);
    console.log(`${green}Scheduler budget cap set: $${budget.toFixed(4)}${reset}`);
    for (const line of formatSchedulerConfigLines(next)) {
      console.log(`${white}${line}${reset}`);
    }
    console.log("");
    return;
  }

  if (sub === "reset") {
    const next = await resetSchedulerConfig();
    console.log(`${green}Scheduler reset to defaults.${reset}`);
    for (const line of formatSchedulerConfigLines(next)) {
      console.log(`${white}${line}${reset}`);
    }
    console.log("");
    return;
  }

  const [config, topModels] = await Promise.all([loadSchedulerConfig(), loadSchedulerModelSummary(6)]);
  console.log(`\n${white}Cost-Aware Scheduler${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  for (const line of formatSchedulerConfigLines(config)) {
    console.log(`${white}${line}${reset}`);
  }
  if (topModels.length) {
    console.log("");
    console.log(`${white}Top models by success/cost:${reset}`);
    for (const item of topModels) {
      const successPct = (item.successRate * 100).toFixed(1);
      console.log(
        `${gray}- ${item.provider}/${item.modelId}${reset} ${white}| success ${successPct}% | avg cost $${item.avgCostUsd.toFixed(5)} | avg latency ${Math.round(item.avgLatencyMs)}ms | runs ${item.runs}${reset}`,
      );
    }
  }
  console.log("");
}

async function handlePolicyCommand(rawCommand: string): Promise<void> {
  const tokens = rawCommand.trim().split(/\s+/);
  const sub = (tokens[1] || "status").toLowerCase();

  if (sub === "strict" || sub === "balanced" || sub === "relaxed") {
    const next = await setPolicyMode(sub as PolicyMode, PROTECTED_WORKSPACE_ROOT);
    console.log(`${green}Policy mode updated: ${next.mode}${reset}`);
    console.log("");
    return;
  }

  if (sub === "on" || sub === "off") {
    const next = await setPolicyEnabled(sub === "on", PROTECTED_WORKSPACE_ROOT);
    console.log(`${green}Policy engine ${next.enabled ? "enabled" : "disabled"}.${reset}`);
    console.log("");
    return;
  }

  if (sub === "reset") {
    const next = await resetPolicyConfig(PROTECTED_WORKSPACE_ROOT);
    console.log(`${green}Policy config reset.${reset}`);
    for (const line of formatPolicyConfigLines(next)) {
      console.log(`${white}${line}${reset}`);
    }
    console.log("");
    return;
  }

  if (sub === "confirm") {
    const targetRaw = (tokens[2] || "").toLowerCase();
    const confirm = parseOnOffToken(tokens[3]);
    const target = targetRaw as ConfirmTarget;
    if (!["download", "install", "deploy", "workspace-write"].includes(targetRaw) || confirm === null) {
      console.log(`${red}Usage:${reset} /policy confirm <download|install|deploy|workspace-write> <on|off>`);
      console.log("");
      return;
    }
    const next = await setPolicyConfirmation(target, confirm, PROTECTED_WORKSPACE_ROOT);
    console.log(
      `${green}Policy confirmation updated: ${target} => ${next.requireConfirmation[target] ? "on" : "off"}${reset}`,
    );
    console.log("");
    return;
  }

  if (sub === "block") {
    const pattern = rawCommand.split(/\s+/).slice(2).join(" ").trim();
    if (!pattern) {
      console.log(`${red}Usage:${reset} /policy block <regex>`);
      console.log("");
      return;
    }
    const config = await loadPolicyConfig(PROTECTED_WORKSPACE_ROOT);
    config.blockedCommandPatterns = Array.from(new Set([...config.blockedCommandPatterns, pattern]));
    await savePolicyConfig(config);
    console.log(`${green}Added blocked regex pattern.${reset}`);
    console.log(`${gray}${pattern}${reset}`);
    console.log("");
    return;
  }

  if (sub === "unblock") {
    const pattern = rawCommand.split(/\s+/).slice(2).join(" ").trim();
    if (!pattern) {
      console.log(`${red}Usage:${reset} /policy unblock <regex>`);
      console.log("");
      return;
    }
    const config = await loadPolicyConfig(PROTECTED_WORKSPACE_ROOT);
    config.blockedCommandPatterns = config.blockedCommandPatterns.filter((item) => item !== pattern);
    await savePolicyConfig(config);
    console.log(`${green}Removed blocked regex pattern (if it existed).${reset}`);
    console.log("");
    return;
  }

  const config = await loadPolicyConfig(PROTECTED_WORKSPACE_ROOT);
  console.log(`\n${white}Policy / Permission Engine${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  for (const line of formatPolicyConfigLines(config)) {
    console.log(`${white}${line}${reset}`);
  }
  if (config.blockedCommandPatterns.length) {
    console.log("");
    console.log(`${white}Blocked regex patterns:${reset}`);
    for (const pattern of config.blockedCommandPatterns) {
      console.log(`${gray}- ${pattern}${reset}`);
    }
  }
  console.log("");
}

async function executeEvalCase(testCase: EvalCase): Promise<{
  output: string;
  provider: string;
  model: string;
  latencyMs: number;
}> {
  const routerConfig = await loadAiRouterConfig();
  const schedulerConfig = await loadSchedulerConfig();
  const baseCandidates = await buildAiRouteCandidates(testCase.prompt, { config: routerConfig });
  const candidates = reorderCandidatesWithScheduler(
    prioritizeHealthyCandidates(baseCandidates),
    testCase.prompt,
    schedulerConfig,
  );

  if (!candidates.length) {
    throw new Error("No authenticated model available for eval.");
  }

  let lastError = "Eval request failed.";
  for (const candidate of candidates) {
    const startedAt = Date.now();
    try {
      const result = await fetchRouteResponseOnce(candidate, withTerminalStyleInstruction(testCase.prompt), {
        fastMode: true,
        maxTokensCap: 900,
      });
      const output = toPlainTerminalText(stripLeadingWhitespace(result.text || "")).trim() || "No response.";
      const usage = result.usage || buildEstimatedUsage(testCase.prompt, output);
      const latencyMs = Date.now() - startedAt;
      void recordSchedulerTelemetry({
        provider: candidate.provider,
        modelId: candidate.model.id,
        usage,
        latencyMs,
        success: true,
      }).catch(() => undefined);
      return {
        output,
        provider: providerDisplayName(candidate.provider),
        model: candidate.model.id,
        latencyMs,
      };
    } catch (error: any) {
      lastError = error?.message || "Eval request failed.";
      const latencyMs = Date.now() - startedAt;
      void recordSchedulerTelemetry({
        provider: candidate.provider,
        modelId: candidate.model.id,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs,
        success: false,
      }).catch(() => undefined);
      continue;
    }
  }

  throw new Error(lastError);
}

async function handleEvalCommand(rawCommand: string): Promise<void> {
  const tokens = rawCommand.trim().split(/\s+/);
  const sub = (tokens[1] || "status").toLowerCase();

  if (sub === "init") {
    await ensureEvalHarnessFiles();
    console.log(`${green}Eval harness initialized.${reset}`);
    console.log(`${gray}Cases file:${reset} ${white}${getEvalCasesFilePath()}${reset}`);
    console.log("");
    return;
  }

  if (sub === "run" || sub === "gate") {
    await ensureEvalHarnessFiles();
    console.log(`${gray}Running eval harness on current router...${reset}`);
    console.log("");
    const run = await runEvalHarness({
      execute: executeEvalCase,
    });
    for (const line of formatEvalRunSummary(run)) {
      console.log(`${white}${line}${reset}`);
    }
    const failed = run.results.filter((item) => !item.passed).slice(0, 5);
    if (failed.length) {
      console.log("");
      console.log(`${white}Failed cases:${reset}`);
      for (const item of failed) {
        console.log(`${red}- ${item.id}${reset} ${gray}(${item.provider}/${item.model})${reset}`);
        if (item.reasons.length) {
          console.log(`${gray}  ${item.reasons.join("; ")}${reset}`);
        }
      }
    }
    console.log("");
    return;
  }

  if (sub === "leaderboard") {
    const board = await loadEvalLeaderboard(10);
    if (!board.length) {
      console.log(`${gray}No eval history yet. Run: /eval run${reset}`);
      console.log("");
      return;
    }
    console.log(`\n${white}Eval Leaderboard${reset}`);
    console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
    for (const row of board) {
      console.log(
        `${gray}- ${row.provider}/${row.model}${reset} ${white}| pass ${(row.passRate * 100).toFixed(1)}% | avg latency ${Math.round(row.avgLatencyMs)}ms | runs ${row.runs}${reset}`,
      );
    }
    console.log("");
    return;
  }

  if (sub === "trend") {
    const trend = await loadEvalTrend(6);
    if (!trend.length) {
      console.log(`${gray}No eval runs yet.${reset}`);
      console.log("");
      return;
    }
    console.log(`\n${white}Eval Trend (latest runs)${reset}`);
    console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
    for (const run of trend) {
      console.log(
        `${gray}- ${run.at}${reset} ${white}| pass ${(run.passRate * 100).toFixed(1)}% | failed ${run.failed}/${run.total} | gate ${run.blocked ? "BLOCKED" : "clear"}${reset}`,
      );
    }
    console.log("");
    return;
  }

  if (sub === "unblock") {
    const state = await clearEvalGateBlock();
    console.log(`${green}Eval regression gate cleared manually.${reset}`);
    console.log(`${gray}Threshold:${reset} ${white}${(state.threshold * 100).toFixed(1)}%${reset}`);
    console.log("");
    return;
  }

  const gate = await loadEvalGateState();
  console.log(`\n${white}Eval Harness${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log(`${white}Cases file:${reset} ${getEvalCasesFilePath()}`);
  console.log(`${white}Gate status:${reset} ${gate.blocked ? `${red}BLOCKED${reset}` : `${green}clear${reset}`}`);
  if (Number.isFinite(gate.passRate)) {
    console.log(`${white}Last pass rate:${reset} ${((gate.passRate || 0) * 100).toFixed(1)}%`);
  }
  if (Number.isFinite(gate.regressionDelta)) {
    console.log(`${white}Last regression delta:${reset} ${((gate.regressionDelta || 0) * 100).toFixed(1)}%`);
  }
  console.log(`${white}Threshold:${reset} ${(gate.threshold * 100).toFixed(1)}%`);
  console.log("");
  console.log(`${gray}Commands:${reset}`);
  console.log(`${white}/eval init${reset} ${gray}- create default eval files${reset}`);
  console.log(`${white}/eval run${reset} ${gray}- run benchmark + update regression gate${reset}`);
  console.log(`${white}/eval leaderboard${reset} ${gray}- best model/provider stats${reset}`);
  console.log(`${white}/eval trend${reset} ${gray}- latest pass/fail trend${reset}`);
  console.log(`${white}/eval unblock${reset} ${gray}- clear current block manually${reset}`);
  console.log("");
}

async function handleCommand(command: string) {
  const cmd = command.trim().toLowerCase();

  if (cmd === "__ctrl_c__") {
    const hadPersonalMode = await hasSelectedModelOverride();
    if (hadPersonalMode) {
      await clearSelectedModelOverride();
      currentRouteInfo = null;
      console.log(`${green}Returned to default routing from personal model selection.${reset}`);
      console.log("");
      return;
    }
    console.log(`\n${gray}Goodbye!${reset}\n`);
    process.exit(0);
  }

  if (isBackCommand(cmd)) {
    const result = await runBackToMain();
    if (result.clearedPersonalMode) {
      currentRouteInfo = null;
    }
    console.log(`${gray}${result.message}${reset}`);
    console.log("");
    return;
  }

  if (cmd === "/executor" || cmd === "/executor-log" || cmd.startsWith("/executor ")) {
    const showAll = /\ball\b/.test(cmd);
    printExecutorLogSession(showAll);
    return;
  }

  const firecrawlCliIntent = resolveFirecrawlCliIntent(command);
  if (firecrawlCliIntent) {
    if (firecrawlCliIntent.type === "menu") {
      await runFirecrawlConnectMenu();
      console.clear();
      showLogo();
      showMainInterface();
      return;
    }

    if (firecrawlCliIntent.type === "set-key") {
      if (!firecrawlCliIntent.apiKey) {
        console.log(`${red}Firecrawl key missing.${reset}`);
        console.log(`${gray}Use:${reset} ${white}/firecrawl set-key fc-xxxxxxxx${reset}`);
        console.log(`${gray}Or:${reset} ${white}/connect → Tools → Firecrawl → Set API Key${reset}`);
        console.log("");
        return;
      }

      try {
        await setFirecrawlApiKey(firecrawlCliIntent.apiKey);
        console.log(`${green}✓ Firecrawl API key saved.${reset}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unable to save Firecrawl API key.";
        console.log(`${red}Firecrawl failed:${reset} ${white}${message}${reset}`);
      }
      console.log("");
      return;
    }

    if (firecrawlCliIntent.type === "clear-key") {
      try {
        await clearFirecrawlApiKey();
        console.log(`${green}✓ Firecrawl API key cleared.${reset}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unable to clear Firecrawl API key.";
        console.log(`${red}Firecrawl failed:${reset} ${white}${message}${reset}`);
      }
      console.log("");
      return;
    }

    if (firecrawlCliIntent.type === "help") {
      if (firecrawlCliIntent.reason) {
        console.log(`${red}${firecrawlCliIntent.reason}${reset}`);
      }
      console.log(buildFirecrawlUsage());
      console.log("");
      return;
    }

    try {
      const response = await executeFirecrawlIntentWithActivity(command, firecrawlCliIntent.intent);
      const rendered = await printModelResponseLive("Firecrawl", response);
      void saveChatTurn(command, rendered, "system-firecrawl", "Firecrawl").catch(() => undefined);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Firecrawl command failed.";
      console.log(`${red}Firecrawl failed:${reset} ${white}${message}${reset}`);
      console.log(`${gray}System Executor details:${reset} ${white}/executor${reset}`);
      console.log("");
    }
    return;
  }

  if (cmd.startsWith("/eval")) {
    await handleEvalCommand(command);
    return;
  }

  if (cmd.startsWith("/scheduler")) {
    await handleSchedulerCommand(command);
    return;
  }

  if (cmd.startsWith("/policy")) {
    await handlePolicyCommand(command);
    return;
  }

  const commandIntent = extractCommandIntent(command);
  const fsIntent = extractFileSystemIntent(command);

  if (fsIntent) {
    const fsActivity = new AiLiveActivity();
    fsActivity.start(`detected file task: ${fsIntent.kind}`, "File System");

    let targetPath = "";
    try {
      targetPath = resolvePathFromInput(fsIntent.path);
    } catch (error: any) {
      fsActivity.stop();
      console.log(`${red}File task failed:${reset} ${white}${error?.message || "Invalid path"}${reset}`);
      console.log("");
      return;
    }

    const policyConfig = await loadPolicyConfig(PROTECTED_WORKSPACE_ROOT);
    if (
      policyConfig.enabled &&
      policyConfig.readOnlyWorkspace &&
      isWriteLikeFsIntentKind(fsIntent.kind) &&
      isWorkspacePath(targetPath)
    ) {
      fsActivity.stop();
      console.log(`${red}Blocked:${reset} workspace write blocked by policy engine (read-only workspace mode).`);
      console.log("");
      return;
    }

    if (isWriteLikeFsIntentKind(fsIntent.kind) && isWorkspacePath(targetPath) && !isAllowedWorkspaceWritePath(targetPath)) {
      fsActivity.stop();
      renderReadOnlyPolicyHint();
      return;
    }

    if (isProtectedWorkspacePath(targetPath)) {
      fsActivity.stop();
      console.log(`${red}Blocked:${reset} protected workspace access is disabled for now.`);
      console.log(`${gray}Target:${reset} ${white}${targetPath}${reset}`);
      console.log(`${gray}Protected:${reset} ${white}${PROTECTED_WORKSPACE_ROOT}${reset}`);
      console.log("");
      return;
    }

    fsActivity.set(`executing ${fsIntent.kind}`);
    try {
      const result = await runFileSystemIntent(fsIntent);
      fsActivity.stop();
      console.log(`${green}${result.message}.${reset}`);
      console.log(`${gray}Path:${reset} ${white}${result.absolutePath}${reset}`);
      console.log("");
      return;
    } catch (error: any) {
      fsActivity.stop();
      console.log(`${red}File task failed: ${error?.message || "Unknown error"}${reset}`);
      console.log("");
      return;
    }
  }

  if (commandIntent) {
    const commandActivity = new AiLiveActivity();
    commandActivity.start(`detected command: ${commandIntent.command}`, "Command Runner");
    const commandCwd = CLI_HOME_DIR;

    if (!commandIntent.explicit) {
      commandActivity.stop();
      console.log(`${red}Blocked:${reset} Implicit shell execution is disabled.`);
      console.log(`${gray}Use explicit command:${reset} ${white}/cmd <read-only-command>${reset}`);
      console.log("");
      return;
    }

    if (commandTouchesProtectedWorkspace(commandIntent.command)) {
      commandActivity.stop();
      console.log(`${red}Blocked:${reset} protected workspace access is disabled for this command.`);
      console.log(`${gray}Protected:${reset} ${white}${PROTECTED_WORKSPACE_ROOT}${reset}`);
      console.log("");
      return;
    }

    const policyConfig = await loadPolicyConfig(PROTECTED_WORKSPACE_ROOT);
    const policyDecision = evaluateCommandPolicy(commandIntent.command, command, policyConfig);
    if (!policyDecision.allowed) {
      commandActivity.stop();
      console.log(`${red}Blocked:${reset} ${policyDecision.reason || "Command blocked by policy engine."}`);
      console.log("");
      return;
    }
    if (policyDecision.requiresConfirmation) {
      commandActivity.stop();
      console.log(`${red}Blocked:${reset} ${policyDecision.reason || "Command needs explicit permission phrase."}`);
      if (policyDecision.confirmHint) {
        console.log(`${gray}Add permission phrase:${reset} ${white}${policyDecision.confirmHint}${reset}`);
      }
      console.log("");
      return;
    }

    if (isHarmfulCommand(commandIntent.command)) {
      commandActivity.stop();
      console.log(`${red}Blocked:${reset} Harmful/destructive command is not allowed.`);
      console.log("");
      return;
    }

    if (commandWritesRestrictedWorkspace(commandIntent.command)) {
      commandActivity.stop();
      renderReadOnlyPolicyHint();
      return;
    }

    commandActivity.set(`running: ${commandIntent.command}`);
    let sawOutput = false;
    const traceCommandChunk = (chunk: string, source: "stdout" | "stderr") => {
      const lines = extractProgressLines(chunk);
      if (!lines.length) {
        return;
      }

      for (const line of lines) {
        const clipped = line.length > 150 ? `${line.slice(0, 150)}...` : line;
        commandActivity.trace(`${source}: ${clipped}`);
      }
    };

    const result = await runShellCommand(commandIntent.command, {
      cwd: commandCwd,
      onStdout: (chunk) => {
        if (!sawOutput) {
          sawOutput = true;
          commandActivity.set(`streaming output: ${commandIntent.command}`);
        }
        traceCommandChunk(chunk, "stdout");
      },
      onStderr: (chunk) => {
        if (!sawOutput) {
          sawOutput = true;
          commandActivity.set(`streaming output: ${commandIntent.command}`);
        }
        traceCommandChunk(chunk, "stderr");
      },
    });
    commandActivity.stop();

    console.log(`${gray}Running: ${commandIntent.command}${reset}`);
    const commandOutput = trimToMaxChars(stripAnsi(result.output).trim(), 5000);
    if (commandOutput) {
      console.log(commandOutput);
      console.log("");
    }

    const statusLine =
      result.exitCode === 0
        ? `${green}Command finished successfully.${reset}`
        : `${red}Command failed (exit ${result.exitCode}).${reset}`;
    console.log(statusLine);
    console.log(`${gray}Duration: ${formatDurationMs(result.durationMs)}${reset}`);
    console.log("");

    const commandMemoryRecord = [
      `Command: ${commandIntent.command}`,
      `Status: ${result.exitCode === 0 ? "success" : `failed (exit ${result.exitCode ?? "unknown"})`}`,
      `Duration: ${formatDurationMs(result.durationMs)}`,
      "",
      "Output:",
      trimToMaxChars(commandOutput || "(no output)", 2200),
    ].join("\n");
    void saveChatTurn(`Command: ${commandIntent.command}`, commandMemoryRecord, "system-command", "Command Runner").catch(
      () => undefined,
    );

    return;
  }

  switch (cmd) {
    case '/help':
      console.log(`\n${white}Available commands:${reset}`);
      console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
      console.log(`  ${orange}▸${reset} ${orange}/ai       ${reset} ${gray}│${reset} AI features menu`);
      console.log(`  ${orange}▸${reset} ${orange}/model    ${reset} ${gray}│${reset} Select AI model`);
      console.log(`  ${orange}▸${reset} ${orange}/connect  ${reset} ${gray}│${reset} Connect providers and tools`);
      console.log(`  ${orange}▸${reset} ${orange}/skills   ${reset} ${gray}│${reset} CLI skills settings`);
      console.log(`  ${orange}▸${reset} ${orange}/telegram ${reset} ${gray}│${reset} Telegram bot setup and run`);
      console.log(`  ${orange}▸${reset} ${orange}/stats    ${reset} ${gray}│${reset} Toggle mode/tokens line`);
      console.log(`  ${orange}▸${reset} ${orange}/back,/b  ${reset} ${gray}│${reset} Return to main routing`);
      console.log(`  ${orange}▸${reset} ${orange}/exit     ${reset} ${gray}│${reset} Exit the application`);
      console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
      console.log('');
      break;
    case '/stats':
    case '/st':
      showPromptMetrics = !showPromptMetrics;
      console.log(
        `${gray}Prompt metrics ${showPromptMetrics ? `${green}enabled` : `${orange}disabled`}${gray}.${reset}`,
      );
      console.log("");
      break;
    case '/ai':
      await runAiCommand();
      await renderPostAiInterface();
      break;
    case '/model':
      await runModelCommand();
      console.clear();
      showLogo();
      showMainInterface();
      break;
    case '/connect':
      await runConnectCommand();
      console.clear();
      showLogo();
      showMainInterface();
      break;
    case '/skills':
      await runSkillsConnectMenu();
      console.clear();
      showLogo();
      showMainInterface();
      break;
    case '/eval':
      await handleEvalCommand(command);
      break;
    case '/scheduler':
      await handleSchedulerCommand(command);
      break;
    case '/policy':
      await handlePolicyCommand(command);
      break;
    case '/telegram':
      await runTelegramCommand();
      console.clear();
      showLogo();
      showMainInterface();
      break;
    case '/status':
      const isQwenAuth = await loadQwenToken();
      const isMiniMaxAuth = await loadMiniMaxToken();
      const isCodexAuth = await loadCodexToken();
      const isAntigravityAuth = await loadAntigravityToken();
      const isOpenRouterAuth = await loadOpenRouterToken();
      const isKiloAuth = await loadKiloToken();
      const isTelegramAuth = await isTelegramAuthenticated();
      const telegramAgentRunning = isTelegramAgentRunning();
      const [schedulerConfig, policyConfig, evalGate] = await Promise.all([
        loadSchedulerConfig(),
        loadPolicyConfig(PROTECTED_WORKSPACE_ROOT),
        loadEvalGateState(),
      ]);
      console.log(`\n${white}System Status:${reset}`);
      console.log(`  ${orange}✓${reset} Khalid AI CLI is running`);
      console.log(`  ${isQwenAuth ? green : orange}${isQwenAuth ? '✓' : '○'}${reset} Qwen Authentication: ${isQwenAuth ? `${green}Connected` : `${gray}Not connected`}${reset}`);
      console.log(`  ${isMiniMaxAuth ? green : orange}${isMiniMaxAuth ? '✓' : '○'}${reset} MiniMax Authentication: ${isMiniMaxAuth ? `${green}Connected` : `${gray}Not connected`}${reset}`);
      console.log(`  ${isCodexAuth ? green : orange}${isCodexAuth ? '✓' : '○'}${reset} Codex Authentication: ${isCodexAuth ? `${green}Connected` : `${gray}Not connected`}${reset}`);
      console.log(`  ${isAntigravityAuth ? green : orange}${isAntigravityAuth ? '✓' : '○'}${reset} Antigravity Authentication: ${isAntigravityAuth ? `${green}Connected` : `${gray}Not connected`}${reset}`);
      console.log(`  ${isOpenRouterAuth ? green : orange}${isOpenRouterAuth ? '✓' : '○'}${reset} OpenRouter Authentication: ${isOpenRouterAuth ? `${green}Connected` : `${gray}Not connected`}${reset}`);
      console.log(`  ${isKiloAuth ? green : orange}${isKiloAuth ? '✓' : '○'}${reset} Kilo Authentication: ${isKiloAuth ? `${green}Connected` : `${gray}Not connected`}${reset}`);
      console.log(`  ${isTelegramAuth ? green : orange}${isTelegramAuth ? '✓' : '○'}${reset} Telegram Authentication: ${isTelegramAuth ? `${green}Connected` : `${gray}Not connected`}${reset}`);
      console.log(`  ${telegramAgentRunning ? green : orange}${telegramAgentRunning ? '✓' : '○'}${reset} Telegram Agent: ${telegramAgentRunning ? `${green}Running` : `${gray}Stopped`}${reset}`);
      console.log(`  ${schedulerConfig.enabled ? green : orange}${schedulerConfig.enabled ? '✓' : '○'}${reset} Scheduler: ${schedulerConfig.enabled ? `${green}${schedulerConfig.qualityTarget}` : `${gray}disabled`}${reset}`);
      console.log(`  ${policyConfig.enabled ? green : orange}${policyConfig.enabled ? '✓' : '○'}${reset} Policy Engine: ${policyConfig.enabled ? `${green}${policyConfig.mode}` : `${gray}disabled`}${reset}`);
      console.log(`  ${evalGate.blocked ? red : green}${evalGate.blocked ? '✗' : '✓'}${reset} Eval Gate: ${evalGate.blocked ? `${red}BLOCKED` : `${green}clear`}${reset}`);
      console.log('');
      break;
    case '/clear':
      console.clear();
      showLoading().then(() => {
        showLogo();
        showMainInterface();
      });
      return;
    case '/exit':
      console.log(`\n${gray}Goodbye!${reset}\n`);
      process.exit(0);
    default:
      // If not a command, treat as chat message
      if (command.trim()) {
        await chatWithAI(command);
      }
  }
}

async function main() {
  console.clear();
  await showLoading();
  await ensureRuntimeGuardrails();
  await ensureMemoryDirectories();
  await ensureTodoStore();
  showLogo();
  showMainInterface();
  await ensureTelegramAgentBackground({ silent: true });

  while (true) {
    if (showPromptMetrics) {
      await renderPromptStatus();
    }
    const input = await prompt();
    await handleCommand(input);
  }
}

main().catch(console.error);
