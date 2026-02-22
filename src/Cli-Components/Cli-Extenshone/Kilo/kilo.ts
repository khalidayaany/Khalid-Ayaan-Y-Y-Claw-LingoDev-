#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const KILO_TOKEN_FILE = join(STORE_DIR, "kilo-token.json");
const KILO_CONFIG_FILE = join(STORE_DIR, "kilo-config.json");

const DEFAULT_BASE_URL = "https://api.kilo.ai/api/gateway";

export type KiloAuthMode = "api" | "oauth";

export type KiloToken = {
  apiKey: string;
  userId?: string;
  createdAt: number;
  authMode: KiloAuthMode;
  baseUrl?: string;
};

export type KiloModel = {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  isFree: boolean;
  promptPrice?: number;
  completionPrice?: number;
};

export type KiloConfig = {
  authenticated: boolean;
  authMode?: KiloAuthMode;
  currentModel?: string;
  models: KiloModel[];
};

type KiloModelParse = {
  models: KiloModel[];
  userId?: string;
};

function normalizeBaseUrl(value?: string): string {
  const raw = value?.trim() || process.env.KILO_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  const normalized = withProtocol.replace(/\/+$/, "");

  try {
    const url = new URL(normalized);
    if (url.hostname.endsWith("kilo.ai") && !url.pathname.includes("/api/gateway")) {
      return DEFAULT_BASE_URL;
    }
  } catch {
    return DEFAULT_BASE_URL;
  }

  return normalized;
}

function normalizeModel(model: KiloModel): KiloModel {
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

function compareModels(a: KiloModel, b: KiloModel): number {
  const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  if (byName !== 0) return byName;
  return a.id.toLowerCase().localeCompare(b.id.toLowerCase());
}

function normalizeConfig(config: KiloConfig): KiloConfig {
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
    authMode: config.authMode === "oauth" ? "oauth" : "api",
    currentModel,
    models,
  };
}

function parseKiloModel(raw: any): KiloModel | null {
  const id = typeof raw?.id === "string" ? raw.id.trim() : "";
  if (!id) return null;

  const name =
    (typeof raw?.name === "string" && raw.name.trim()) ||
    (typeof raw?.display_name === "string" && raw.display_name.trim()) ||
    id;

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

  const contextWindow =
    typeof raw?.context_length === "number" && raw.context_length > 0
      ? raw.context_length
      : typeof raw?.context_window === "number" && raw.context_window > 0
        ? raw.context_window
        : typeof raw?.max_context_tokens === "number" && raw.max_context_tokens > 0
          ? raw.max_context_tokens
          : 128000;

  const maxTokens =
    typeof raw?.top_provider?.max_completion_tokens === "number" && raw.top_provider.max_completion_tokens > 0
      ? raw.top_provider.max_completion_tokens
      : typeof raw?.max_completion_tokens === "number" && raw.max_completion_tokens > 0
        ? raw.max_completion_tokens
        : 8192;

  const lower = `${id} ${name}`.toLowerCase();
  const supportsImage =
    Array.isArray(raw?.architecture?.input_modalities) && raw.architecture.input_modalities.includes("image")
      ? true
      : Array.isArray(raw?.supported_parameters) &&
          raw.supported_parameters.some((item: string) => typeof item === "string" && item.includes("image"))
        ? true
        : lower.includes("vision") || lower.includes("image") || lower.includes("gpt-4o") || lower.includes("gemini");

  const isFree = id.toLowerCase().includes(":free") || (promptPrice === 0 && completionPrice === 0);

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

function parseModelsPayload(payload: any): KiloModelParse {
  const rows: any[] = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  const models = rows
    .map(parseKiloModel)
    .filter((model): model is KiloModel => Boolean(model))
    .sort(compareModels);
  const userId =
    (typeof payload?.user_id === "string" && payload.user_id.trim()) ||
    (typeof payload?.user?.id === "string" && payload.user.id.trim()) ||
    undefined;
  return { models, userId };
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

async function fetchModelsWithKey(
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: boolean; models: KiloModel[]; userId?: string; message?: string }> {
  try {
    const endpoint = `${normalizeBaseUrl(baseUrl)}/models`;
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        models: [],
        message: text || `${response.status} ${response.statusText}`,
      };
    }
    const payload = await response.json();
    const parsed = parseModelsPayload(payload);
    if (!parsed.models.length) {
      return {
        ok: false,
        models: [],
        message: "Kilo returned no model list for this API key.",
      };
    }
    return { ok: true, models: parsed.models, userId: parsed.userId };
  } catch (error: any) {
    return {
      ok: false,
      models: [],
      message: error?.message || "Failed to reach Kilo model endpoint.",
    };
  }
}

