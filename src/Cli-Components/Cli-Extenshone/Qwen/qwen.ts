#!/usr/bin/env bun

import { join } from "node:path";
import { homedir } from "node:os";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const QWEN_TOKEN_FILE = join(STORE_DIR, "qwen-token.json");
const QWEN_CONFIG_FILE = join(STORE_DIR, "qwen-config.json");

const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const DEFAULT_BASE_URL = "https://portal.qwen.ai/v1";

export type QwenToken = {
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
};

export type QwenModel = {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
};

export type QwenConfig = {
  authenticated: boolean;
  currentModel?: string;
  models: QwenModel[];
};

function normalizeModelId(modelId?: string): string | undefined {
  if (!modelId) return undefined;
  const lower = modelId.toLowerCase();
  if (lower === "qwen-coder") return "coder-model";
  if (lower === "qwen-vision") return "vision-model";
  if (lower === "qwen-plus") return "coder-model";
  return modelId;
}

function normalizeModel(model: QwenModel): QwenModel {
  return {
    ...model,
    id: normalizeModelId(model.id) || model.id,
  };
}

function normalizeConfig(config: QwenConfig): QwenConfig {
  const models = (config.models || [])
    .map(normalizeModel)
    .filter((model, index, arr) => arr.findIndex((m) => m.id === model.id) === index);
  let currentModel = normalizeModelId(config.currentModel);
  if (currentModel && !models.some((m) => m.id === currentModel)) {
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

function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function normalizeBaseUrl(value?: string): string {
  const raw = value?.trim() || DEFAULT_BASE_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.endsWith("/v1") ? withProtocol : `${withProtocol.replace(/\/+$/, "")}/v1`;
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

async function refreshAccessToken(token: QwenToken): Promise<QwenToken | null> {
  try {
    const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: toFormUrlEncoded({
        grant_type: "refresh_token",
        client_id: QWEN_OAUTH_CLIENT_ID,
        refresh_token: token.refresh,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      resource_url?: string;
    };

    if (!payload.access_token || !payload.refresh_token || !payload.expires_in) {
      return null;
    }

    return {
      access: payload.access_token,
      refresh: payload.refresh_token,
      expires: Date.now() + payload.expires_in * 1000,
      resourceUrl: payload.resource_url || token.resourceUrl,
    };
  } catch {
    return null;
  }
}

export async function saveQwenToken(token: QwenToken): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(QWEN_TOKEN_FILE, JSON.stringify(token, null, 2));
}

export async function loadQwenToken(): Promise<QwenToken | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(QWEN_TOKEN_FILE, "utf-8");
    const token = JSON.parse(content) as QwenToken;

    if (token.expires > Date.now()) {
      return token;
    }

    const refreshed = await refreshAccessToken(token);
    if (!refreshed) {
      return null;
    }

    await saveQwenToken(refreshed);
    return refreshed;
  } catch {
    return null;
  }
}

export async function deleteQwenToken(): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(QWEN_TOKEN_FILE);
  } catch {
    // ignore
  }
}

export async function saveQwenConfig(config: QwenConfig): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(QWEN_CONFIG_FILE, JSON.stringify(normalizeConfig(config), null, 2));
}

export async function loadQwenConfig(): Promise<QwenConfig | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(QWEN_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as QwenConfig;
    const normalized = normalizeConfig(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveQwenConfig(normalized);
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function saveCurrentModel(modelId: string): Promise<void> {
  const existing = await loadQwenConfig();
  const models = existing?.models || [];
  await saveQwenConfig({
    authenticated: true,
    models,
    currentModel: normalizeModelId(modelId),
  });
}

export async function isQwenAuthenticated(): Promise<boolean> {
  const token = await loadQwenToken();
  return token !== null;
}

function fallbackModels(): QwenModel[] {
  return [
    {
      id: "coder-model",
      name: "Qwen Coder",
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 8192,
    },
    {
      id: "vision-model",
      name: "Qwen Vision",
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ];
}

export async function getQwenModels(token?: QwenToken): Promise<QwenModel[]> {
  const config = await loadQwenConfig();
  if (!token && config?.models?.length) {
    return config.models;
  }

  if (!token) {
    return fallbackModels();
  }

  try {
    const baseUrl = normalizeBaseUrl(token.resourceUrl);
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${token.access}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return fallbackModels();
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; name?: string }>;
    };

    const models = (payload.data || [])
      .filter((m) => Boolean(m.id))
      .map((m) => {
        const id = normalizeModelId(m.id!) || m.id!;
        const name = m.name || id;
        const lower = `${id} ${name}`.toLowerCase();
        const hasVision = lower.includes("vision") || lower.includes("vl") || lower.includes("image");
        return {
          id,
          name,
          input: hasVision ? (["text", "image"] as Array<"text" | "image">) : (["text"] as Array<"text" | "image">),
          contextWindow: 128000,
          maxTokens: 8192,
        };
      });

    if (!models.length) {
      return config?.models?.length ? config.models : fallbackModels();
    }

    await saveQwenConfig({
      authenticated: true,
      models,
      currentModel: models[0].id,
    });

    return models;
  } catch {
    return config?.models?.length ? config.models : fallbackModels();
  }
}

export function resolveQwenBaseUrl(token?: QwenToken): string {
  return normalizeBaseUrl(token?.resourceUrl);
}
