#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const ANTIGRAVITY_TOKEN_FILE = join(STORE_DIR, "antigravity-token.json");
const ANTIGRAVITY_CONFIG_FILE = join(STORE_DIR, "antigravity-config.json");

const decode = (value: string): string => Buffer.from(value, "base64").toString();
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "YOUR_CLIENT_ID_PLACEHOLDER";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "YOUR_CLIENT_SECRET_PLACEHOLDER";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const DEFAULT_BASE_URL = ANTIGRAVITY_ENDPOINT_DAILY;
const ANTIGRAVITY_MODEL_PREFIXES = ["google-antigravity/", "antigravity/"];

const CLAUDE_THINKING_MODELS = new Set([
  "claude-opus-4-5-thinking",
  "claude-opus-4-6-thinking",
  "claude-sonnet-4-5-thinking",
]);

export type AntigravityToken = {
  access: string;
  refresh: string;
  expires: number;
  projectId: string;
  baseUrl?: string;
  email?: string;
};

export type AntigravityModel = {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
};

export type AntigravityConfig = {
  authenticated: boolean;
  currentModel?: string;
  models: AntigravityModel[];
};

function fallbackModels(): AntigravityModel[] {
  return [
    {
      id: "claude-opus-4-5-thinking",
      name: "Claude Opus 4.5 Thinking (Antigravity)",
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
    },
    {
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5 (Antigravity)",
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: false,
    },
    {
      id: "claude-sonnet-4-5-thinking",
      name: "Claude Sonnet 4.5 Thinking (Antigravity)",
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 64000,
      reasoning: true,
    },
    {
      id: "gemini-3-pro-high",
      name: "Gemini 3 Pro High (Antigravity)",
      input: ["text", "image"],
      contextWindow: 1048576,
      maxTokens: 65535,
      reasoning: true,
    },
    {
      id: "gemini-3-pro-low",
      name: "Gemini 3 Pro Low (Antigravity)",
      input: ["text", "image"],
      contextWindow: 1048576,
      maxTokens: 65535,
      reasoning: true,
    },
    {
      id: "gemini-3-flash",
      name: "Gemini 3 Flash (Antigravity)",
      input: ["text", "image"],
      contextWindow: 1048576,
      maxTokens: 65535,
      reasoning: true,
    },
    {
      id: "gpt-oss-120b-medium",
      name: "GPT-OSS 120B Medium (Antigravity)",
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 32768,
      reasoning: false,
    },
  ];
}

function normalizeBaseUrl(value?: string): string {
  const raw = value?.trim() || DEFAULT_BASE_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

export function normalizeAntigravityModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const lower = trimmed.toLowerCase();

  for (const prefix of ANTIGRAVITY_MODEL_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }

  return trimmed;
}

function normalizeModel(model: AntigravityModel): AntigravityModel {
  const id = normalizeAntigravityModelId(model.id);
  const lower = id.toLowerCase();

  const hasImage =
    Array.isArray(model.input) && model.input.includes("image")
      ? true
      : !lower.includes("gpt-oss") && !lower.includes("text-only");

  const contextWindow =
    Number.isFinite(model.contextWindow) && model.contextWindow > 0
      ? model.contextWindow
      : lower.includes("gemini")
        ? 1048576
        : lower.includes("gpt-oss")
          ? 131072
          : 200000;

  const maxTokens =
    Number.isFinite(model.maxTokens) && model.maxTokens > 0
      ? model.maxTokens
      : lower.includes("gemini")
        ? 65535
        : lower.includes("gpt-oss")
          ? 32768
          : 64000;

  return {
    id,
    name: model.name?.trim() || id,
    input: hasImage ? ["text", "image"] : ["text"],
    contextWindow,
    maxTokens,
    reasoning: Boolean(model.reasoning || lower.includes("thinking") || lower.includes("gemini")),
  };
}

function normalizeConfig(config: AntigravityConfig): AntigravityConfig {
  const models = (config.models || [])
    .map(normalizeModel)
    .filter((model, index, list) => list.findIndex((item) => item.id === model.id) === index);

  let currentModel = config.currentModel ? normalizeAntigravityModelId(config.currentModel) : undefined;
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

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

async function refreshAccessToken(token: AntigravityToken): Promise<AntigravityToken | null> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: token.refresh,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token || !payload.expires_in) {
      return null;
    }

    return {
      access: payload.access_token,
      refresh: payload.refresh_token || token.refresh,
      expires: Date.now() + payload.expires_in * 1000 - 5 * 60 * 1000,
      projectId: token.projectId,
      baseUrl: token.baseUrl,
      email: token.email,
    };
  } catch {
    return null;
  }
}

export async function saveAntigravityToken(token: AntigravityToken): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  const normalized: AntigravityToken = {
    ...token,
    projectId: token.projectId.trim(),
    baseUrl: normalizeBaseUrl(token.baseUrl),
  };
  await fs.writeFile(ANTIGRAVITY_TOKEN_FILE, JSON.stringify(normalized, null, 2));
}

