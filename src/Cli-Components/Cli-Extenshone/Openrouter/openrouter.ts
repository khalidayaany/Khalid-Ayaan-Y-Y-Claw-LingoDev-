#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const OPENROUTER_TOKEN_FILE = join(STORE_DIR, "openrouter-token.json");
const OPENROUTER_CONFIG_FILE = join(STORE_DIR, "openrouter-config.json");

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterToken = {
  apiKey: string;
  userId?: string;
  createdAt: number;
};

export type OpenRouterModel = {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  isFree: boolean;
  promptPrice?: number;
  completionPrice?: number;
};

export type OpenRouterConfig = {
  authenticated: boolean;
  currentModel?: string;
  models: OpenRouterModel[];
};

function fallbackModels(): OpenRouterModel[] {
  return [
    {
      id: "anthropic/claude-3.7-sonnet",
      name: "Claude 3.7 Sonnet",
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 8192,
      isFree: false,
    },
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o Mini",
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 8192,
      isFree: false,
    },
    {
      id: "google/gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      input: ["text", "image"],
      contextWindow: 1048576,
      maxTokens: 8192,
      isFree: false,
    },
  ];
}

function normalizeModel(model: OpenRouterModel): OpenRouterModel {
  const id = model.id.trim();
  const lower = `${id} ${model.name}`.toLowerCase();
  const hasImage =
    model.input.includes("image") ||
    lower.includes("vision") ||
    lower.includes("image") ||
    lower.includes("gpt-4o") ||
    lower.includes("gemini");

  return {
    id,
    name: model.name?.trim() || id,
    input: hasImage ? ["text", "image"] : ["text"],
    contextWindow:
      Number.isFinite(model.contextWindow) && model.contextWindow > 0
        ? model.contextWindow
        : 128000,
    maxTokens:
      Number.isFinite(model.maxTokens) && model.maxTokens > 0
        ? model.maxTokens
        : 8192,
    isFree: Boolean(model.isFree || id.toLowerCase().includes(":free")),
    promptPrice: Number.isFinite(model.promptPrice) ? model.promptPrice : undefined,
    completionPrice: Number.isFinite(model.completionPrice) ? model.completionPrice : undefined,
  };
}

function compareModels(a: OpenRouterModel, b: OpenRouterModel): number {
  const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  if (byName !== 0) return byName;
  return a.id.toLowerCase().localeCompare(b.id.toLowerCase());
}

function normalizeConfig(config: OpenRouterConfig): OpenRouterConfig {
  const models = (config.models || [])
    .map(normalizeModel)
    .filter((model, index, list) => list.findIndex((item) => item.id === model.id) === index)
    .sort(compareModels);

  let currentModel = config.currentModel?.trim();
  if (currentModel && !models.some((model) => model.id === currentModel)) {
    currentModel = undefined;
  }
  if (!currentModel && models.length > 0) {
    currentModel = models[0].id;
  }

  return {
    authenticated: Boolean(config.authenticated),
    models,
    currentModel,
  };
}

function normalizeBaseUrl(value?: string): string {
  const raw = value?.trim() || DEFAULT_BASE_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function saveOpenRouterToken(token: OpenRouterToken): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  const normalized: OpenRouterToken = {
    apiKey: token.apiKey.trim(),
    userId: token.userId?.trim(),
    createdAt: token.createdAt || Date.now(),
  };
  await fs.writeFile(OPENROUTER_TOKEN_FILE, JSON.stringify(normalized, null, 2));
}

export async function loadOpenRouterToken(): Promise<OpenRouterToken | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(OPENROUTER_TOKEN_FILE, "utf-8");
    const token = JSON.parse(content) as OpenRouterToken;

    if (!token.apiKey || !token.apiKey.trim()) {
      return null;
    }

    return {
      apiKey: token.apiKey.trim(),
      userId: token.userId?.trim(),
      createdAt: token.createdAt || Date.now(),
    };
  } catch {
    return null;
  }
}

export async function deleteOpenRouterToken(): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(OPENROUTER_TOKEN_FILE);
  } catch {
    // ignore
  }
}

export async function saveOpenRouterConfig(config: OpenRouterConfig): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(OPENROUTER_CONFIG_FILE, JSON.stringify(normalizeConfig(config), null, 2));
}

