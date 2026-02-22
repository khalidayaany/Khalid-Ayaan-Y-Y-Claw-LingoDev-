#!/usr/bin/env bun

import { join } from "node:path";
import { homedir } from "node:os";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const MINIMAX_TOKEN_FILE = join(STORE_DIR, "minimax-token.json");
const MINIMAX_CONFIG_FILE = join(STORE_DIR, "minimax-config.json");

const MINIMAX_OAUTH_BASE_URL = "https://api.minimax.io";
const MINIMAX_OAUTH_TOKEN_ENDPOINT = `${MINIMAX_OAUTH_BASE_URL}/oauth/token`;
const MINIMAX_OAUTH_CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const DEFAULT_BASE_URL = "https://api.minimax.io/anthropic";

export type MiniMaxToken = {
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
};

export type MiniMaxModel = {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
};

export type MiniMaxConfig = {
  authenticated: boolean;
  currentModel?: string;
  models: MiniMaxModel[];
};

function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function normalizeBaseUrl(value?: string): string {
  const raw = value?.trim() || DEFAULT_BASE_URL;
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  const clean = withProtocol.replace(/\/+$/, "");
  return clean.includes("/anthropic") ? clean : `${clean}/anthropic`;
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

async function refreshAccessToken(token: MiniMaxToken): Promise<MiniMaxToken | null> {
  try {
    const response = await fetch(MINIMAX_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: toFormUrlEncoded({
        grant_type: "refresh_token",
        client_id: MINIMAX_OAUTH_CLIENT_ID,
        refresh_token: token.refresh,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expired_in?: number;
      resource_url?: string;
      status?: string;
    };

    if (!payload.access_token || !payload.refresh_token || !payload.expired_in) {
      return null;
    }

    const expires = payload.expired_in > 1_000_000_000_000
      ? payload.expired_in
      : payload.expired_in > 1_000_000_000
        ? payload.expired_in * 1000
        : Date.now() + payload.expired_in * 1000;

    return {
      access: payload.access_token,
      refresh: payload.refresh_token,
      expires,
      resourceUrl: payload.resource_url || token.resourceUrl,
    };
  } catch {
    return null;
  }
}

export async function saveMiniMaxToken(token: MiniMaxToken): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(MINIMAX_TOKEN_FILE, JSON.stringify(token, null, 2));
}

export async function loadMiniMaxToken(): Promise<MiniMaxToken | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(MINIMAX_TOKEN_FILE, "utf-8");
    const token = JSON.parse(content) as MiniMaxToken;

    if (token.expires > Date.now()) {
      return token;
    }

    const refreshed = await refreshAccessToken(token);
    if (!refreshed) return null;

    await saveMiniMaxToken(refreshed);
    return refreshed;
  } catch {
    return null;
  }
}

export async function deleteMiniMaxToken(): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(MINIMAX_TOKEN_FILE);
  } catch {
    // ignore
  }
}

export async function saveMiniMaxConfig(config: MiniMaxConfig): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(MINIMAX_CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function loadMiniMaxConfig(): Promise<MiniMaxConfig | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(MINIMAX_CONFIG_FILE, "utf-8");
    return JSON.parse(content) as MiniMaxConfig;
  } catch {
    return null;
  }
}

export async function saveCurrentMiniMaxModel(modelId: string): Promise<void> {
  const existing = await loadMiniMaxConfig();
  await saveMiniMaxConfig({
    authenticated: true,
    models: existing?.models || fallbackModels(),
    currentModel: modelId,
  });
}

function fallbackModels(): MiniMaxModel[] {
  return [
    {
      id: "MiniMax-M2.1",
      name: "MiniMax M2.1",
      input: ["text"],
      contextWindow: 200000,
      maxTokens: 8192,
    },
    {
      id: "MiniMax-M2.5",
      name: "MiniMax M2.5",
      input: ["text"],
      contextWindow: 200000,
      maxTokens: 8192,
    },
  ];
}

export async function getMiniMaxModels(_token?: MiniMaxToken): Promise<MiniMaxModel[]> {
  const config = await loadMiniMaxConfig();
  if (config?.models?.length) {
    return config.models;
  }

  const models = fallbackModels();
  await saveMiniMaxConfig({
    authenticated: true,
    models,
    currentModel: models[0].id,
  });
  return models;
}

export function resolveMiniMaxBaseUrl(token?: MiniMaxToken): string {
  return normalizeBaseUrl(token?.resourceUrl);
}