export async function loadAntigravityToken(): Promise<AntigravityToken | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(ANTIGRAVITY_TOKEN_FILE, "utf-8");
    const token = JSON.parse(content) as AntigravityToken;

    if (!token.projectId || !token.access || !token.refresh) {
      return null;
    }

    if (token.expires > Date.now()) {
      return {
        ...token,
        baseUrl: normalizeBaseUrl(token.baseUrl),
      };
    }

    const refreshed = await refreshAccessToken(token);
    if (!refreshed) {
      return null;
    }

    await saveAntigravityToken(refreshed);
    return refreshed;
  } catch {
    return null;
  }
}

export async function deleteAntigravityToken(): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(ANTIGRAVITY_TOKEN_FILE);
  } catch {
    // ignore
  }
}

export async function saveAntigravityConfig(config: AntigravityConfig): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(ANTIGRAVITY_CONFIG_FILE, JSON.stringify(normalizeConfig(config), null, 2));
}

export async function loadAntigravityConfig(): Promise<AntigravityConfig | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(ANTIGRAVITY_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as AntigravityConfig;
    const normalized = normalizeConfig(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveAntigravityConfig(normalized);
    }

    return normalized;
  } catch {
    return null;
  }
}

export async function saveCurrentAntigravityModel(modelId: string): Promise<void> {
  const existing = await loadAntigravityConfig();
  const normalizedModelId = normalizeAntigravityModelId(modelId);
  await saveAntigravityConfig({
    authenticated: true,
    models: existing?.models?.length ? existing.models : fallbackModels(),
    currentModel: normalizedModelId,
  });
}

function asTitleCase(input: string): string {
  return input
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function modelFromId(modelId: string): AntigravityModel {
  const normalizedId = normalizeAntigravityModelId(modelId);
  const lower = normalizedId.toLowerCase();
  const isGemini = lower.includes("gemini");
  const isClaude = lower.includes("claude");
  const isGptOss = lower.includes("gpt-oss");
  const isThinking = CLAUDE_THINKING_MODELS.has(lower) || lower.includes("thinking");

  let name = asTitleCase(normalizedId);
  if (isClaude) {
    name = `${name} (Antigravity)`;
  } else if (isGemini) {
    name = `${name} (Antigravity)`;
  } else if (isGptOss) {
    name = `${name.toUpperCase()} (Antigravity)`;
  }

  return normalizeModel({
    id: normalizedId,
    name,
    input: isGptOss ? ["text"] : ["text", "image"],
    contextWindow: isGemini ? 1048576 : isGptOss ? 131072 : 200000,
    maxTokens: isGemini ? 65535 : isGptOss ? 32768 : 64000,
    reasoning: isThinking || isGemini,
  });
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

async function fetchAvailableModels(token: AntigravityToken): Promise<AntigravityModel[]> {
  const endpoints = [
    resolveAntigravityBaseUrl(token),
    ANTIGRAVITY_ENDPOINT_DAILY,
    ANTIGRAVITY_ENDPOINT_PROD,
  ].filter((value, index, list) => list.indexOf(value) === index);

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access}`,
          "Content-Type": "application/json",
          ...getAntigravityHeaders(),
        },
        body: JSON.stringify({ project: token.projectId }),
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as {
        models?: Record<string, { displayName?: string }>;
      };

      const keys = Object.keys(payload.models || {}).filter((key) => key.trim().length > 0);
      if (!keys.length) {
        continue;
      }

      const models = keys
        .map((id) => {
          const fromId = modelFromId(id);
          const displayName = payload.models?.[id]?.displayName?.trim();
          return {
            ...fromId,
            name: displayName || fromId.name,
          };
        })
        .filter((model, index, list) => list.findIndex((item) => item.id === model.id) === index);

      return models;
    } catch {
      // try next endpoint
    }
  }

  return [];
}

export async function getAntigravityModels(token?: AntigravityToken): Promise<AntigravityModel[]> {
  const config = await loadAntigravityConfig();
  if (!token && config?.models?.length) {
    return config.models;
  }

  if (!token) {
    return fallbackModels();
  }

  const fetched = await fetchAvailableModels(token);
  if (fetched.length > 0) {
    await saveAntigravityConfig({
      authenticated: true,
      models: fetched,
      currentModel: fetched[0].id,
    });
    return fetched;
  }

  if (config?.models?.length) {
    return config.models;
  }

  const models = fallbackModels();
  await saveAntigravityConfig({
    authenticated: true,
    models,
    currentModel: models[0].id,
  });
  return models;
}

export function resolveAntigravityBaseUrl(token?: AntigravityToken): string {
  return normalizeBaseUrl(token?.baseUrl);
}