async function fetchPublicModels(baseUrl?: string): Promise<KiloModel[]> {
  try {
    const endpoint = `${normalizeBaseUrl(baseUrl)}/models`;
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    return parseModelsPayload(payload).models;
  } catch {
    return [];
  }
}

function isCreditRelatedError(message?: string): boolean {
  const normalized = (message || "").toLowerCase();
  return (
    normalized.includes("credits required") ||
    normalized.includes("paid model") ||
    normalized.includes("\"balance\":0") ||
    normalized.includes("buycreditsurl")
  );
}

function parseJwtPayload(token: string): Record<string, any> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payloadPart = parts[1];
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    const payload = JSON.parse(decoded);
    if (!payload || typeof payload !== "object") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function saveKiloToken(token: KiloToken): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  const normalized: KiloToken = {
    apiKey: token.apiKey.trim(),
    userId: token.userId?.trim(),
    createdAt: token.createdAt || Date.now(),
    authMode: token.authMode === "oauth" ? "oauth" : "api",
    baseUrl: normalizeBaseUrl(token.baseUrl),
  };
  await fs.writeFile(KILO_TOKEN_FILE, JSON.stringify(normalized, null, 2));
}

export async function loadKiloToken(): Promise<KiloToken | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(KILO_TOKEN_FILE, "utf-8");
    const token = JSON.parse(content) as KiloToken;

    if (!token.apiKey || !token.apiKey.trim()) {
      return null;
    }

    return {
      apiKey: token.apiKey.trim(),
      userId: token.userId?.trim(),
      createdAt: token.createdAt || Date.now(),
      authMode: token.authMode === "oauth" ? "oauth" : "api",
      baseUrl: normalizeBaseUrl(token.baseUrl),
    };
  } catch {
    return null;
  }
}

export async function deleteKiloToken(): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(KILO_TOKEN_FILE);
  } catch {
    // ignore
  }
}

export async function saveKiloConfig(config: KiloConfig): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(KILO_CONFIG_FILE, JSON.stringify(normalizeConfig(config), null, 2));
}

export async function loadKiloConfig(): Promise<KiloConfig | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(KILO_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as KiloConfig;
    const normalized = normalizeConfig(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveKiloConfig(normalized);
    }

    return normalized;
  } catch {
    return null;
  }
}

export async function saveCurrentKiloModel(modelId: string): Promise<void> {
  const existing = await loadKiloConfig();
  const token = await loadKiloToken();
  await saveKiloConfig({
    authenticated: true,
    authMode: token?.authMode || "api",
    models: existing?.models || [],
    currentModel: modelId,
  });
}

export async function verifyKiloApiKey(
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: boolean; models: KiloModel[]; userId?: string; message?: string }> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { ok: false, models: [], message: "API key is empty." };
  }

  const payload = parseJwtPayload(trimmedKey);
  if (!payload) {
    return { ok: false, models: [], message: "Invalid API key format." };
  }

  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    return { ok: false, models: [], message: "API key has expired." };
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const modelsResult = await fetchModelsWithKey(trimmedKey, normalizedBaseUrl);
  if (!modelsResult.ok) {
    if (isCreditRelatedError(modelsResult.message)) {
      const publicModels = await fetchPublicModels(normalizedBaseUrl);
      const userId =
        (typeof payload.kiloUserId === "string" && payload.kiloUserId.trim()) ||
        (typeof payload.user_id === "string" && payload.user_id.trim()) ||
        undefined;
      return {
        ok: true,
        models: publicModels,
        userId,
        message: "API key verified. Account has no paid credits right now; free models can still be used.",
      };
    }
    return modelsResult;
  }

  return modelsResult;
}

export async function getKiloModels(token?: KiloToken): Promise<KiloModel[]> {
  const config = await loadKiloConfig();
  if (!token) return config?.models || [];

  const fetched = await fetchModelsWithKey(token.apiKey, token.baseUrl);
  if (!fetched.ok || !fetched.models.length) {
    return config?.models || [];
  }

  await saveKiloConfig({
    authenticated: true,
    authMode: token.authMode,
    models: fetched.models,
    currentModel: fetched.models[0].id,
  });

  return fetched.models;
}

export function resolveKiloBaseUrl(token?: KiloToken): string {
  return normalizeBaseUrl(token?.baseUrl);
}