export async function loadOpenRouterConfig(): Promise<OpenRouterConfig | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(OPENROUTER_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as OpenRouterConfig;
    const normalized = normalizeConfig(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveOpenRouterConfig(normalized);
    }

    return normalized;
  } catch {
    return null;
  }
}

export async function saveCurrentOpenRouterModel(modelId: string): Promise<void> {
  const existing = await loadOpenRouterConfig();
  await saveOpenRouterConfig({
    authenticated: true,
    models: existing?.models?.length ? existing.models : fallbackModels(),
    currentModel: modelId,
  });
}

function parseOpenRouterModel(raw: any): OpenRouterModel | null {
  const id = typeof raw?.id === "string" ? raw.id.trim() : "";
  if (!id) return null;

  const name =
    (typeof raw?.name === "string" && raw.name.trim()) ||
    (typeof raw?.canonical_slug === "string" && raw.canonical_slug.trim()) ||
    id;

  const contextWindow =
    typeof raw?.context_length === "number" && raw.context_length > 0
      ? raw.context_length
      : typeof raw?.context_window === "number" && raw.context_window > 0
        ? raw.context_window
        : 128000;

  const maxTokens =
    typeof raw?.top_provider?.max_completion_tokens === "number" && raw.top_provider.max_completion_tokens > 0
      ? raw.top_provider.max_completion_tokens
      : 8192;

  const parsePrice = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  };

  const promptPrice = parsePrice(
    raw?.pricing?.prompt ??
      raw?.pricing?.input ??
      raw?.top_provider?.pricing?.prompt ??
      raw?.top_provider?.pricing?.input,
  );
  const completionPrice = parsePrice(
    raw?.pricing?.completion ??
      raw?.pricing?.output ??
      raw?.top_provider?.pricing?.completion ??
      raw?.top_provider?.pricing?.output,
  );

  const lowerId = id.toLowerCase();
  const isFree = lowerId.includes(":free") || (promptPrice === 0 && completionPrice === 0);

  const lower = `${id} ${name}`.toLowerCase();
  const supportsImage =
    Array.isArray(raw?.architecture?.input_modalities) && raw.architecture.input_modalities.includes("image")
      ? true
      : Array.isArray(raw?.supported_parameters) &&
          raw.supported_parameters.some((item: string) => typeof item === "string" && item.includes("image"))
        ? true
        : lower.includes("vision") || lower.includes("image") || lower.includes("gpt-4o") || lower.includes("gemini");

  return normalizeModel({
    id,
    name,
    input: supportsImage ? ["text", "image"] : ["text"],
    contextWindow,
    maxTokens,
    isFree,
    promptPrice,
    completionPrice,
  });
}

export async function getOpenRouterModels(token?: OpenRouterToken): Promise<OpenRouterModel[]> {
  const config = await loadOpenRouterConfig();
  if (!token && config?.models?.length) {
    return config.models;
  }

  if (!token) {
    return fallbackModels();
  }

  try {
    const response = await fetch(`${DEFAULT_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${token.apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return config?.models?.length ? config.models : fallbackModels();
    }

    const payload = (await response.json()) as { data?: any[] };
    const models = (payload.data || [])
      .map(parseOpenRouterModel)
      .filter((model): model is OpenRouterModel => Boolean(model))
      .sort(compareModels);

    if (!models.length) {
      return config?.models?.length ? config.models : fallbackModels();
    }

    await saveOpenRouterConfig({
      authenticated: true,
      models,
      currentModel: models[0].id,
    });

    return models;
  } catch {
    return config?.models?.length ? config.models : fallbackModels();
  }
}

export function isOpenRouterFreeModel(model: OpenRouterModel): boolean {
  return Boolean(model.isFree || model.id.toLowerCase().includes(":free"));
}

export async function getOpenRouterFreeModels(token?: OpenRouterToken): Promise<OpenRouterModel[]> {
  const models = await getOpenRouterModels(token);
  return models.filter(isOpenRouterFreeModel).sort(compareModels);
}

export function resolveOpenRouterBaseUrl(): string {
  return normalizeBaseUrl(DEFAULT_BASE_URL);
}
