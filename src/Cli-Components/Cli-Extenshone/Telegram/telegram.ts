#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

export type TelegramProviderId = "qwen" | "minimax" | "codex" | "antigravity" | "openrouter" | "kilo";

export type TelegramChatState = {
  provider?: TelegramProviderId;
  modelId?: string;
  updatedAt: number;
};

export type TelegramConfig = {
  authenticated: boolean;
  botToken?: string;
  botId?: number;
  botUsername?: string;
  botFirstName?: string;
  verifiedChatId?: number;
  verifiedUserId?: number;
  verifiedAt?: string;
  lastUpdateId?: number;
  chatStates: Record<string, TelegramChatState>;
};

export type TelegramGetMeResult = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date?: number;
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    from?: {
      id: number;
      is_bot?: boolean;
      first_name?: string;
      username?: string;
    };
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    voice?: TelegramVoice;
    video?: TelegramVideo;
    document?: TelegramDocument;
  };
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
};

export type TelegramVoice = {
  file_id: string;
  file_unique_id?: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
};

export type TelegramVideo = {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  duration?: number;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
  thumbnail?: TelegramPhotoSize;
  thumb?: TelegramPhotoSize;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  thumbnail?: TelegramPhotoSize;
  thumb?: TelegramPhotoSize;
};

export type TelegramFileInfo = {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path: string;
};

export type TelegramPollOptions = {
  offset?: number;
  timeout?: number;
  limit?: number;
};

const STORE_DIR = join(homedir(), ".hakathone", "store");
const TELEGRAM_CONFIG_FILE = join(STORE_DIR, "telegram-config.json");

function defaultTelegramConfig(): TelegramConfig {
  return {
    authenticated: false,
    chatStates: {},
  };
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

function normalizeConfig(raw?: Partial<TelegramConfig>): TelegramConfig {
  const chatStatesRaw = (raw?.chatStates || {}) as Record<string, TelegramChatState>;
  const chatStates: Record<string, TelegramChatState> = {};

  for (const [key, value] of Object.entries(chatStatesRaw)) {
    if (!key || !value) continue;
    chatStates[String(key)] = {
      provider: value.provider,
      modelId: value.modelId,
      updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : Date.now(),
    };
  }

  return {
    authenticated: Boolean(raw?.authenticated && raw?.botToken),
    botToken: raw?.botToken?.trim(),
    botId: typeof raw?.botId === "number" ? raw.botId : undefined,
    botUsername: raw?.botUsername?.trim(),
    botFirstName: raw?.botFirstName?.trim(),
    verifiedChatId: typeof raw?.verifiedChatId === "number" ? raw.verifiedChatId : undefined,
    verifiedUserId: typeof raw?.verifiedUserId === "number" ? raw.verifiedUserId : undefined,
    verifiedAt: raw?.verifiedAt,
    lastUpdateId: typeof raw?.lastUpdateId === "number" ? raw.lastUpdateId : undefined,
    chatStates,
  };
}

export async function loadTelegramConfig(): Promise<TelegramConfig> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(TELEGRAM_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as Partial<TelegramConfig>;
    const normalized = normalizeConfig(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveTelegramConfig(normalized);
    }
    return normalized;
  } catch {
    return defaultTelegramConfig();
  }
}

export async function saveTelegramConfig(config: TelegramConfig): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  const normalized = normalizeConfig(config);
  await fs.writeFile(TELEGRAM_CONFIG_FILE, JSON.stringify(normalized, null, 2), "utf-8");
}

export async function deleteTelegramConfig(): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    await fs.rm(TELEGRAM_CONFIG_FILE, { force: true });
  } catch {
    // ignore
  }
}

export async function isTelegramAuthenticated(): Promise<boolean> {
  const cfg = await loadTelegramConfig();
  return Boolean(cfg.authenticated && cfg.botToken && cfg.verifiedChatId);
}

function apiBase(token: string): string {
  return `https://api.telegram.org/bot${token}`;
}

function fileBase(token: string): string {
  return `https://api.telegram.org/file/bot${token}`;
}

async function telegramRequest<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${apiBase(token)}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { ok?: boolean; result?: T; description?: string };
  if (!data.ok || data.result === undefined) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }

  return data.result;
}

export async function verifyTelegramBotToken(token: string): Promise<TelegramGetMeResult> {
  return await telegramRequest<TelegramGetMeResult>(token.trim(), "getMe", {});
}

export async function telegramGetUpdates(token: string, options: TelegramPollOptions = {}): Promise<TelegramUpdate[]> {
  const payload: Record<string, unknown> = {
    timeout: options.timeout ?? 25,
    limit: options.limit ?? 50,
    allowed_updates: ["message"],
  };
  if (typeof options.offset === "number") {
    payload.offset = options.offset;
  }
  return await telegramRequest<TelegramUpdate[]>(token, "getUpdates", payload);
}

export async function telegramGetFileInfo(token: string, fileId: string): Promise<TelegramFileInfo> {
  return await telegramRequest<TelegramFileInfo>(token, "getFile", {
    file_id: fileId,
  });
}

