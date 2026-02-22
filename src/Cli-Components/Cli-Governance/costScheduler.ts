#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";
import type { AiRouteCandidate } from "../Cli-Comand/Ai.js";

type SchedulerQualityTarget = "economy" | "balanced" | "high";

type SchedulerConfig = {
  enabled: boolean;
  qualityTarget: SchedulerQualityTarget;
  maxUsdPerTask?: number;
  updatedAt: string;
};

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type SchedulerTelemetryEntry = {
  at: string;
  provider: AiRouteCandidate["provider"];
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
};

type SchedulerModelSummary = {
  provider: AiRouteCandidate["provider"];
  modelId: string;
  runs: number;
  successRate: number;
  avgCostUsd: number;
  avgLatencyMs: number;
};

const STORE_DIR = join(homedir(), ".hakathone", "store");
const SCHEDULER_CONFIG_FILE = join(STORE_DIR, "scheduler-config.json");
const SCHEDULER_TELEMETRY_FILE = join(STORE_DIR, "scheduler-telemetry.jsonl");

const PROVIDER_COST_PER_1K_TOKENS: Record<AiRouteCandidate["provider"], number> = {
  qwen: 0.0008,
  minimax: 0.0012,
  codex: 0.012,
  antigravity: 0.01,
  openrouter: 0.0035,
  kilo: 0.0025,
};

function nowIso(): string {
  return new Date().toISOString();
}

function defaultSchedulerConfig(): SchedulerConfig {
  return {
    enabled: true,
    qualityTarget: "balanced",
    maxUsdPerTask: undefined,
    updatedAt: nowIso(),
  };
}

function normalizeSchedulerConfig(raw?: Partial<SchedulerConfig>): SchedulerConfig {
  const qualityTarget: SchedulerQualityTarget =
    raw?.qualityTarget === "economy" || raw?.qualityTarget === "high" ? raw.qualityTarget : "balanced";
  const maxUsdPerTask =
    Number.isFinite(raw?.maxUsdPerTask) && Number(raw?.maxUsdPerTask) > 0
      ? Number(raw?.maxUsdPerTask)
      : undefined;
  return {
    enabled: raw?.enabled !== false,
    qualityTarget,
    maxUsdPerTask,
    updatedAt: raw?.updatedAt || nowIso(),
  };
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function loadSchedulerConfig(): Promise<SchedulerConfig> {
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(SCHEDULER_CONFIG_FILE, "utf-8");
    return normalizeSchedulerConfig(JSON.parse(raw) as Partial<SchedulerConfig>);
  } catch {
    return defaultSchedulerConfig();
  }
}

export async function saveSchedulerConfig(config: SchedulerConfig): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  const normalized = normalizeSchedulerConfig(config);
  normalized.updatedAt = nowIso();
  await fs.writeFile(SCHEDULER_CONFIG_FILE, JSON.stringify(normalized, null, 2), "utf-8");
}

export async function resetSchedulerConfig(): Promise<SchedulerConfig> {
  const next = defaultSchedulerConfig();
  await saveSchedulerConfig(next);
  return next;
}

export async function setSchedulerEnabled(enabled: boolean): Promise<SchedulerConfig> {
  const config = await loadSchedulerConfig();
  config.enabled = enabled;
  await saveSchedulerConfig(config);
  return config;
}

export async function setSchedulerQualityTarget(
  qualityTarget: SchedulerQualityTarget,
): Promise<SchedulerConfig> {
  const config = await loadSchedulerConfig();
  config.qualityTarget = qualityTarget;
  await saveSchedulerConfig(config);
  return config;
}

export async function setSchedulerMaxBudgetUsd(maxUsdPerTask?: number): Promise<SchedulerConfig> {
  const config = await loadSchedulerConfig();
  config.maxUsdPerTask =
    Number.isFinite(maxUsdPerTask) && Number(maxUsdPerTask) > 0
      ? Number(maxUsdPerTask)
      : undefined;
  await saveSchedulerConfig(config);
  return config;
}

