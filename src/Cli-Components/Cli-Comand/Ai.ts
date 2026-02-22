#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";
import {
  getQwenModels,
  loadQwenConfig,
  loadQwenToken,
  resolveQwenBaseUrl,
  type QwenModel,
  type QwenToken,
} from "../Cli-Extenshone/Qwen/qwen.js";
import {
  getMiniMaxModels,
  loadMiniMaxConfig,
  loadMiniMaxToken,
  resolveMiniMaxBaseUrl,
  type MiniMaxModel,
  type MiniMaxToken,
} from "../Cli-Extenshone/Minimax/minimax.js";
import {
  getCodexModels,
  loadCodexConfig,
  loadCodexToken,
  type CodexModel,
  type CodexToken,
} from "../Cli-Extenshone/Codex/codex.js";
import {
  getAntigravityModels,
  loadAntigravityConfig,
  loadAntigravityToken,
  normalizeAntigravityModelId,
  resolveAntigravityBaseUrl,
  type AntigravityModel,
  type AntigravityToken,
} from "../Cli-Extenshone/Antigravity/antigravity.js";
import {
  getOpenRouterModels,
  loadOpenRouterConfig,
  loadOpenRouterToken,
  resolveOpenRouterBaseUrl,
  type OpenRouterModel,
  type OpenRouterToken,
} from "../Cli-Extenshone/Openrouter/openrouter.js";
import {
  getKiloModels,
  loadKiloConfig,
  loadKiloToken,
  resolveKiloBaseUrl,
  type KiloModel,
  type KiloToken,
} from "../Cli-Extenshone/Kilo/kilo.js";
import {
  AGENT_MEMORY_DIR,
  ensureMemoryDirectories,
  runAgentMemoryMenu,
  runChatSessionMenu,
  runMemoryMenu,
  runResetMenu,
} from "./memory.js";

const orange = "\x1b[38;2;249;115;22m";
const cyan = "\x1b[38;2;34;211;238m";
const green = "\x1b[38;2;34;197;94m";
const gray = "\x1b[90m";
const white = "\x1b[38;2;229;231;235m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const AI_CONFIG_FILE = join(STORE_DIR, "ai-router.json");
const AGENT_USAGE_STATE_FILE = join(STORE_DIR, "agent-usage.json");
const AI_ROLE_STATE_FILE = join(STORE_DIR, "ai-role.json");
const AGENT_CREATION_FEATURE_ENABLED = false;
const AI_FIXED_LABEL = "Khalid AI";

export type ProviderId = "qwen" | "minimax" | "codex" | "antigravity" | "openrouter" | "kilo";

type ProviderMode = "auto" | "fixed";

type ProviderSettings = {
  mode: ProviderMode;
  fixedModelId?: string;
};

type SelectedModelSettings = {
  enabled: boolean;
  provider?: ProviderId;
  mode: ProviderMode;
  fixedModelId?: string;
};

type LastUsedModelSettings = {
  provider?: ProviderId;
  modelId?: string;
};

type AiRouterConfig = {
  defaultProvider: "auto" | ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
  selectedModel: SelectedModelSettings;
  lastUsedModel: LastUsedModelSettings;
};

type MenuItem<T extends string | number> = {
  key: T;
  label: string;
  description: string;
};

type UiModel = {
  id: string;
  name: string;
  maxTokens: number;
};

type AgentRole = "main" | "developer" | "researcher" | "designer" | "custom";

export type ActiveAiRoleProfile = {
  role: AgentRole;
  label: string;
  instructions: string;
  updatedAt: string;
};

export type CreatedAgentProfile = {
  id: string;
  fileName: string;
  filePath: string;
  name: string;
  role: AgentRole;
  parentAgent: string;
  keywords: string[];
  summary: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
};

type AgentUsageState = {
  autoEnabled: boolean;
  selectedAgentIds: string[];
  mainAgentId?: string;
  updatedAt: string;
};

export type ActiveAgentPlan = {
  mode: "auto" | "custom";
  reason: string;
  mainAgent: CreatedAgentProfile;
  workerAgents: CreatedAgentProfile[];
  selectedAgents: CreatedAgentProfile[];
};

function truncateLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function dedupeUiModels(models: UiModel[]): UiModel[] {
  const seen = new Set<string>();
  const unique: UiModel[] = [];

  for (const model of models) {
    const id = model.id?.trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      id,
      name: model.name?.trim() || id,
      maxTokens: Number.isFinite(model.maxTokens) && model.maxTokens > 0 ? model.maxTokens : 4096,
    });
  }

  return unique;
}

export type AiRouteCandidate =
  | {
      provider: "qwen";
      model: QwenModel;
      token: QwenToken;
      baseUrl: string;
    }
  | {
      provider: "minimax";
      model: MiniMaxModel;
      token: MiniMaxToken;
      baseUrl: string;
    }
  | {
      provider: "codex";
      model: CodexModel;
      token: CodexToken;
    }
  | {
      provider: "antigravity";
      model: AntigravityModel;
      token: AntigravityToken;
      baseUrl: string;
    }
  | {
      provider: "openrouter";
      model: OpenRouterModel;
      token: OpenRouterToken;
      baseUrl: string;
    }
  | {
      provider: "kilo";
      model: KiloModel;
      token: KiloToken;
      baseUrl: string;
    };

function defaultAiRouterConfig(): AiRouterConfig {
  return {
    defaultProvider: "auto",
    providers: {
      qwen: { mode: "auto" },
      minimax: { mode: "auto" },
      codex: { mode: "auto" },
      antigravity: { mode: "auto" },
      openrouter: { mode: "auto" },
      kilo: { mode: "auto" },
    },
    selectedModel: {
      enabled: false,
      mode: "auto",
    },
    lastUsedModel: {},
  };
}

function normalizeConfig(raw?: Partial<AiRouterConfig>): AiRouterConfig {
  const fallback = defaultAiRouterConfig();
  const providersAny = ((raw?.providers ?? {}) as Record<string, ProviderSettings | undefined>);
  const providers: Partial<Record<ProviderId, ProviderSettings>> = providersAny as Partial<
    Record<ProviderId, ProviderSettings>
  >;

  const qwen: ProviderSettings = {
    mode: providers.qwen?.mode === "fixed" ? "fixed" : "auto",
    fixedModelId: providers.qwen?.fixedModelId,
  };
  const minimax: ProviderSettings = {
    mode: providers.minimax?.mode === "fixed" ? "fixed" : "auto",
    fixedModelId: providers.minimax?.fixedModelId,
  };
  const legacyZai = providersAny.zai;
  const codex: ProviderSettings = {
    mode: (providers.codex?.mode || legacyZai?.mode) === "fixed" ? "fixed" : "auto",
    fixedModelId: providers.codex?.fixedModelId || legacyZai?.fixedModelId,
  };
  const antigravity: ProviderSettings = {
    mode: providers.antigravity?.mode === "fixed" ? "fixed" : "auto",
    fixedModelId: providers.antigravity?.fixedModelId
      ? normalizeAntigravityModelId(providers.antigravity.fixedModelId)
      : undefined,
  };
  const openrouter: ProviderSettings = {
    mode: providers.openrouter?.mode === "fixed" ? "fixed" : "auto",
    fixedModelId: providers.openrouter?.fixedModelId,
  };
  const kilo: ProviderSettings = {
    mode: providers.kilo?.mode === "fixed" ? "fixed" : "auto",
    fixedModelId: providers.kilo?.fixedModelId,
  };

  const rawDefault = (raw as { defaultProvider?: string } | undefined)?.defaultProvider;
  const normalizedDefault = rawDefault === "zai" ? "codex" : rawDefault;
  const defaultProvider =
    normalizedDefault === "qwen" ||
    normalizedDefault === "minimax" ||
    normalizedDefault === "codex" ||
    normalizedDefault === "antigravity" ||
    normalizedDefault === "openrouter" ||
    normalizedDefault === "kilo"
      ? normalizedDefault
      : "auto";

  const rawSelected = (raw as { selectedModel?: Partial<SelectedModelSettings> } | undefined)?.selectedModel;
  const selectedProvider = rawSelected?.provider;
  const selectedModel: SelectedModelSettings = {
    enabled: Boolean(rawSelected?.enabled) &&
      (selectedProvider === "qwen" ||
        selectedProvider === "minimax" ||
        selectedProvider === "codex" ||
        selectedProvider === "antigravity" ||
        selectedProvider === "openrouter" ||
        selectedProvider === "kilo"),
    provider:
      selectedProvider === "qwen" ||
      selectedProvider === "minimax" ||
      selectedProvider === "codex" ||
      selectedProvider === "antigravity" ||
      selectedProvider === "openrouter" ||
      selectedProvider === "kilo"
        ? selectedProvider
        : undefined,
    mode: rawSelected?.mode === "fixed" ? "fixed" : "auto",
    fixedModelId:
      selectedProvider === "antigravity" && rawSelected?.fixedModelId
        ? normalizeAntigravityModelId(rawSelected.fixedModelId)
        : rawSelected?.fixedModelId,
  };

  const rawLastUsed = (raw as { lastUsedModel?: Partial<LastUsedModelSettings> } | undefined)?.lastUsedModel;
  const lastProvider = rawLastUsed?.provider;
  const lastUsedModel: LastUsedModelSettings = {
    provider:
      lastProvider === "qwen" ||
      lastProvider === "minimax" ||
      lastProvider === "codex" ||
      lastProvider === "antigravity" ||
      lastProvider === "openrouter" ||
      lastProvider === "kilo"
        ? lastProvider
        : undefined,
    modelId:
      lastProvider === "antigravity" && rawLastUsed?.modelId
        ? normalizeAntigravityModelId(rawLastUsed.modelId)
        : rawLastUsed?.modelId,
  };

  return {
    defaultProvider: defaultProvider || fallback.defaultProvider,
    providers: { qwen, minimax, codex, antigravity, openrouter, kilo },
    selectedModel,
    lastUsedModel,
  };
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function loadActiveAiRoleProfile(): Promise<ActiveAiRoleProfile> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  try {
    const content = await fs.readFile(AI_ROLE_STATE_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<ActiveAiRoleProfile>;
    return normalizeAiRoleProfile(parsed);
  } catch {
    const fallback = normalizeAiRoleProfile({ role: "main", label: "Khalid AI" });
    await fs.writeFile(AI_ROLE_STATE_FILE, JSON.stringify(fallback, null, 2), "utf-8");
    return fallback;
  }
}

async function saveActiveAiRoleProfile(profile: ActiveAiRoleProfile): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  const normalized = normalizeAiRoleProfile(profile);
  normalized.updatedAt = new Date().toISOString();
  await fs.writeFile(AI_ROLE_STATE_FILE, JSON.stringify(normalized, null, 2), "utf-8");
}