export async function telegramDownloadFileBuffer(token: string, filePath: string): Promise<Buffer> {
  const response = await fetch(`${fileBase(token)}/${filePath}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function telegramDownloadFileById(token: string, fileId: string): Promise<{
  buffer: Buffer;
  fileInfo: TelegramFileInfo;
}> {
  const fileInfo = await telegramGetFileInfo(token, fileId);
  const buffer = await telegramDownloadFileBuffer(token, fileInfo.file_path);
  return {
    buffer,
    fileInfo,
  };
}

export async function telegramSendMessage(token: string, chatId: number, text: string): Promise<{ message_id: number }> {
  return await telegramRequest<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function telegramEditMessage(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  await telegramRequest(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  });
}

export async function telegramDeleteMessage(token: string, chatId: number, messageId: number): Promise<void> {
  await telegramRequest(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

export async function telegramSendTyping(token: string, chatId: number): Promise<void> {
  await telegramRequest(token, "sendChatAction", {
    chat_id: chatId,
    action: "typing",
  });
}

function randomVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function createTelegramVerificationCode(): string {
  return randomVerificationCode();
}

export async function pollTelegramVerificationCode(params: {
  token: string;
  code: string;
  timeoutMs?: number;
  startOffset?: number;
  onProgress?: (message: string) => void;
}): Promise<{ chatId: number; userId?: number; nextOffset: number } | null> {
  const token = params.token.trim();
  const timeoutMs = params.timeoutMs ?? 120000;
  const startedAt = Date.now();
  let offset = params.startOffset;

  while (Date.now() - startedAt < timeoutMs) {
    params.onProgress?.("Waiting for verification message in Telegram...");
    const updates = await telegramGetUpdates(token, {
      offset,
      timeout: 20,
      limit: 50,
    });

    if (!updates.length) {
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      const messageText = update.message?.text?.trim() || "";
      const normalized = messageText.replace(/^\//, "").toLowerCase();
      const codeLower = params.code.toLowerCase();

      const matched =
        messageText === params.code ||
        normalized === `verify ${codeLower}` ||
        normalized.endsWith(` ${codeLower}`) ||
        normalized === codeLower;

      if (!matched) {
        continue;
      }

      const chatId = update.message?.chat?.id;
      if (typeof chatId !== "number") {
        continue;
      }

      return {
        chatId,
        userId: update.message?.from?.id,
        nextOffset: offset,
      };
    }
  }

  return null;
}

export async function saveTelegramAuth(params: {
  token: string;
  me: TelegramGetMeResult;
  verifiedChatId: number;
  verifiedUserId?: number;
  lastUpdateId?: number;
}): Promise<TelegramConfig> {
  const existing = await loadTelegramConfig();
  const next: TelegramConfig = {
    ...existing,
    authenticated: true,
    botToken: params.token.trim(),
    botId: params.me.id,
    botUsername: params.me.username,
    botFirstName: params.me.first_name,
    verifiedChatId: params.verifiedChatId,
    verifiedUserId: params.verifiedUserId,
    verifiedAt: new Date().toISOString(),
    lastUpdateId: params.lastUpdateId ?? existing.lastUpdateId,
    chatStates: existing.chatStates || {},
  };
  await saveTelegramConfig(next);
  return next;
}

export async function setTelegramChatState(
  chatId: number,
  nextState: { provider?: TelegramProviderId; modelId?: string },
): Promise<TelegramConfig> {
  const config = await loadTelegramConfig();
  const key = String(chatId);
  config.chatStates[key] = {
    provider: nextState.provider,
    modelId: nextState.modelId,
    updatedAt: Date.now(),
  };
  await saveTelegramConfig(config);
  return config;
}

export async function clearTelegramChatState(chatId: number): Promise<TelegramConfig> {
  const config = await loadTelegramConfig();
  delete config.chatStates[String(chatId)];
  await saveTelegramConfig(config);
  return config;
}

export async function updateTelegramLastUpdateId(lastUpdateId: number): Promise<void> {
  const config = await loadTelegramConfig();
  config.lastUpdateId = lastUpdateId;
  await saveTelegramConfig(config);
}

export function getTelegramChatState(config: TelegramConfig, chatId: number): TelegramChatState {
  return config.chatStates[String(chatId)] || { updatedAt: 0 };
}

export function splitTelegramMessage(text: string, chunkSize = 3900): string[] {
  const clean = (text || "").trim();
  if (!clean) {
    return ["No response."];
  }

  const chunks: string[] = [];
  let rest = clean;

  while (rest.length > chunkSize) {
    let cut = rest.lastIndexOf("\n", chunkSize);
    if (cut < chunkSize * 0.5) {
      cut = rest.lastIndexOf(" ", chunkSize);
    }
    if (cut < chunkSize * 0.5) {
      cut = chunkSize;
    }

    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest.length > 0) {
    chunks.push(rest);
  }

  return chunks.length ? chunks : ["No response."];
}