function estimatePromptTokens(prompt: string): number {
  const raw = Math.ceil((prompt || "").length / 4);
  return Math.max(1, raw);
}

function promptComplexityScore(prompt: string): number {
  const lower = prompt.toLowerCase();
  let score = 0.25;
  if (/(debug|bug|refactor|migrate|architecture|security|optimiz)/.test(lower)) score += 0.2;
  if (/(system|executor|deploy|rollback|incident|production)/.test(lower)) score += 0.2;
  if (/(research|benchmark|compare|analysis|investigate)/.test(lower)) score += 0.15;
  if (lower.length > 500) score += 0.1;
  if (/(image|vision|video|audio)/.test(lower)) score += 0.1;
  return Math.min(1, Math.max(0, score));
}

function providerQualityBase(provider: AiRouteCandidate["provider"]): number {
  if (provider === "codex") return 0.95;
  if (provider === "antigravity") return 0.92;
  if (provider === "openrouter") return 0.86;
  if (provider === "kilo") return 0.82;
  if (provider === "minimax") return 0.78;
  return 0.72;
}

function modelQualityBoost(modelName: string): number {
  const lower = modelName.toLowerCase();
  if (/(opus|gpt-5|thinking|sonnet)/.test(lower)) return 0.06;
  if (/(mini|haiku|flash)/.test(lower)) return -0.04;
  return 0;
}

function normalizedCandidateCost(provider: AiRouteCandidate["provider"], prompt: string): number {
  const promptTokens = estimatePromptTokens(prompt);
  const estimatedTotalTokens = Math.max(120, Math.floor(promptTokens * 1.4));
  const usd = (estimatedTotalTokens / 1000) * PROVIDER_COST_PER_1K_TOKENS[provider];
  const capped = Math.min(0.08, Math.max(0.0001, usd));
  return capped / 0.08;
}

function candidateScore(
  candidate: AiRouteCandidate,
  prompt: string,
  config: SchedulerConfig,
): number {
  const complexity = promptComplexityScore(prompt);
  const cost = normalizedCandidateCost(candidate.provider, prompt);
  const quality = Math.min(
    1,
    Math.max(0, providerQualityBase(candidate.provider) + modelQualityBoost(candidate.model.name)),
  );
  const effectiveQuality = Math.min(1, Math.max(0, quality - (0.12 * Math.max(0, complexity - 0.6))));
  const qualityPenalty = 1 - effectiveQuality;

  let costWeight = 0.5;
  let qualityWeight = 0.5;
  if (config.qualityTarget === "economy") {
    costWeight = 0.72;
    qualityWeight = 0.28;
  } else if (config.qualityTarget === "high") {
    costWeight = 0.25;
    qualityWeight = 0.75;
  }

  return (cost * costWeight) + (qualityPenalty * qualityWeight);
}

function withinBudgetCandidate(
  candidate: AiRouteCandidate,
  prompt: string,
  maxUsdPerTask?: number,
): boolean {
  if (!Number.isFinite(maxUsdPerTask) || !maxUsdPerTask || maxUsdPerTask <= 0) {
    return true;
  }
  const promptTokens = estimatePromptTokens(prompt);
  const estimatedTotalTokens = Math.max(120, Math.floor(promptTokens * 1.4));
  const usd = (estimatedTotalTokens / 1000) * PROVIDER_COST_PER_1K_TOKENS[candidate.provider];
  return usd <= maxUsdPerTask;
}

export function reorderCandidatesWithScheduler(
  candidates: AiRouteCandidate[],
  prompt: string,
  config: SchedulerConfig,
): AiRouteCandidate[] {
  if (!config.enabled || candidates.length <= 1) {
    return candidates;
  }

  const scored = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: candidateScore(candidate, prompt, config),
      inBudget: withinBudgetCandidate(candidate, prompt, config.maxUsdPerTask),
    }))
    .sort((a, b) => {
      if (a.inBudget !== b.inBudget) {
        return a.inBudget ? -1 : 1;
      }
      if (a.score === b.score) {
        return a.index - b.index;
      }
      return a.score - b.score;
    });

  return scored.map((item) => item.candidate);
}