export function buildAiRoleExecutionPrompt(basePrompt: string, profile: ActiveAiRoleProfile): string {
  return [
    "AI role policy:",
    `- Active role: ${agentRoleLabel(profile.role)}`,
    `- Label: ${profile.label}`,
    "- Keep role behavior consistent across the full task.",
    "- Use relevant installed skills/tools when useful for this task.",
    "",
    "Role instructions:",
    profile.instructions.trim(),
    "",
    basePrompt,
  ].join("\n");
}

export async function loadAiRouterConfig(): Promise<AiRouterConfig> {
  const fs = await import("node:fs/promises");
  try {
    const content = await fs.readFile(AI_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<AiRouterConfig>;
    const normalized = normalizeConfig(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveAiRouterConfig(normalized);
    }
    return normalized;
  } catch {
    const config = defaultAiRouterConfig();
    await saveAiRouterConfig(config);
    return config;
  }
}

export async function saveAiRouterConfig(config: AiRouterConfig): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  const normalized = normalizeConfig(config);
  await fs.writeFile(AI_CONFIG_FILE, JSON.stringify(normalized, null, 2));
}

export async function hasSelectedModelOverride(): Promise<boolean> {
  const config = await loadAiRouterConfig();
  return Boolean(config.selectedModel.enabled && config.selectedModel.provider);
}

export async function clearSelectedModelOverride(): Promise<boolean> {
  const config = await loadAiRouterConfig();
  if (!config.selectedModel.enabled) {
    return false;
  }
  config.selectedModel.enabled = false;
  await saveAiRouterConfig(config);
  return true;
}

export async function setSelectedModelOverride(
  provider: ProviderId,
  mode: "auto" | "fixed",
  fixedModelId?: string,
): Promise<void> {
  const config = await loadAiRouterConfig();
  config.selectedModel = {
    enabled: true,
    provider,
    mode,
    fixedModelId: mode === "fixed" ? fixedModelId : undefined,
  };
  if (mode === "fixed" && fixedModelId) {
    config.lastUsedModel = { provider, modelId: fixedModelId };
  }
  await saveAiRouterConfig(config);
}

export async function recordLastUsedModel(provider: ProviderId, modelId: string): Promise<void> {
  const config = await loadAiRouterConfig();
  config.lastUsedModel = { provider, modelId };
  await saveAiRouterConfig(config);
}

function isVisionPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return ["image", "photo", "picture", "vision", "screenshot"].some((k) => lower.includes(k));
}

function hasAnySignal(promptLower: string, signals: string[]): boolean {
  return signals.some((signal) => promptLower.includes(signal));
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
  ].some((k) => lower.includes(k));
}

function isResearchPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return hasAnySignal(lower, [
    "research",
    "analysis",
    "analyze",
    "compare",
    "market",
    "competitor",
    "investigate",
    "finding",
    "insight",
    "report",
    "data",
    "scrape",
    "crawl",
    "collect",
  ]);
}

function isDesignPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  if (isVisionPrompt(prompt)) return true;
  return hasAnySignal(lower, [
    "design",
    "ui",
    "ux",
    "landing page",
    "wireframe",
    "layout",
    "color",
    "typography",
    "style guide",
    "figma",
    "prototype",
  ]);
}

function isBusinessPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return hasAnySignal(lower, [
    "business",
    "startup",
    "saas",
    "pricing",
    "gtm",
    "go to market",
    "revenue",
    "valuation",
    "roadmap",
    "strategy",
    "plan",
    "pitch",
  ]);
}

function providerPriorityFromPrompt(prompt: string): ProviderId[] {
  if (isDesignPrompt(prompt)) {
    return ["antigravity", "kilo", "openrouter", "qwen", "minimax", "codex"];
  }
  if (isResearchPrompt(prompt)) {
    return ["qwen", "openrouter", "minimax", "antigravity", "kilo", "codex"];
  }
  if (isBusinessPrompt(prompt)) {
    return ["minimax", "qwen", "openrouter", "antigravity", "kilo", "codex"];
  }
  if (isCodingPrompt(prompt)) {
    return ["codex", "kilo", "openrouter", "qwen", "minimax", "antigravity"];
  }
  return ["qwen", "openrouter", "kilo", "minimax", "antigravity", "codex"];
}

function pickAutoQwenModel(models: QwenModel[], prompt: string): QwenModel {
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

function pickAutoMiniMaxModel(models: MiniMaxModel[], prompt: string): MiniMaxModel {
  if (isCodingPrompt(prompt)) {
    const advanced = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("2.5"));
    if (advanced) return advanced;
  }
  return models[0];
}

function pickAutoCodexModel(models: CodexModel[], prompt: string): CodexModel {
  const lowerPrompt = prompt.toLowerCase();
  if (isCodingPrompt(prompt) || lowerPrompt.includes("agent")) {
    const strong = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("codex"));
    if (strong) return strong;
  }
  if (isVisionPrompt(prompt)) {
    const vision = models.find((m) => `${m.id} ${m.name}`.toLowerCase().includes("vision"));
    if (vision) return vision;
  }
  return models[0];
}

