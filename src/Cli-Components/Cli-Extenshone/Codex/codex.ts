#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const CODEX_TOKEN_FILE = join(STORE_DIR, "codex-token.json");
const CODEX_CONFIG_FILE = join(STORE_DIR, "codex-config.json");

const CODEX_HOME = join(homedir(), ".codex");
const CODEX_AUTH_FILE = join(CODEX_HOME, "auth.json");
const CODEX_MODELS_CACHE_FILE = join(CODEX_HOME, "models_cache.json");

export type CodexToken = {
  authenticated: boolean;
  source: "codex-cli";
  authMode: "chatgpt" | "api_key" | "unknown";
  accountId?: string;
  lastRefresh?: number;
};

export type CodexModel = {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
};

export type CodexConfig = {
  authenticated: boolean;
  currentModel?: string;
  models: CodexModel[];
};

type CodexAuthPayload = {
  auth_mode?: string;
  last_refresh?: string | number;
  OPENAI_API_KEY?: string;
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
};

type CodexModelsCachePayload = {
  models?: Array<{
    slug?: string;
    display_name?: string;
    description?: string;
    context_window?: number;
    input_modalities?: string[];
  }>;
};

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

function parseLastRefresh(value?: string | number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fallbackModels(): CodexModel[] {
  return [
    {
      id: "gpt-5.3-codex",
      name: "gpt-5.3-codex",
      input: ["text"],
      contextWindow: 256000,
      maxTokens: 32768,
    },
    {
      id: "gpt-5.2-codex",
      name: "gpt-5.2-codex",
      input: ["text"],
      contextWindow: 256000,
      maxTokens: 32768,
    },
    {
      id: "gpt-5.1-codex-max",
      name: "gpt-5.1-codex-max",
      input: ["text"],
      contextWindow: 256000,
      maxTokens: 32768,
    },
    {
      id: "gpt-5.1-codex",
      name: "gpt-5.1-codex",
      input: ["text"],
      contextWindow: 256000,
      maxTokens: 32768,
    },
  ];
}

async function readCodexAuthFile(): Promise<CodexAuthPayload | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(CODEX_AUTH_FILE, "utf-8");
    return JSON.parse(content) as CodexAuthPayload;
  } catch {
    return null;
  }
}

function toCodexToken(payload: CodexAuthPayload): CodexToken | null {
  const hasApiKey = typeof payload.OPENAI_API_KEY === "string" && payload.OPENAI_API_KEY.trim().length > 0;
  const hasAccessToken =
    typeof payload.tokens?.access_token === "string" && payload.tokens.access_token.trim().length > 0;

  if (!hasApiKey && !hasAccessToken) {
    return null;
  }

  let authMode: CodexToken["authMode"] = "unknown";
  if (payload.auth_mode === "chatgpt") {
    authMode = "chatgpt";
  } else if (payload.auth_mode === "api_key" || hasApiKey) {
    authMode = "api_key";
  }

  return {
    authenticated: true,
    source: "codex-cli",
    authMode,
    accountId: payload.tokens?.account_id,
    lastRefresh: parseLastRefresh(payload.last_refresh),
  };
}

export async function saveCodexToken(token: CodexToken): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(CODEX_TOKEN_FILE, JSON.stringify(token, null, 2));
}

export async function loadCodexToken(): Promise<CodexToken | null> {
  const authPayload = await readCodexAuthFile();
  const liveToken = authPayload ? toCodexToken(authPayload) : null;
  if (liveToken) {
    await saveCodexToken(liveToken);
    return liveToken;
  }

  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(CODEX_TOKEN_FILE, "utf-8");
    const cached = JSON.parse(content) as CodexToken;
    return cached.authenticated ? cached : null;
  } catch {
    return null;
  }
}

export async function deleteCodexToken(): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(CODEX_TOKEN_FILE);
  } catch {
    // ignore
  }
}

export async function saveCodexConfig(config: CodexConfig): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(CODEX_CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function loadCodexConfig(): Promise<CodexConfig | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(CODEX_CONFIG_FILE, "utf-8");
    return JSON.parse(content) as CodexConfig;
  } catch {
    return null;
  }
}

export async function saveCurrentCodexModel(modelId: string): Promise<void> {
  const existing = await loadCodexConfig();
  await saveCodexConfig({
    authenticated: true,
    models: existing?.models?.length ? existing.models : fallbackModels(),
    currentModel: modelId,
  });
}

export async function getCurrentCodexModel(): Promise<string | undefined> {
  const config = await loadCodexConfig();
  return config?.currentModel;
}

async function readCodexModelsFromCache(): Promise<CodexModel[]> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(CODEX_MODELS_CACHE_FILE, "utf-8");
    const payload = JSON.parse(content) as CodexModelsCachePayload;

    const all = (payload.models || [])
      .filter((model) => typeof model.slug === "string" && model.slug.trim().length > 0)
      .map((model) => {
        const id = model.slug!.trim();
        const name = (model.display_name || id).trim();
        const lower = `${id} ${name}`.toLowerCase();
        const hasImage = (model.input_modalities || []).some((item) => item === "image");
        return {
          id,
          name,
          input: hasImage ? (["text", "image"] as Array<"text" | "image">) : (["text"] as Array<"text" | "image">),
          contextWindow: model.context_window && model.context_window > 0 ? model.context_window : 256000,
          maxTokens: lower.includes("mini") ? 16384 : 32768,
        };
      })
      .filter((model, index, list) => list.findIndex((item) => item.id === model.id) === index);

    const codexFirst = all.sort((a, b) => {
      const aCodex = a.id.includes("codex") ? 0 : 1;
      const bCodex = b.id.includes("codex") ? 0 : 1;
      return aCodex - bCodex;
    });

    return codexFirst.slice(0, 12);
  } catch {
    return [];
  }
}

export async function getCodexModels(_token?: CodexToken): Promise<CodexModel[]> {
  const fromCache = await readCodexModelsFromCache();
  if (fromCache.length > 0) {
    await saveCodexConfig({
      authenticated: true,
      models: fromCache,
      currentModel: fromCache[0].id,
    });
    return fromCache;
  }

  const config = await loadCodexConfig();
  if (config?.models?.length) {
    return config.models;
  }

  const defaults = fallbackModels();
  await saveCodexConfig({
    authenticated: true,
    models: defaults,
    currentModel: defaults[0].id,
  });
  return defaults;
}