export function estimateUsageCostUsd(
  provider: AiRouteCandidate["provider"],
  usage: TokenUsage,
): number {
  const total = Math.max(0, Number(usage?.totalTokens || 0));
  const unit = PROVIDER_COST_PER_1K_TOKENS[provider] || 0;
  return Number(((total / 1000) * unit).toFixed(6));
}

export async function recordSchedulerTelemetry(params: {
  provider: AiRouteCandidate["provider"];
  modelId: string;
  usage: TokenUsage;
  latencyMs: number;
  success: boolean;
}): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  const entry: SchedulerTelemetryEntry = {
    at: nowIso(),
    provider: params.provider,
    modelId: params.modelId,
    promptTokens: Math.max(0, Math.floor(params.usage.promptTokens || 0)),
    completionTokens: Math.max(0, Math.floor(params.usage.completionTokens || 0)),
    totalTokens: Math.max(0, Math.floor(params.usage.totalTokens || 0)),
    estimatedCostUsd: estimateUsageCostUsd(params.provider, params.usage),
    latencyMs: Math.max(0, Math.floor(params.latencyMs || 0)),
    success: Boolean(params.success),
  };
  await fs.appendFile(SCHEDULER_TELEMETRY_FILE, `${JSON.stringify(entry)}\n`, "utf-8");
}

async function loadTelemetryEntries(limit = 400): Promise<SchedulerTelemetryEntry[]> {
  const fs = await import("node:fs/promises");
  try {
    const raw = await fs.readFile(SCHEDULER_TELEMETRY_FILE, "utf-8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit);
    const items: SchedulerTelemetryEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SchedulerTelemetryEntry;
        if (!parsed?.provider || !parsed?.modelId) continue;
        items.push(parsed);
      } catch {
        continue;
      }
    }
    return items;
  } catch {
    return [];
  }
}

export async function loadSchedulerModelSummary(limit = 6): Promise<SchedulerModelSummary[]> {
  const entries = await loadTelemetryEntries();
  const byModel = new Map<string, SchedulerModelSummary>();

  for (const item of entries) {
    const key = `${item.provider}:${item.modelId}`;
    const existing = byModel.get(key);
    if (!existing) {
      byModel.set(key, {
        provider: item.provider,
        modelId: item.modelId,
        runs: 1,
        successRate: item.success ? 1 : 0,
        avgCostUsd: item.estimatedCostUsd,
        avgLatencyMs: item.latencyMs,
      });
      continue;
    }

    const nextRuns = existing.runs + 1;
    existing.successRate = ((existing.successRate * existing.runs) + (item.success ? 1 : 0)) / nextRuns;
    existing.avgCostUsd = ((existing.avgCostUsd * existing.runs) + item.estimatedCostUsd) / nextRuns;
    existing.avgLatencyMs = ((existing.avgLatencyMs * existing.runs) + item.latencyMs) / nextRuns;
    existing.runs = nextRuns;
  }

  return Array.from(byModel.values())
    .sort((a, b) => b.successRate - a.successRate || a.avgCostUsd - b.avgCostUsd)
    .slice(0, limit);
}

export function formatSchedulerConfigLines(config: SchedulerConfig): string[] {
  return [
    `Scheduler: ${config.enabled ? "enabled" : "disabled"}`,
    `Quality target: ${config.qualityTarget}`,
    `Budget cap: ${config.maxUsdPerTask ? `$${config.maxUsdPerTask.toFixed(4)} / task` : "none"}`,
    `Updated: ${config.updatedAt}`,
  ];
}

export type { SchedulerConfig, SchedulerQualityTarget, TokenUsage };