function pickAutoAntigravityModel(models: AntigravityModel[], prompt: string): AntigravityModel {
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

function pickAutoOpenRouterModel(models: OpenRouterModel[], prompt: string): OpenRouterModel {
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

function pickAutoKiloModel(models: KiloModel[], prompt: string): KiloModel {
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

export function shouldFallbackToNextProvider(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    "rate limit",
    "quota",
    "insufficient",
    "limit",
    "context length",
    "context_length",
    "max tokens",
    "maximum context",
    "token limit",
    "tokens exceeded",
    "input too long",
    "prompt too long",
    "model overloaded",
    "model not available",
    "too many requests",
    "429",
    "overloaded",
    "temporarily unavailable",
  ].some((k) => lower.includes(k));
}

async function getQwenModelsForRouting(token: QwenToken): Promise<QwenModel[]> {
  const cached = await loadQwenConfig();
  if (cached?.models?.length) {
    return cached.models;
  }
  return await getQwenModels(token);
}

async function getMiniMaxModelsForRouting(token: MiniMaxToken): Promise<MiniMaxModel[]> {
  const cached = await loadMiniMaxConfig();
  if (cached?.models?.length) {
    return cached.models;
  }
  return await getMiniMaxModels(token);
}

async function getCodexModelsForRouting(token: CodexToken): Promise<CodexModel[]> {
  const cached = await loadCodexConfig();
  if (cached?.models?.length) {
    return cached.models;
  }
  return await getCodexModels(token);
}

async function getAntigravityModelsForRouting(token: AntigravityToken): Promise<AntigravityModel[]> {
  const cached = await loadAntigravityConfig();
  if (cached?.models?.length) {
    return cached.models;
  }
  return await getAntigravityModels(token);
}

async function getOpenRouterModelsForRouting(token: OpenRouterToken): Promise<OpenRouterModel[]> {
  const cached = await loadOpenRouterConfig();
  if (cached?.models?.length) {
    return cached.models;
  }
  return await getOpenRouterModels(token);
}

async function getKiloModelsForRouting(token: KiloToken): Promise<KiloModel[]> {
  const cached = await loadKiloConfig();
  if (cached?.models?.length) {
    return cached.models;
  }
  return await getKiloModels(token);
}

export async function buildAiRouteCandidates(
  prompt: string,
  options?: { ignoreSelectedOverride?: boolean; config?: AiRouterConfig },
): Promise<AiRouteCandidate[]> {
  const config = options?.config || await loadAiRouterConfig();
  const autoOrder = providerPriorityFromPrompt(prompt);
  const selectedOverride = !options?.ignoreSelectedOverride && config.selectedModel.enabled && config.selectedModel.provider
    ? config.selectedModel
    : undefined;
  const providerOrder: ProviderId[] =
    selectedOverride
      ? [selectedOverride.provider!]
      : config.defaultProvider === "auto"
      ? autoOrder
      : [config.defaultProvider];
  const candidateByProvider = await Promise.all(
    providerOrder.map(async (provider): Promise<AiRouteCandidate | null> => {
      if (provider === "qwen") {
        const token = await loadQwenToken();
        if (!token) return null;

        const models = await getQwenModelsForRouting(token);
        if (!models.length) return null;

        const settings =
          selectedOverride?.provider === "qwen"
            ? { mode: selectedOverride.mode, fixedModelId: selectedOverride.fixedModelId }
            : config.providers.qwen;
        const chosenModel =
          settings.mode === "fixed" && settings.fixedModelId
            ? models.find((m) => m.id === settings.fixedModelId) || pickAutoQwenModel(models, prompt)
            : pickAutoQwenModel(models, prompt);

        return {
          provider: "qwen",
          model: chosenModel,
          token,
          baseUrl: resolveQwenBaseUrl(token),
        };
      }

      if (provider === "minimax") {
        const token = await loadMiniMaxToken();
        if (!token) return null;

        const models = await getMiniMaxModelsForRouting(token);
        if (!models.length) return null;

        const settings =
          selectedOverride?.provider === "minimax"
            ? { mode: selectedOverride.mode, fixedModelId: selectedOverride.fixedModelId }
            : config.providers.minimax;
        const chosenModel =
          settings.mode === "fixed" && settings.fixedModelId
            ? models.find((m) => m.id === settings.fixedModelId) || pickAutoMiniMaxModel(models, prompt)
            : pickAutoMiniMaxModel(models, prompt);

        return {
          provider: "minimax",
          model: chosenModel,
          token,
          baseUrl: resolveMiniMaxBaseUrl(token),
        };
      }

      if (provider === "antigravity") {
        const token = await loadAntigravityToken();
        if (!token) return null;

        const models = await getAntigravityModelsForRouting(token);
        if (!models.length) return null;

        const settings =
          selectedOverride?.provider === "antigravity"
            ? { mode: selectedOverride.mode, fixedModelId: selectedOverride.fixedModelId }
            : config.providers.antigravity;
        const normalizedFixedModelId =
          settings.mode === "fixed" && settings.fixedModelId
            ? normalizeAntigravityModelId(settings.fixedModelId)
            : undefined;
        const chosenModel =
          normalizedFixedModelId
            ? models.find((m) => normalizeAntigravityModelId(m.id) === normalizedFixedModelId) ||
              pickAutoAntigravityModel(models, prompt)
            : pickAutoAntigravityModel(models, prompt);

        return {
          provider: "antigravity",
          model: chosenModel,
          token,
          baseUrl: resolveAntigravityBaseUrl(token),
        };
      }

      if (provider === "openrouter") {
        const token = await loadOpenRouterToken();
        if (!token) return null;

        const models = await getOpenRouterModelsForRouting(token);
        if (!models.length) return null;

        const settings =
          selectedOverride?.provider === "openrouter"
            ? { mode: selectedOverride.mode, fixedModelId: selectedOverride.fixedModelId }
            : config.providers.openrouter;
        const chosenModel =
          settings.mode === "fixed" && settings.fixedModelId
            ? models.find((m) => m.id === settings.fixedModelId) || pickAutoOpenRouterModel(models, prompt)
            : pickAutoOpenRouterModel(models, prompt);

        return {
          provider: "openrouter",
          model: chosenModel,
          token,
          baseUrl: resolveOpenRouterBaseUrl(),
        };
      }

      if (provider === "kilo") {
        const token = await loadKiloToken();
        if (!token) return null;

        const models = await getKiloModelsForRouting(token);
        if (!models.length) return null;

        const settings =
          selectedOverride?.provider === "kilo"
            ? { mode: selectedOverride.mode, fixedModelId: selectedOverride.fixedModelId }
            : config.providers.kilo;
        const chosenModel =
          settings.mode === "fixed" && settings.fixedModelId
            ? models.find((m) => m.id === settings.fixedModelId) || pickAutoKiloModel(models, prompt)
            : pickAutoKiloModel(models, prompt);

        return {
          provider: "kilo",
          model: chosenModel,
          token,
          baseUrl: resolveKiloBaseUrl(token),
        };
      }

      const token = await loadCodexToken();
      if (!token) return null;

      const models = await getCodexModelsForRouting(token);
      if (!models.length) return null;

      const settings =
        selectedOverride?.provider === "codex"
          ? { mode: selectedOverride.mode, fixedModelId: selectedOverride.fixedModelId }
          : config.providers.codex;
      const chosenModel =
        settings.mode === "fixed" && settings.fixedModelId
          ? models.find((m) => m.id === settings.fixedModelId) || pickAutoCodexModel(models, prompt)
          : pickAutoCodexModel(models, prompt);

      return {
        provider: "codex",
        model: chosenModel,
        token,
      };
    }),
  );

  return candidateByProvider.filter((item): item is AiRouteCandidate => Boolean(item));
}

async function pause(message = "Press any key to continue..."): Promise<void> {
  console.log(`${white}${message}${reset}`);
  process.stdin.resume();
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
    process.stdin.resume();
    let selectedIndex = 0;
    let renderedLines = 0;
    const visibleRows = 12;
    const labelWidth = 28;

    const render = () => {
      const total = items.length;
      const useWindow = total > visibleRows;
      const start = useWindow
        ? Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, total - visibleRows)))
        : 0;
      const end = useWindow ? Math.min(total, start + visibleRows) : total;

      const lines: string[] = [];
      lines.push(`${bold}${title}:${reset} ${gray}(${hint})${reset}`);
      if (useWindow) {
        lines.push(`${gray}Showing ${start + 1}-${end} of ${total}${reset}`);
      }
      lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
      for (let index = start; index < end; index++) {
        const item = items[index];
        const active = selectedIndex === index;
        const icon = active ? `${orange}▶${reset}` : " ";
        const color = active ? orange : white;
        const label = truncateLabel(item.label, labelWidth).padEnd(labelWidth);
        lines.push(`  ${icon} ${color}${label}${reset} ${gray}│${reset} ${item.description}`);
      }
      lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);

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
      } else if (char === "0") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(items[items.length - 1].key);
      } else if (char === "\r" || char === "\n") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(items[selectedIndex].key);
      } else if (char === "\u0003" || char === "\x1b") {
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

async function readLinePrompt(message: string): Promise<string> {
  process.stdin.resume();
  process.stdin.setRawMode?.(false);
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${white}${message}${reset}`);
    return answer.trim();
  } finally {
    rl.close();
    process.stdin.resume();
  }
}

async function readMultilinePrompt(label: string): Promise<string> {
  process.stdin.resume();
  process.stdin.setRawMode?.(false);
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];
  console.log(`${gray}${label}${reset}`);
  console.log(`${gray}Submit an empty line to save, or type /cancel to abort.${reset}`);

  try {
    while (true) {
      const line = await rl.question(lines.length === 0 ? `${white}> ${reset}` : `${white}… ${reset}`);
      if (line.trim().toLowerCase() === "/cancel") {
        return "";
      }
      if (!line.trim()) {
        if (!lines.length) continue;
        break;
      }
      lines.push(line);
    }
  } finally {
    rl.close();
    process.stdin.resume();
  }

  return lines.join("\n").trim();
}

function buildAgentFileName(name: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeSlug = slug || "agent";
  return `${timestamp}-${safeSlug}.md`;
}

function parseCreatedAgentTitle(content: string, fallback: string): string {
  const line = content
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("# Agent:"));
  if (!line) return fallback;
  const title = line.replace("# Agent:", "").trim();
  return title || fallback;
}

function normalizeAgentRole(value: string): AgentRole {
  const normalized = value.toLowerCase().trim();
  if (normalized === "main" || normalized === "main ai") return "main";
  if (normalized === "developer" || normalized === "developer ai") return "developer";
  if (normalized === "researcher" || normalized === "researcher ai") return "researcher";
  if (normalized === "designer" || normalized === "designer ai") return "designer";
  return "custom";
}

function agentRoleLabel(role: AgentRole): string {
  if (role === "main") return "Main AI";
  if (role === "developer") return "Developer AI";
  if (role === "researcher") return "Researcher AI";
  if (role === "designer") return "Designer AI";
  return "Custom AI";
}

function defaultRoleInstructions(role: AgentRole): string {
  if (role === "developer") {
    return "You are Khalid AI in Developer mode. Focus on coding, debugging, CLI execution, and implementation quality. Do not claim actions you did not execute.";
  }
  if (role === "researcher") {
    return "You are Khalid AI in Researcher mode. Focus on deep research, evidence-based analysis, and concise recommendations with clear assumptions.";
  }
  if (role === "designer") {
    return "You are Khalid AI in Designer mode. Focus on UI/UX clarity, structure, and practical design decisions grounded in implementation.";
  }
  if (role === "custom") {
    return "You are Khalid AI in Custom mode. Follow the custom role instructions precisely while staying factual and task-focused.";
  }
  return "You are Khalid AI in Main mode. Complete the user task directly, combine skills when relevant, and provide practical final answers.";
}

function normalizeAiRoleProfile(raw?: Partial<ActiveAiRoleProfile>): ActiveAiRoleProfile {
  const role = normalizeAgentRole(raw?.role || "main");
  const label = AI_FIXED_LABEL;
  const instructions = raw?.instructions?.trim() || defaultRoleInstructions(role);
  return {
    role,
    label,
    instructions,
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

function normalizeKeywords(raw: string[]): string[] {
  return Array.from(
    new Set(
      raw
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length >= 2)
        .map((item) => item.replace(/[^a-z0-9\s-]+/g, "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

function parseMetaLine(content: string, key: string): string {
  const lowerKey = key.toLowerCase();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("-")) continue;
    const body = line.slice(1).trim();
    const separator = body.indexOf(":");
    if (separator <= 0) continue;
    const left = body.slice(0, separator).trim().toLowerCase();
    if (left !== lowerKey) continue;
    return body.slice(separator + 1).trim();
  }
  return "";
}

function extractMarkdownSection(content: string, heading: string): string {
  const lines = content.split("\n");
  const needle = `## ${heading}`.toLowerCase();
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === needle) {
      start = i + 1;
      break;
    }
  }

  if (start === -1) return "";
  const section: string[] = [];

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("## ")) {
      break;
    }
    section.push(line);
  }

  return section.join("\n").trim();
}

function inferAgentSummary(instructions: string, fallbackName: string): string {
  const first = instructions
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return first ? truncateLabel(first, 180) : `${fallbackName} agent instructions`;
}

function defaultAgentUsageState(): AgentUsageState {
  return {
    autoEnabled: true,
    selectedAgentIds: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeAgentUsageState(raw?: Partial<AgentUsageState>): AgentUsageState {
  const selectedAgentIds = Array.isArray(raw?.selectedAgentIds)
    ? Array.from(new Set(raw?.selectedAgentIds.map((item) => String(item).trim()).filter(Boolean)))
    : [];
  return {
    autoEnabled: raw?.autoEnabled !== false,
    selectedAgentIds,
    mainAgentId: raw?.mainAgentId?.trim() || undefined,
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

async function loadAgentUsageState(): Promise<AgentUsageState> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  try {
    const content = await fs.readFile(AGENT_USAGE_STATE_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<AgentUsageState>;
    return normalizeAgentUsageState(parsed);
  } catch {
    const fallback = defaultAgentUsageState();
    await saveAgentUsageState(fallback);
    return fallback;
  }
}

async function saveAgentUsageState(state: AgentUsageState): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  const normalized = normalizeAgentUsageState(state);
  normalized.updatedAt = new Date().toISOString();
  await fs.writeFile(AGENT_USAGE_STATE_FILE, JSON.stringify(normalized, null, 2), "utf-8");
}

function parseAgentProfileContent(
  fileName: string,
  filePath: string,
  content: string,
  updatedAt: string,
): CreatedAgentProfile {
  const fallbackName = fileName.replace(/\.md$/i, "");
  const name = parseCreatedAgentTitle(content, fallbackName);
  const role = normalizeAgentRole(parseMetaLine(content, "Role"));
  const parentAgent = parseMetaLine(content, "Parent");
  const keywords = normalizeKeywords(
    parseMetaLine(content, "Keywords")
      .split(",")
      .map((item) => item.trim()),
  );
  const summarySection = extractMarkdownSection(content, "Summary");
  const instructionSection = extractMarkdownSection(content, "Instructions") || content.trim();
  const summary = summarySection || inferAgentSummary(instructionSection, name);
  const createdAt = parseMetaLine(content, "Created") || updatedAt;

  return {
    id: fileName,
    fileName,
    filePath,
    name,
    role,
    parentAgent,
    keywords,
    summary,
    instructions: instructionSection,
    createdAt,
    updatedAt,
  };
}

export async function listCreatedAgentProfiles(): Promise<CreatedAgentProfile[]> {
  const fs = await import("node:fs/promises");
  await ensureMemoryDirectories();
  const entries = await fs.readdir(AGENT_MEMORY_DIR, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md") && entry.name.toLowerCase() !== "readme.md")
    .map((entry) => entry.name);

  const agents = await Promise.all(
    files.map(async (fileName) => {
      const filePath = join(AGENT_MEMORY_DIR, fileName);
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf-8");
      return parseAgentProfileContent(fileName, filePath, content, stat.mtime.toISOString());
    }),
  );

  return agents.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function dedupeAgents(agents: CreatedAgentProfile[]): CreatedAgentProfile[] {
  const seen = new Set<string>();
  const unique: CreatedAgentProfile[] = [];
  for (const agent of agents) {
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    unique.push(agent);
  }
  return unique;
}

function scoreAgentForPrompt(agent: CreatedAgentProfile, promptLower: string): number {
  const roleSignals: Record<AgentRole, string[]> = {
    main: ["plan", "final", "summary", "refine", "overall"],
    developer: ["code", "fix", "bug", "script", "cli", "command", "build", "terminal", "api"],
    researcher: ["research", "analysis", "compare", "market", "report", "data", "find", "search"],
    designer: ["design", "ui", "ux", "layout", "color", "style", "visual", "component"],
    custom: [],
  };

  let score = 0;
  const normalizedName = agent.name.toLowerCase();
  if (promptLower.includes(normalizedName)) score += 8;
  for (const signal of roleSignals[agent.role]) {
    if (promptLower.includes(signal)) score += 3;
  }
  for (const keyword of agent.keywords) {
    if (keyword && promptLower.includes(keyword.toLowerCase())) score += 2;
  }
  return score;
}

function pickMainAgent(agents: CreatedAgentProfile[], state: AgentUsageState): CreatedAgentProfile {
  if (state.mainAgentId) {
    const exact = agents.find((agent) => agent.id === state.mainAgentId);
    if (exact) return exact;
  }
  const roleMain = agents.find((agent) => agent.role === "main");
  if (roleMain) return roleMain;
  return agents[0];
}

function expandMainAgentSelection(
  selectedAgents: CreatedAgentProfile[],
  allAgents: CreatedAgentProfile[],
): CreatedAgentProfile[] {
  const expanded: CreatedAgentProfile[] = [...selectedAgents];
  for (const agent of selectedAgents) {
    if (agent.role !== "main") continue;
    expanded.push(...collectChildAgentsForMain(agent.name, allAgents));
  }
  return dedupeAgents(expanded);
}

function formatAgentPromptLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Agent";
  if (/\bagent\b$/i.test(trimmed)) return trimmed;
  return `${trimmed} Agent`;
}

export async function getAgentPromptLabel(): Promise<string | null> {
  if (!AGENT_CREATION_FEATURE_ENABLED) {
    return null;
  }

  const agents = await listCreatedAgentProfiles();
  if (!agents.length) return null;

  const state = await loadAgentUsageState();
  if (state.autoEnabled) {
    return null;
  }

  const selected = dedupeAgents(
    state.selectedAgentIds
      .map((id) => agents.find((agent) => agent.id === id))
      .filter(Boolean) as CreatedAgentProfile[],
  );
  if (!selected.length) return null;

  const main = pickMainAgent(selected, state);
  return main.name ? formatAgentPromptLabel(main.name) : null;
}

export async function resolveActiveAgentPlan(userPrompt: string): Promise<ActiveAgentPlan | null> {
  if (!AGENT_CREATION_FEATURE_ENABLED) {
    return null;
  }

  const agents = await listCreatedAgentProfiles();
  if (!agents.length) return null;

  const state = await loadAgentUsageState();
  const promptLower = userPrompt.toLowerCase();

  if (!state.autoEnabled) {
    const selected = dedupeAgents(
      state.selectedAgentIds
        .map((id) => agents.find((agent) => agent.id === id))
        .filter(Boolean) as CreatedAgentProfile[],
    );
    const baseSelected = selected.length ? selected : [pickMainAgent(agents, state)];
    const finalSelected = expandMainAgentSelection(baseSelected, agents);
    const mainAgent = pickMainAgent(finalSelected, state);
    const workerAgents = finalSelected.filter((agent) => agent.id !== mainAgent.id);
    return {
      mode: "custom",
      reason: "custom-selected-agents",
      mainAgent,
      workerAgents,
      selectedAgents: [mainAgent, ...workerAgents],
    };
  }

  const mainAgent = pickMainAgent(agents, state);
  const scoredWorkers = agents
    .filter((agent) => agent.id !== mainAgent.id)
    .map((agent) => ({ agent, score: scoreAgentForPrompt(agent, promptLower) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const workerAgents = dedupeAgents(scoredWorkers.map((item) => item.agent)).slice(0, 3);
  return {
    mode: "auto",
    reason: workerAgents.length ? `auto-matched-${workerAgents.length}-workers` : "auto-main-only",
    mainAgent,
    workerAgents,
    selectedAgents: [mainAgent, ...workerAgents],
  };
}

export function buildAgentExecutionPrompt(basePrompt: string, plan: ActiveAgentPlan): string {
  const lines: string[] = [
    "Multi-agent execution policy (ShipFaster + Chifer aligned):",
    `- Mode: ${plan.mode}`,
    `- Main AI: ${plan.mainAgent.name} (${agentRoleLabel(plan.mainAgent.role)})`,
  ];

  if (plan.workerAgents.length) {
    lines.push("- Worker AIs:");
    for (const worker of plan.workerAgents) {
      lines.push(`  - ${worker.name} (${agentRoleLabel(worker.role)})`);
    }
  } else {
    lines.push("- Worker AIs: none selected");
  }

  lines.push("- Strict orchestration protocol:");
  lines.push("  1) Start all worker AIs at the same time on distinct sub-tasks.");
  lines.push("  2) Each worker completes its own task and sends result to Main AI.");
  lines.push("  3) Main AI aggregates all worker outputs, resolves conflicts, and refines one final answer.");
  lines.push("  4) Return only Main AI final answer to user unless user explicitly asks worker logs.");
  lines.push("- Each AI must handle a distinct sub-task; do not duplicate work.");
  lines.push("- If a worker role is irrelevant for this task, skip it.");
  lines.push("- Main AI must synthesize and refine final user-facing answer.");
  lines.push("- Keep focus on user goal, guided by memory/chifer context.");
  lines.push("- Final response language must follow user language.");
  lines.push("- Output format requirement:");
  lines.push("  - Final Answer: <main AI refined response>");
  lines.push("");
  lines.push("Agent prompts:");
  lines.push(`MAIN ${plan.mainAgent.name}: ${plan.mainAgent.instructions}`);
  for (const worker of plan.workerAgents) {
    lines.push(`${worker.name}: ${worker.instructions}`);
  }
  lines.push("");
  lines.push(basePrompt);

  return lines.join("\n");
}

async function chooseAgentRoleFlow(options?: {
  title?: string;
  includeMain?: boolean;
}): Promise<AgentRole | null> {
  const title = options?.title || "Agent Role";
  const includeMain = options?.includeMain !== false;
  const items: Array<MenuItem<AgentRole | "back">> = [];

  if (includeMain) {
    items.push({ key: "main", label: "Main AI", description: "Primary summarizer/refiner AI" });
  }
  items.push(
    { key: "developer", label: "Developer AI", description: "Code and command execution specialist" },
    { key: "researcher", label: "Researcher AI", description: "Investigation and analysis specialist" },
    { key: "designer", label: "Designer AI", description: "UI/UX and style specialist" },
    { key: "custom", label: "Custom AI", description: "Custom role and behavior" },
    { key: "back", label: "Back", description: "Cancel create flow" },
  );

  const role = await showMenu(title, items);
  if (role === "back") return null;
  return role as AgentRole;
}

type PendingAgentDraft = {
  role: AgentRole;
  name: string;
  parentAgent: string;
  keywords: string[];
  instructions: string;
};

async function collectAgentDraftInput(
  role: AgentRole,
  options?: {
    nameLabel?: string;
    promptLabel?: string;
    parentAgent?: string;
  },
): Promise<PendingAgentDraft | null> {
  const nameInput = await readLinePrompt(options?.nameLabel || "AI name (or /cancel): ");
  if (nameInput.toLowerCase() === "/cancel") {
    return null;
  }

  const instructions = await readMultilinePrompt(options?.promptLabel || "AI prompt/summary");
  if (!instructions) {
    console.log(`${gray}Create canceled. No prompt/summary saved.${reset}`);
    console.log("");
    return null;
  }

  const name = nameInput || `AI ${new Date().toLocaleString("en-US")}`;

  return {
    role,
    name,
    parentAgent: options?.parentAgent || "",
    keywords: [],
    instructions,
  };
}

async function savePendingAgentDraft(draft: PendingAgentDraft): Promise<CreatedAgentProfile> {
  await ensureMemoryDirectories();
  const fs = await import("node:fs/promises");
  const fileName = buildAgentFileName(draft.name);
  const filePath = join(AGENT_MEMORY_DIR, fileName);
  const createdAt = new Date().toISOString();
  const payload = [
    `# Agent: ${draft.name}`,
    "",
    `- Role: ${agentRoleLabel(draft.role)}`,
    draft.parentAgent ? `- Parent: ${draft.parentAgent}` : "- Parent: none",
    `- Keywords: ${draft.keywords.join(", ") || "general"}`,
    `- Created: ${createdAt}`,
    "",
    "## Summary",
    inferAgentSummary(draft.instructions, draft.name),
    "",
    "## Instructions",
    draft.instructions,
    "",
  ].join("\n");

  await fs.writeFile(filePath, payload, "utf-8");
  return parseAgentProfileContent(fileName, filePath, payload, createdAt);
}

async function createSingleAgentOrMainGroup(existingAgents: CreatedAgentProfile[]): Promise<CreatedAgentProfile[]> {
  const role = await chooseAgentRoleFlow({ title: "AI Category", includeMain: true });
  if (!role) {
    return [];
  }

  const mainDraft = await collectAgentDraftInput(role, {
    nameLabel: role === "main" ? "Main AI name (or /cancel): " : "AI name (or /cancel): ",
    promptLabel: role === "main" ? "Main AI prompt/summary" : "AI prompt/summary",
  });
  if (!mainDraft) {
    return [];
  }

  if (role !== "main") {
    const mainCandidates = existingAgents.filter((agent) => agent.role === "main");
    if (mainCandidates.length) {
      const attachChoice = await showMenu(
        "Attach To Main AI",
        [
          ...mainCandidates.map((agent) => ({
            key: `main:${agent.id}`,
            label: truncateLabel(agent.name, 28),
            description: "Attach under this Main AI",
          })),
          { key: "none", label: "No Parent", description: "Keep this AI standalone" },
        ],
        "use ↑↓ arrows, Enter to select",
      );
      if (String(attachChoice).startsWith("main:")) {
        const id = String(attachChoice).slice("main:".length);
        mainDraft.parentAgent = mainCandidates.find((agent) => agent.id === id)?.name || "";
      }
    }

    const singleAction = await showMenu("Save Agent", [
      { key: "save", label: "Save Agent", description: "Save this AI profile now" },
      { key: "cancel", label: "Cancel", description: "Cancel without saving" },
    ]);
    if (singleAction !== "save") {
      return [];
    }
    return [await savePendingAgentDraft(mainDraft)];
  }

  const drafts: PendingAgentDraft[] = [mainDraft];

  while (true) {
    const action = await showMenu(`Main AI Builder: ${truncateLabel(mainDraft.name, 22)}`, [
      {
        key: "add-sub",
        label: "Add Sub Agent",
        description: `Create sub-agent under ${truncateLabel(mainDraft.name, 18)}`,
      },
      {
        key: "save",
        label: "Save Agent",
        description: `Save main + ${Math.max(0, drafts.length - 1)} sub-agent(s)`,
      },
      { key: "cancel", label: "Cancel", description: "Cancel this builder without saving" },
    ]);

    if (action === "cancel") {
      console.log(`${gray}Create canceled. No agent saved from this builder.${reset}`);
      console.log("");
      return [];
    }

    if (action === "save") {
      const created: CreatedAgentProfile[] = [];
      for (const draft of drafts) {
        created.push(await savePendingAgentDraft(draft));
      }
      return created;
    }

    const subRole = await chooseAgentRoleFlow({ title: "Sub Agent Category", includeMain: false });
    if (!subRole) {
      continue;
    }

    const subDraft = await collectAgentDraftInput(subRole, {
      nameLabel: "Sub Agent name (or /cancel): ",
      promptLabel: "Sub Agent prompt/summary",
      parentAgent: mainDraft.name,
    });
    if (!subDraft) {
      continue;
    }

    drafts.push(subDraft);
    console.log(`${green}✓ Sub-agent draft added:${reset} ${cyan}${subDraft.name}${reset}`);
    console.log(`${gray}Category:${reset} ${white}${agentRoleLabel(subDraft.role)}${reset}`);
    console.log(`${gray}Total in builder:${reset} ${white}${drafts.length}${reset}`);
    console.log("");
  }
}

function suggestMainAgentId(selectedIds: string[], agents: CreatedAgentProfile[]): string | undefined {
  if (!selectedIds.length) {
    return undefined;
  }
  const selected = selectedIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter(Boolean) as CreatedAgentProfile[];
  if (!selected.length) {
    return undefined;
  }
  const roleMain = selected.find((agent) => agent.role === "main");
  return roleMain?.id || selected[0].id;
}

async function saveSelectedAgentsForChat(selectedIds: string[]): Promise<boolean> {
  const normalizedIds = Array.from(new Set(selectedIds.filter(Boolean)));
  if (!normalizedIds.length) {
    return false;
  }

  const agents = await listCreatedAgentProfiles();
  const existingIds = new Set(agents.map((agent) => agent.id));
  const finalIds = normalizedIds.filter((id) => existingIds.has(id));
  if (!finalIds.length) {
    return false;
  }

  await saveAgentUsageState({
    autoEnabled: false,
    selectedAgentIds: finalIds,
    mainAgentId: suggestMainAgentId(finalIds, agents),
    updatedAt: new Date().toISOString(),
  });
  return true;
}

async function deleteAgentProfilesById(agentIds: string[]): Promise<number> {
  const fs = await import("node:fs/promises");
  const ids = Array.from(new Set(agentIds.filter(Boolean)));
  if (!ids.length) {
    return 0;
  }

  const currentAgents = await listCreatedAgentProfiles();
  const currentById = new Map(currentAgents.map((agent) => [agent.id, agent]));
  const cascadeIds = Array.from(
    new Set(
      ids.flatMap((id) => {
        const base = currentById.get(id);
        if (!base) return [];
        return [base.id, ...collectChildAgentsForMain(base.name, currentAgents).map((child) => child.id)];
      }),
    ),
  );

  let deleted = 0;
  for (const id of cascadeIds) {
    const target = currentById.get(id);
    if (!target) {
      continue;
    }
    await fs.rm(target.filePath, { force: true });
    deleted += 1;
  }

  if (!deleted) {
    return 0;
  }

  const remainingAgents = await listCreatedAgentProfiles();
  const remainingIds = new Set(remainingAgents.map((agent) => agent.id));
  const usage = await loadAgentUsageState();
  usage.selectedAgentIds = usage.selectedAgentIds.filter((id) => remainingIds.has(id));
  if (!usage.selectedAgentIds.length) {
    usage.autoEnabled = true;
    usage.mainAgentId = undefined;
  } else if (!usage.mainAgentId || !remainingIds.has(usage.mainAgentId)) {
    usage.mainAgentId = suggestMainAgentId(usage.selectedAgentIds, remainingAgents);
  }
  usage.updatedAt = new Date().toISOString();
  await saveAgentUsageState(usage);

  return deleted;
}

async function deleteCreatedAgentFlow(agents: CreatedAgentProfile[]): Promise<number> {
  if (!agents.length) {
    console.log(`${gray}No AI profiles available to delete.${reset}`);
    console.log("");
    await pause();
    return 0;
  }

  const action = await showMenu("Delete AI", [
    { key: "single", label: "Delete One AI", description: "Delete one selected AI profile" },
    { key: "all", label: "Delete All AI", description: "Delete every AI profile" },
    { key: "back", label: "Back", description: "Cancel delete flow" },
  ]);

  if (action === "back") {
    return 0;
  }

  if (action === "all") {
    const confirm = await showMenu("Delete All AI", [
      { key: "confirm", label: "Confirm Delete All", description: "Permanently delete all AI profiles" },
      { key: "cancel", label: "Cancel", description: "Keep all AI profiles" },
    ]);
    if (confirm !== "confirm") {
      return 0;
    }

    const deleted = await deleteAgentProfilesById(agents.map((agent) => agent.id));
    console.log(`${green}✓ Deleted ${deleted} AI profile(s).${reset}`);
    console.log("");
    await pause();
    return deleted;
  }

  const picked = await showMenu(
    "Select AI To Delete",
    [
      ...agents.filter((agent) => isTopLevelAgent(agent)).map((agent) => ({
        key: `agent:${agent.id}`,
        label: truncateLabel(agent.name, 28),
        description: `${agentRoleLabel(agent.role)} | ${truncateLabel(agent.summary, 46)}`,
      })),
      { key: "back", label: "Back", description: "Cancel" },
    ],
    "use ↑↓ arrows, Enter to select",
  );

  if (picked === "back") {
    return 0;
  }

  const id = String(picked).startsWith("agent:") ? String(picked).slice("agent:".length) : "";
  const target = agents.filter((agent) => isTopLevelAgent(agent)).find((agent) => agent.id === id);
  if (!target) {
    return 0;
  }

  const confirm = await showMenu("Confirm Delete AI", [
    { key: "confirm", label: "Delete", description: `Delete ${truncateLabel(target.name, 32)}` },
    { key: "cancel", label: "Cancel", description: "Keep this AI profile" },
  ]);
  if (confirm !== "confirm") {
    return 0;
  }

  const deleted = await deleteAgentProfilesById([target.id]);
  console.log(`${green}✓ Deleted ${deleted} AI profile(s) from:${reset} ${white}${target.name}${reset}`);
  console.log("");
  await pause();
  return deleted;
}

async function createAgentUsageFlow(): Promise<void> {
  const draftSelectedIds = new Set<string>();

  while (true) {
    const existing = await listCreatedAgentProfiles();
    for (const id of Array.from(draftSelectedIds)) {
      if (!existing.some((agent) => agent.id === id)) {
        draftSelectedIds.delete(id);
      }
    }

    const selectedCount = Array.from(draftSelectedIds).length;
    const next = await showMenu("Create Agent Builder", [
      { key: "add", label: "Add AI Select", description: "Select category -> name -> prompt -> save flow" },
      {
        key: "save",
        label: "Save Agent",
        description: `Save and select ${selectedCount} AI profile(s) for chat usage`,
      },
      { key: "delete", label: "Delete AI", description: "Delete one/all existing AI profiles" },
      { key: "back", label: "Back", description: "Return without saving selection" },
    ]);

    if (next === "back") {
      return;
    }

    if (next === "add") {
      const profiles = await createSingleAgentOrMainGroup(existing);
      if (!profiles.length) {
        continue;
      }

      const mainProfile = profiles.find((profile) => profile.role === "main") || profiles[0];
      for (const profile of profiles) {
        draftSelectedIds.add(profile.id);
      }

      console.log(`${green}✓ AI saved:${reset} ${cyan}${mainProfile.name}${reset}`);
      console.log(`${gray}Total saved in this add:${reset} ${white}${profiles.length}${reset}`);
      console.log(`${gray}Main AI:${reset} ${white}${mainProfile.name}${reset}`);
      console.log(`${gray}Draft selected:${reset} ${white}${draftSelectedIds.size}${reset}`);
      console.log("");
      continue;
    }

    if (next === "delete") {
      await deleteCreatedAgentFlow(existing);
      continue;
    }

    if (!draftSelectedIds.size) {
      console.log(`${gray}No AI added yet. Add at least one AI first.${reset}`);
      console.log("");
      continue;
    }

    const saved = await saveSelectedAgentsForChat(Array.from(draftSelectedIds));
    if (!saved) {
      console.log(`${gray}Could not save selection. Create AI first.${reset}`);
      console.log("");
      continue;
    }

    console.log(`${green}✓ AI selection saved.${reset}`);
    console.log(`${gray}Selected:${reset} ${white}${draftSelectedIds.size} AI${reset}`);
    console.log(`${gray}Mode:${reset} ${white}Custom AI Select${reset}`);
    console.log("");
    await pause();
    return;
  }
}

async function selectCustomAgentsFlow(agents: CreatedAgentProfile[]): Promise<void> {
  const topLevelAgents = agents.filter((agent) => isTopLevelAgent(agent));
  if (!topLevelAgents.length) {
    console.log(`${gray}No main/standalone AI found.${reset}`);
    console.log("");
    await pause();
    return;
  }

  const usage = await loadAgentUsageState();
  const selected = new Set(usage.selectedAgentIds.filter((id) => topLevelAgents.some((agent) => agent.id === id)));
  let mainAgentId = usage.mainAgentId && topLevelAgents.some((agent) => agent.id === usage.mainAgentId)
    ? usage.mainAgentId
    : undefined;

  while (true) {
    const choice = await showMenu(
      "Select Custom AI",
      [
        ...topLevelAgents.map((agent) => ({
          key: `toggle:${agent.id}`,
          label: `${selected.has(agent.id) ? "[x]" : "[ ]"} ${truncateLabel(agent.name, 22)}`,
          description: `${agentRoleLabel(agent.role)} | ${truncateLabel(agent.summary, 46)}`,
        })),
        {
          key: "set-main",
          label: "Set Main AI",
          description: mainAgentId
            ? `Current: ${topLevelAgents.find((agent) => agent.id === mainAgentId)?.name || "none"}`
            : "Choose main AI from selected list",
        },
        { key: "save", label: "Save Custom Selection", description: "Apply selected AI set for chat mode" },
        { key: "back", label: "Back", description: "Return without changes" },
      ],
      "use ↑↓ arrows, Enter to toggle/select",
    );

    if (choice === "back") {
      return;
    }

    if (choice === "save") {
      const selectedTopIds = Array.from(selected);
      if (!selectedTopIds.length) {
        console.log(`${gray}Select at least one AI first.${reset}`);
        console.log("");
        continue;
      }

      const selectedTopAgents = selectedTopIds
        .map((id) => topLevelAgents.find((agent) => agent.id === id))
        .filter(Boolean) as CreatedAgentProfile[];
      const expandedAgents = expandMainAgentSelection(selectedTopAgents, agents);
      const selectedIds = expandedAgents.map((agent) => agent.id);

      const normalizedMain =
        (mainAgentId && selected.has(mainAgentId) && mainAgentId) ||
        selectedTopIds.find((id) => topLevelAgents.find((agent) => agent.id === id)?.role === "main") ||
        selectedTopIds[0];

      await saveAgentUsageState({
        autoEnabled: false,
        selectedAgentIds: selectedIds,
        mainAgentId: normalizedMain,
        updatedAt: new Date().toISOString(),
      });

      console.log(`${green}✓ Custom AI selection saved.${reset}`);
      console.log(`${gray}Selected:${reset} ${white}${selectedTopIds.length} visible AI${reset}`);
      console.log(`${gray}Expanded:${reset} ${white}${selectedIds.length} total AI (with sub-agent)${reset}`);
      console.log("");
      await pause();
      return;
    }

    if (choice === "set-main") {
      const selectedAgents = topLevelAgents.filter((agent) => selected.has(agent.id));
      if (!selectedAgents.length) {
        console.log(`${gray}Select AI first, then set main AI.${reset}`);
        console.log("");
        continue;
      }

      const mainChoice = await showMenu(
        "Choose Main AI",
        [
          ...selectedAgents.map((agent) => ({
            key: agent.id,
            label: truncateLabel(agent.name, 28),
            description: `${agentRoleLabel(agent.role)} | ${truncateLabel(agent.summary, 46)}`,
          })),
          { key: "back", label: "Back", description: "Cancel" },
        ],
        "use ↑↓ arrows, Enter to select",
      );

      if (mainChoice !== "back") {
        mainAgentId = String(mainChoice);
      }
      continue;
    }

    if (String(choice).startsWith("toggle:")) {
      const id = String(choice).slice("toggle:".length);
      if (!id) continue;
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.add(id);
      }
      continue;
    }
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function isTopLevelAgent(agent: CreatedAgentProfile): boolean {
  const parent = normalizeName(agent.parentAgent || "");
  return !parent || parent === "none";
}

function collectChildAgentsForMain(mainName: string, agents: CreatedAgentProfile[]): CreatedAgentProfile[] {
  const queue = [mainName];
  const visitedParents = new Set<string>();
  const collected: CreatedAgentProfile[] = [];
  const collectedIds = new Set<string>();

  while (queue.length) {
    const parent = queue.shift();
    if (!parent) continue;
    const normalizedParent = normalizeName(parent);
    if (!normalizedParent || visitedParents.has(normalizedParent)) continue;
    visitedParents.add(normalizedParent);

    for (const agent of agents) {
      if (!agent.parentAgent || normalizeName(agent.parentAgent) !== normalizedParent) continue;
      if (collectedIds.has(agent.id)) continue;
      collectedIds.add(agent.id);
      collected.push(agent);
      queue.push(agent.name);
    }
  }

  return collected;
}

async function activateCreatedAgentFlow(
  target: CreatedAgentProfile,
  agents: CreatedAgentProfile[],
): Promise<CreatedAgentProfile> {
  let mainAgent = target;
  if (target.role !== "main") {
    const parentName = normalizeName(target.parentAgent || "");
    if (parentName) {
      const parent = agents.find((agent) => normalizeName(agent.name) === parentName);
      if (parent) {
        mainAgent = parent;
      }
    }
  }

  const selected = dedupeAgents([mainAgent, ...collectChildAgentsForMain(mainAgent.name, agents)]);
  if (!selected.some((agent) => agent.id === target.id)) {
    selected.push(target);
  }

  await saveAgentUsageState({
    autoEnabled: false,
    selectedAgentIds: selected.map((agent) => agent.id),
    mainAgentId: mainAgent.id,
    updatedAt: new Date().toISOString(),
  });

  return mainAgent;
}

async function viewCreatedAgentFlow(): Promise<boolean> {
  while (true) {
    const agents = await listCreatedAgentProfiles();
    if (!agents.length) {
      console.log(`${gray}No created agents found.${reset}`);
      console.log("");
      await pause();
      return false;
    }

    const visibleAgents = agents.filter((agent) => isTopLevelAgent(agent));
    const usage = await loadAgentUsageState();
    const autoStatus = usage.autoEnabled ? "ON" : "OFF";
    const selectedCount = usage.selectedAgentIds.filter((id) => visibleAgents.some((agent) => agent.id === id)).length;

    const choice = await showMenu(
      "View Created AI",
      [
        {
          key: "auto",
          label: `Auto Feature: ${autoStatus}`,
          description: usage.autoEnabled
            ? "Normal chat will auto-pick needed AI agents"
            : "Auto mode disabled (custom selection active)",
        },
        {
          key: "custom",
          label: "Custom AI Select",
          description: `Select visible AI set (currently ${selectedCount})`,
        },
        {
          key: "delete",
          label: "Delete AI",
          description: "Delete one/all created AI profiles",
        },
        ...visibleAgents.map((agent) => ({
          key: `agent:${agent.id}`,
          label: truncateLabel(agent.name, 28),
          description: `${agentRoleLabel(agent.role)} | ${new Date(agent.updatedAt).toLocaleString("en-US")}`,
        })),
        { key: "back", label: "Back", description: "Go back" },
      ],
      "use ↑↓ arrows, Enter to select, 0 to cancel",
    );

    if (choice === "back") {
      return false;
    }

    if (choice === "auto") {
      await saveAgentUsageState({
        ...usage,
        autoEnabled: !usage.autoEnabled,
        updatedAt: new Date().toISOString(),
      });
      console.log(`${green}✓ Auto feature ${usage.autoEnabled ? "disabled" : "enabled"}.${reset}`);
      console.log("");
      await pause();
      continue;
    }

    if (choice === "custom") {
      await selectCustomAgentsFlow(agents);
      continue;
    }

    if (choice === "delete") {
      await deleteCreatedAgentFlow(agents);
      continue;
    }

    if (String(choice).startsWith("agent:")) {
      const id = String(choice).slice("agent:".length);
      const selectedAgent = visibleAgents.find((agent) => agent.id === id);
      if (selectedAgent) {
        const mainAgent = await activateCreatedAgentFlow(selectedAgent, agents);
        console.log(`${green}✓ Active AI selected:${reset} ${white}${mainAgent.name}${reset}`);
        console.log("");
        return true;
      }
      continue;
    }
  }
}

async function runAgentUsageMenu(): Promise<boolean> {
  while (true) {
    const choice = await showMenu("Agent Usage", [
      { key: "create", label: "Create Agent", description: "Create one or multiple AI agents with prompts" },
      { key: "view", label: "View Created Agent", description: "View agents and configure auto/custom usage" },
      { key: "done", label: "Done", description: "Return to main CLI" },
    ]);

    if (choice === "done") {
      return true;
    }

    if (choice === "create") {
      await createAgentUsageFlow();
      continue;
    }

    if (choice === "view") {
      const activated = await viewCreatedAgentFlow();
      if (activated) {
        return true;
      }
      continue;
    }
  }
}
function formatProviderName(provider: ProviderId): string {
  if (provider === "qwen") return "Qwen";
  if (provider === "minimax") return "MiniMax";
  if (provider === "antigravity") return "Antigravity";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "kilo") return "Kilo";
  return "Codex";
}

async function getProviderModels(provider: ProviderId): Promise<UiModel[]> {
  let models: UiModel[] = [];

  if (provider === "qwen") {
    const token = await loadQwenToken();
    const rawModels = await getQwenModels(token || undefined);
    models = rawModels.map((m) => ({ id: m.id, name: m.name, maxTokens: m.maxTokens }));
    return dedupeUiModels(models);
  }

  if (provider === "minimax") {
    const token = await loadMiniMaxToken();
    const rawModels = await getMiniMaxModels(token || undefined);
    models = rawModels.map((m) => ({ id: m.id, name: m.name, maxTokens: m.maxTokens }));
    return dedupeUiModels(models);
  }

  if (provider === "antigravity") {
    const token = await loadAntigravityToken();
    const rawModels = await getAntigravityModels(token || undefined);
    models = rawModels.map((m) => ({ id: m.id, name: m.name, maxTokens: m.maxTokens }));
    return dedupeUiModels(models);
  }

  if (provider === "openrouter") {
    const token = await loadOpenRouterToken();
    const rawModels = await getOpenRouterModels(token || undefined);
    models = rawModels.map((m) => ({ id: m.id, name: m.name, maxTokens: m.maxTokens }));
    return dedupeUiModels(models);
  }

  if (provider === "kilo") {
    const token = await loadKiloToken();
    const rawModels = await getKiloModels(token || undefined);
    models = rawModels.map((m) => ({ id: m.id, name: m.name, maxTokens: m.maxTokens }));
    return dedupeUiModels(models);
  }

  const token = await loadCodexToken();
  const rawModels = await getCodexModels(token || undefined);
  models = rawModels.map((m) => ({ id: m.id, name: m.name, maxTokens: m.maxTokens }));
  return dedupeUiModels(models);
}

async function handleProviderModelSetting(provider: ProviderId): Promise<boolean> {
  const providerName = formatProviderName(provider);
  const config = await loadAiRouterConfig();
  const models = await getProviderModels(provider);

  const items: Array<MenuItem<string>> = [
    { key: "auto", label: "Auto Select", description: `Auto-select ${providerName} model from prompt` },
    ...models.map((m) => ({
      key: `model:${m.id}`,
      label: m.name,
      description: `Always use ${m.id} (max ${m.maxTokens})`,
    })),
    { key: "back", label: "Back", description: "Go back" },
  ];

  const choice = await showMenu(`${providerName} Default Model`, items);
  if (choice === "back") return false;

  config.defaultProvider = provider;
  if (choice === "auto") {
    config.providers[provider] = { mode: "auto" };
    await saveAiRouterConfig(config);
    console.log(`${green}✓ ${providerName} default mode set to Auto Select.${reset}`);
    console.log("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    return true;
  }

  const modelId = choice.replace("model:", "");
  config.providers[provider] = {
    mode: "fixed",
    fixedModelId: modelId,
  };
  await saveAiRouterConfig(config);
  console.log(`${green}✓ ${providerName} default model set to ${cyan}${modelId}${reset}`);
  console.log("");
  await new Promise((resolve) => setTimeout(resolve, 400));
  return true;
}

async function handleDefaultModel(): Promise<boolean> {
  const config = await loadAiRouterConfig();
  const selectedOverrideActive = Boolean(config.selectedModel.enabled && config.selectedModel.provider);
  const defaultOn = !selectedOverrideActive;
  const selectedSummary = config.selectedModel.provider
    ? config.selectedModel.mode === "fixed" && config.selectedModel.fixedModelId
      ? `${config.selectedModel.provider}/${config.selectedModel.fixedModelId}`
      : `${config.selectedModel.provider}/auto`
    : config.lastUsedModel.provider && config.lastUsedModel.modelId
      ? `${config.lastUsedModel.provider}/${config.lastUsedModel.modelId}`
      : "none";

  const items: Array<MenuItem<string>> = [
    {
      key: "on",
      label: "Default On",
      description: defaultOn ? "Current: auto model routing enabled" : "Enable auto-select routing",
    },
    {
      key: "off",
      label: "Default Off",
      description: defaultOn
        ? `Use last selected model (${selectedSummary})`
        : `Current: locked to ${selectedSummary}`,
    },
    { key: "back", label: "Back", description: "Go back" },
  ];

  const choice = await showMenu("Default Model", items);
  if (choice === "back") return false;

  if (choice === "on") {
    config.defaultProvider = "auto";
    config.selectedModel = {
      enabled: false,
      mode: "auto",
      provider: undefined,
      fixedModelId: undefined,
    };
    await saveAiRouterConfig(config);
    console.log(`${green}✓ Default On enabled.${reset}`);
    console.log(`${gray}Model will auto-select from available providers.${reset}`);
    console.log("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    return true;
  }

  if (choice === "off") {
    const authenticatedProviders = await getAuthenticatedProviders();
    if (!authenticatedProviders.length) {
      console.log(`${gray}No authenticated provider found. Run /model first.${reset}`);
      console.log("");
      await pause();
      return false;
    }

    const preferredCandidates: ProviderId[] = [];
    if (config.selectedModel.provider) preferredCandidates.push(config.selectedModel.provider);
    if (config.lastUsedModel.provider) preferredCandidates.push(config.lastUsedModel.provider);
    if (config.defaultProvider !== "auto") preferredCandidates.push(config.defaultProvider);
    const provider =
      preferredCandidates.find((candidate) => authenticatedProviders.includes(candidate)) ||
      authenticatedProviders[0];

    let mode: "auto" | "fixed" = "auto";
    let fixedModelId: string | undefined;

    if (
      config.selectedModel.provider === provider &&
      config.selectedModel.mode === "fixed" &&
      config.selectedModel.fixedModelId
    ) {
      mode = "fixed";
      fixedModelId = config.selectedModel.fixedModelId;
    } else if (config.lastUsedModel.provider === provider && config.lastUsedModel.modelId) {
      mode = "fixed";
      fixedModelId = config.lastUsedModel.modelId;
    } else if (config.providers[provider].mode === "fixed" && config.providers[provider].fixedModelId) {
      mode = "fixed";
      fixedModelId = config.providers[provider].fixedModelId;
    }

    config.selectedModel = {
      enabled: true,
      provider,
      mode,
      fixedModelId: mode === "fixed" ? fixedModelId : undefined,
    };
    await saveAiRouterConfig(config);
    console.log(`${green}✓ Default Off enabled.${reset}`);
    console.log(
      `${gray}Locked to ${provider}${mode === "fixed" && fixedModelId ? `/${fixedModelId}` : "/auto"}.${reset}`,
    );
    console.log("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    return true;
  }

  return false;
}

async function getAuthenticatedProviders(): Promise<ProviderId[]> {
  const providers: ProviderId[] = [];
  if (await loadQwenToken()) providers.push("qwen");
  if (await loadMiniMaxToken()) providers.push("minimax");
  if (await loadCodexToken()) providers.push("codex");
  if (await loadAntigravityToken()) providers.push("antigravity");
  if (await loadOpenRouterToken()) providers.push("openrouter");
  if (await loadKiloToken()) providers.push("kilo");
  return providers;
}

function providerLabel(provider: ProviderId): string {
  if (provider === "qwen") return "Qwen";
  if (provider === "minimax") return "MiniMax";
  if (provider === "codex") return "Codex";
  if (provider === "antigravity") return "Antigravity";
  if (provider === "kilo") return "Kilo";
  return "OpenRouter";
}

async function handleSelectModelProvider(provider: ProviderId): Promise<boolean> {
  const config = await loadAiRouterConfig();
  const models = await getProviderModels(provider);
  const providerName = providerLabel(provider);

  if (!models.length) {
    console.log(`${gray}No models found for ${providerName}.${reset}`);
    console.log("");
    await pause();
    return false;
  }

  const current = config.selectedModel;
  const currentDesc =
    current.enabled && current.provider === provider
      ? current.mode === "fixed"
        ? `Current: ${current.fixedModelId || "fixed"}`
        : "Current: auto model"
      : "Use provider auto-select";

  const items: Array<MenuItem<string>> = [
    {
      key: "auto",
      label: "Auto Select",
      description: currentDesc,
    },
    ...models.map((m) => ({
      key: `model:${m.id}`,
      label: m.name,
      description: `Always use ${m.id} (personal selection)`,
    })),
    {
      key: "clear",
      label: "Clear Personal",
      description: "Disable personal selected model and return to default routing",
    },
    { key: "back", label: "Back", description: "Go back" },
  ];

  const choice = await showMenu(`${providerName} Select Model`, items);
  if (choice === "back") return false;

  if (choice === "clear") {
    config.selectedModel.enabled = false;
    await saveAiRouterConfig(config);
    console.log(`${green}✓ Personal model selection cleared. Using default routing.${reset}`);
    console.log("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    return true;
  }

  if (choice === "auto") {
    config.selectedModel = {
      enabled: true,
      provider,
      mode: "auto",
    };
    await saveAiRouterConfig(config);
    console.log(`${green}✓ Personal model set: ${cyan}${providerName}${reset} ${gray}(auto select)${reset}`);
    console.log("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    return true;
  }

  const modelId = choice.replace("model:", "");
  config.selectedModel = {
    enabled: true,
    provider,
    mode: "fixed",
    fixedModelId: modelId,
  };
  config.lastUsedModel = { provider, modelId };
  await saveAiRouterConfig(config);
  console.log(`${green}✓ Personal model set: ${cyan}${providerName}${reset} ${white}${modelId}${reset}`);
  console.log("");
  await new Promise((resolve) => setTimeout(resolve, 400));
  return true;
}

async function handleSelectModel(): Promise<boolean> {
  const providers = await getAuthenticatedProviders();
  if (!providers.length) {
    console.log(`${gray}No authenticated providers found. Run /model first.${reset}`);
    console.log("");
    await pause();
    return false;
  }

  const config = await loadAiRouterConfig();
  const selected = config.selectedModel;

  const items: Array<MenuItem<string>> = [
    ...providers.map((provider) => {
      const label = providerLabel(provider);
      const isCurrent = selected.enabled && selected.provider === provider;
      return {
        key: provider,
        label,
        description: isCurrent
          ? selected.mode === "fixed"
            ? `Current: ${selected.fixedModelId || "fixed"}`
            : "Current: auto model"
          : `Open ${label} model selection`,
      };
    }),
    { key: "back", label: "Back", description: "Go back" },
  ];

  const choice = await showMenu("Select Model", items);
  if (choice === "back") return false;
  return await handleSelectModelProvider(choice as ProviderId);
}

async function runAiRoleMenu(): Promise<boolean> {
  const active = await loadActiveAiRoleProfile();
  const choice = await showMenu("AI Role", [
    {
      key: "main",
      label: "Main AI",
      description: active.role === "main" ? "Current role" : "General task execution mode",
    },
    {
      key: "developer",
      label: "Developer AI",
      description: active.role === "developer" ? "Current role" : "Coding/debug/implementation focused",
    },
    {
      key: "researcher",
      label: "Researcher AI",
      description: active.role === "researcher" ? "Current role" : "Deep research and analysis focused",
    },
    {
      key: "designer",
      label: "Designer AI",
      description: active.role === "designer" ? "Current role" : "UI/UX and product design focused",
    },
    {
      key: "custom",
      label: "Custom AI",
      description: active.role === "custom" ? "Current role" : "Set your own behavior instructions",
    },
    { key: "back", label: "Back", description: "Return to AI Features" },
  ]);

  if (choice === "back") return false;

  const role = choice as AgentRole;
  let instructions = defaultRoleInstructions(role);
  if (role === "custom") {
    const customPrompt = await readMultilinePrompt("Custom AI role prompt");
    if (!customPrompt) {
      console.log(`${gray}Custom role not changed (empty prompt).${reset}`);
      console.log("");
      await pause();
      return false;
    }
    instructions = customPrompt;
  }

  await saveActiveAiRoleProfile({
    role,
    label: AI_FIXED_LABEL,
    instructions,
    updatedAt: new Date().toISOString(),
  });

  console.log(`${green}✓ AI Role updated:${reset} ${white}${agentRoleLabel(role)}${reset}`);
  console.log(`${gray}Prompt label will remain:${reset} ${white}${AI_FIXED_LABEL} >${reset}`);
  console.log("");
  await new Promise((resolve) => setTimeout(resolve, 350));
  return true;
}

export async function runAiCommand(): Promise<void> {
  while (true) {
    const choice = await showMenu("AI Features", [
      { key: 1, label: "AI Mode", description: "Single-AI task routing is active (agent mode removed)" },
      { key: 2, label: "Default Model", description: "Set default provider/model strategy" },
      { key: 3, label: "Select Model", description: "Choose active model manually" },
      { key: 4, label: "Agent Memory", description: "Manage role/rule memory files" },
      { key: 5, label: "Chat Session", description: "Manage chat session settings" },
      { key: 6, label: "Memory", description: "Add, view, or delete AI memory" },
      { key: 7, label: "Reset", description: "Reset auth, memory, and router data" },
      { key: 0, label: "Back", description: "Return to main CLI" },
    ]);

    switch (choice) {
      case 2:
        if (await handleDefaultModel()) {
          return;
        }
        continue;
      case 3:
        if (await handleSelectModel()) {
          return;
        }
        continue;
      case 0:
        return;
      case 1:
        console.log(`${green}✓ Agent mode is disabled.${reset}`);
        console.log(`${gray}Current mode:${reset} ${white}single AI + task-based auto model routing${reset}`);
        console.log(`${gray}Use /model or AI Features -> Select Model to lock a model manually.${reset}`);
        console.log("");
        await pause();
        continue;
      case 4:
        if (await runAgentMemoryMenu()) {
          return;
        }
        continue;
      case 5:
        if (await runChatSessionMenu()) {
          return;
        }
        continue;
      case 6:
        if (await runMemoryMenu()) {
          return;
        }
        continue;
      case 7:
        if (await runResetMenu()) {
          return;
        }
        continue;
      default:
        console.log(`${gray}This feature will be implemented next.${reset}`);
        console.log("");
        await pause();
    }
  }
}
