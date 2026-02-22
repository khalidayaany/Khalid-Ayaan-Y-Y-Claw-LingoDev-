#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { deleteQwenToken } from "../Cli-Extenshone/Qwen/qwen.js";
import { deleteMiniMaxToken } from "../Cli-Extenshone/Minimax/minimax.js";
import { deleteCodexToken } from "../Cli-Extenshone/Codex/codex.js";
import { deleteAntigravityToken } from "../Cli-Extenshone/Antigravity/antigravity.js";
import { deleteOpenRouterToken } from "../Cli-Extenshone/Openrouter/openrouter.js";
import { deleteKiloToken } from "../Cli-Extenshone/Kilo/kilo.js";
import {
  isMemoryIntentPrompt,
  resolveChiferMemoryContext,
  type ChiferActivityHandler,
} from "../Cli-Tools/Chifer-MCP/index.js";

const orange = "\x1b[38;2;249;115;22m";
const cyan = "\x1b[38;2;34;211;238m";
const green = "\x1b[38;2;34;197;94m";
const gray = "\x1b[90m";
const white = "\x1b[38;2;229;231;235m";
const red = "\x1b[38;2;239;68;68m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";

const MODULE_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PROJECT_MEMORY_ROOT = resolve(MODULE_DIR, "..", "Cli-Memory");
export const CHAT_MEMORY_DIR = join(PROJECT_MEMORY_ROOT, "Chat-Memory");
export const AGENT_MEMORY_DIR = join(PROJECT_MEMORY_ROOT, "Agent-Memory");
export const AI_MEMORY_DIR = join(PROJECT_MEMORY_ROOT, "Ai-Memory");

const STORE_DIR = join(homedir(), ".hakathone", "store");
const MEMORY_STATE_FILE = join(STORE_DIR, "memory-state.json");
const AI_ROUTER_FILE = join(STORE_DIR, "ai-router.json");

const STORE_FILES_TO_REMOVE = [
  "qwen-token.json",
  "qwen-config.json",
  "minimax-token.json",
  "minimax-config.json",
  "codex-token.json",
  "codex-config.json",
  "antigravity-token.json",
  "antigravity-config.json",
  "openrouter-token.json",
  "openrouter-config.json",
  "kilo-token.json",
  "kilo-config.json",
  "ai-router.json",
  "memory-state.json",
];

const CODEX_HOME = join(homedir(), ".codex");
const CODEX_AUTH_FILE = join(CODEX_HOME, "auth.json");
const CODEX_MODELS_CACHE_FILE = join(CODEX_HOME, "models_cache.json");

type MenuItem<T extends string | number> = {
  key: T;
  label: string;
  description: string;
};

type MemoryState = {
  activeChatSessionFile?: string;
  activeChatSessionName?: string;
  cipherMcpEnabled?: boolean;
};

type ChatSessionMeta = {
  fileName: string;
  filePath: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type AiMemoryMeta = {
  fileName: string;
  filePath: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

let memoryDirsReady = false;

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeName(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function toTitleFromFile(fileName: string): string {
  return fileName
    .replace(/\.md$/i, "")
    .split("-")
    .filter(Boolean)
    .slice(1)
    .join(" ") || fileName.replace(/\.md$/i, "");
}

function trimToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(text.length - maxChars);
}

function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  );
}

function isSessionRecallPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return [
    "previous",
    "earlier",
    "before",
    "continue",
    "resume",
    "last",
    "again",
    "session",
    "chat history",
    "ag er",
    "age",
    "abar",
    "continue",
    "mone",
    "mone ase",
    "mone ache",
    "agerta",
    "ager ta",
    "last chat",
    "previous chat",
    "ki bolechilam",
    "ki bollam",
    "what did i say",
  ].some((keyword) => lower.includes(keyword));
}

function isBriefGreetingPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase().trim().replace(/\s+/g, " ");
  if (!normalized) return true;
  if (normalized.length > 36) return false;

  const greetingPhrases = [
    "hi",
    "hello",
    "hey",
    "yo",
    "sup",
    "hola",
    "hi there",
    "hello there",
    "kire",
    "assalamu alaikum",
    "salam",
    "ok",
    "okay",
    "hmm",
    "?",
  ];
  return greetingPhrases.includes(normalized);
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function ensureMemoryDirectories(): Promise<void> {
  if (memoryDirsReady) {
    return;
  }

  const fs = await import("node:fs/promises");
  await fs.mkdir(CHAT_MEMORY_DIR, { recursive: true });
  await fs.mkdir(AGENT_MEMORY_DIR, { recursive: true });
  await fs.mkdir(AI_MEMORY_DIR, { recursive: true });

  const agentGuide = join(AGENT_MEMORY_DIR, "README.md");
  try {
    await fs.access(agentGuide);
  } catch {
    await fs.writeFile(
      agentGuide,
      "# Agent Memory\n\nStore agent rules, role policies, and long-term operating notes here.\n",
      "utf-8",
    );
  }

  memoryDirsReady = true;
}

async function loadMemoryState(): Promise<MemoryState> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  try {
    const raw = await fs.readFile(MEMORY_STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as MemoryState;
    return {
      activeChatSessionFile: parsed.activeChatSessionFile,
      activeChatSessionName: parsed.activeChatSessionName,
      cipherMcpEnabled: parsed.cipherMcpEnabled !== false,
    };
  } catch {
    return { cipherMcpEnabled: true };
  }
}

async function saveMemoryState(state: MemoryState): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  await fs.writeFile(
    MEMORY_STATE_FILE,
    JSON.stringify(
      {
        activeChatSessionFile: state.activeChatSessionFile,
        activeChatSessionName: state.activeChatSessionName,
        cipherMcpEnabled: state.cipherMcpEnabled !== false,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

export async function isChiferMcpEnabled(): Promise<boolean> {
  const state = await loadMemoryState();
  return state.cipherMcpEnabled !== false;
}

export async function setChiferMcpEnabled(enabled: boolean): Promise<void> {
  const state = await loadMemoryState();
  state.cipherMcpEnabled = enabled;
  await saveMemoryState(state);
}

async function clearActiveChatSessionState(): Promise<void> {
  const state = await loadMemoryState();
  delete state.activeChatSessionFile;
  delete state.activeChatSessionName;
  await saveMemoryState(state);
}

async function clearDirectoryContents(dirPath: string, keepReadme = false): Promise<void> {
  const fs = await import("node:fs/promises");
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (keepReadme && entry.isFile() && entry.name.toLowerCase() === "readme.md") {
        continue;
      }
      await fs.rm(join(dirPath, entry.name), { recursive: true, force: true });
    }
  } catch {
    // Directory may not exist yet.
  }
}

async function pause(message = "Press any key to continue..."): Promise<void> {
  console.log(`${white}${message}${reset}`);
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
    let selectedIndex = 0;
    let renderedLines = 0;

    const render = () => {
      const lines: string[] = [];
      lines.push(`${bold}${title}:${reset} ${gray}(${hint})${reset}`);
      lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const active = selectedIndex === index;
        const icon = active ? `${orange}▶${reset}` : " ";
        const color = active ? orange : white;
        lines.push(`  ${icon} ${color}${item.label.padEnd(16)}${reset} ${gray}│${reset} ${item.description}`);
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
      } else if (char === "\r" || char === "\n") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(items[selectedIndex].key);
      } else if (char === "\u0003") {
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

async function readLine(question: string): Promise<string> {
  process.stdin.setRawMode?.(false);
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function readMultiline(promptLabel: string): Promise<string> {
  process.stdin.setRawMode?.(false);
  const rl = createInterface({ input, output });
  const lines: string[] = [];
  console.log(`${gray}${promptLabel}${reset}`);
  console.log(`${gray}Submit an empty line to save.${reset}`);

  try {
    while (true) {
      const line = await rl.question(lines.length === 0 ? `${white}> ${reset}` : `${white}… ${reset}`);
      if (!line.trim()) {
        if (lines.length === 0) {
          continue;
        }
        break;
      }
      lines.push(line);
    }
  } finally {
    rl.close();
  }

  return lines.join("\n").trim();
}

async function listMarkdownFiles(dirPath: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => entry.name);

    const filesWithTime = await Promise.all(
      files.map(async (fileName) => {
        const stat = await fs.stat(join(dirPath, fileName));
        return { fileName, mtimeMs: stat.mtimeMs };
      }),
    );

    filesWithTime.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return filesWithTime.map((item) => item.fileName);
  } catch {
    return [];
  }
}

function parseSessionName(fileContent: string, fallbackName: string): string {
  const line = fileContent
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.startsWith("# Chat Session:"));

  if (!line) return fallbackName;
  const parsed = line.replace("# Chat Session:", "").trim();
  return parsed || fallbackName;
}

function parseMemoryTitle(fileContent: string, fallbackName: string): string {
  const line = fileContent
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.startsWith("# Memory:"));

  if (!line) return fallbackName;
  const parsed = line.replace("# Memory:", "").trim();
  return parsed || fallbackName;
}

async function listChatSessions(): Promise<ChatSessionMeta[]> {
  const fs = await import("node:fs/promises");
  const files = await listMarkdownFiles(CHAT_MEMORY_DIR);

  const sessions = await Promise.all(
    files.map(async (fileName) => {
      const filePath = join(CHAT_MEMORY_DIR, fileName);
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf-8");
      const fallbackName = toTitleFromFile(fileName);
      return {
        fileName,
        filePath,
        name: parseSessionName(content, fallbackName),
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      } satisfies ChatSessionMeta;
    }),
  );

  return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function listAiMemories(): Promise<AiMemoryMeta[]> {
  const fs = await import("node:fs/promises");
  const files = await listMarkdownFiles(AI_MEMORY_DIR);

  const memories = await Promise.all(
    files.map(async (fileName) => {
      const filePath = join(AI_MEMORY_DIR, fileName);
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf-8");
      const fallbackName = toTitleFromFile(fileName);
      return {
        fileName,
        filePath,
        title: parseMemoryTitle(content, fallbackName),
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      } satisfies AiMemoryMeta;
    }),
  );

  return memories.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function buildSessionFileName(name: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = sanitizeName(name, "chat-session");
  return `${timestamp}-${slug}.md`;
}

function buildMemoryFileName(name: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = sanitizeName(name, "memory");
  return `${timestamp}-${slug}.md`;
}

async function createChatSession(name: string, importedChat?: string): Promise<ChatSessionMeta> {
  const fs = await import("node:fs/promises");
  await ensureMemoryDirectories();

  const safeName = name.trim() || "New Chat Session";
  const fileName = buildSessionFileName(safeName);
  const filePath = join(CHAT_MEMORY_DIR, fileName);
  const createdAt = nowIso();

  const bodyLines: string[] = [
    `# Chat Session: ${safeName}`,
    "",
    `- Session ID: ${randomUUID()}`,
    `- Created: ${createdAt}`,
    "",
    "## Conversation",
  ];

  if (importedChat && importedChat.trim()) {
    bodyLines.push("", "### Imported Context", importedChat.trim());
  }

  await fs.writeFile(filePath, `${bodyLines.join("\n")}\n`, "utf-8");

  return {
    fileName,
    filePath,
    name: safeName,
    createdAt,
    updatedAt: createdAt,
  };
}

async function setActiveChatSession(fileName: string, sessionName: string): Promise<void> {
  const state = await loadMemoryState();
  state.activeChatSessionFile = fileName;
  state.activeChatSessionName = sessionName;
  await saveMemoryState(state);
}

async function ensureActiveChatSession(): Promise<ChatSessionMeta> {
  await ensureMemoryDirectories();
  const fs = await import("node:fs/promises");
  const state = await loadMemoryState();

  if (state.activeChatSessionFile) {
    const filePath = join(CHAT_MEMORY_DIR, state.activeChatSessionFile);
    try {
      await fs.access(filePath);
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, "utf-8");
      const fallbackName = state.activeChatSessionName || toTitleFromFile(state.activeChatSessionFile);
      return {
        fileName: state.activeChatSessionFile,
        filePath,
        name: parseSessionName(content, fallbackName),
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      };
    } catch {
      // fall through to create a new session
    }
  }

  const created = await createChatSession(`Session ${new Date().toLocaleString("en-US")}`);
  await setActiveChatSession(created.fileName, created.name);
  return created;
}

async function resolveActiveSessionFilePathFast(): Promise<string> {
  const fs = await import("node:fs/promises");
  const state = await loadMemoryState();

  if (state.activeChatSessionFile) {
    const filePath = join(CHAT_MEMORY_DIR, state.activeChatSessionFile);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // Continue to create/recover session
    }
  }

  const active = await ensureActiveChatSession();
  return active.filePath;
}

async function readFileTail(filePath: string, maxChars: number): Promise<string> {
  const fs = await import("node:fs/promises");
  try {
    const stat = await fs.stat(filePath);
    if (stat.size <= 0) return "";

    const bytesToRead = Math.min(stat.size, Math.max(512, maxChars * 4));
    const position = Math.max(0, stat.size - bytesToRead);
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, position);
      return buffer.toString("utf-8").trim();
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

export async function startNewRuntimeChatSession(): Promise<void> {
  await ensureMemoryDirectories();
  const created = await createChatSession(`Session ${new Date().toLocaleString("en-US")}`);
  await setActiveChatSession(created.fileName, created.name);
}

async function readAiMemoryContent(meta: AiMemoryMeta): Promise<string> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(meta.filePath, "utf-8");
  return raw.trim();
}

async function buildRelevantAiMemoryContext(userPrompt: string): Promise<string> {
  const memories = await listAiMemories();
  if (!memories.length) {
    return "";
  }

  const fs = await import("node:fs/promises");
  const keywords = extractKeywords(userPrompt);
  const ranked = await Promise.all(
    memories.map(async (meta) => {
      const content = await fs.readFile(meta.filePath, "utf-8");
      const lowered = content.toLowerCase();
      const keywordMatches = keywords.reduce((acc, key) => (lowered.includes(key) ? acc + 1 : acc), 0);
      const recencyBoost = Math.max(0, 10000000000000 - new Date(meta.updatedAt).getTime()) / 10000000000000;
      return {
        meta,
        content,
        score: keywordMatches * 5 + recencyBoost,
      };
    }),
  );

  ranked.sort((a, b) => b.score - a.score);
  const selected = ranked.slice(0, 5);

  const lines: string[] = ["## Saved AI Memory"]; 
  for (const item of selected) {
    const excerpt = trimToMaxChars(item.content.replace(/\n{3,}/g, "\n\n"), 1200);
    lines.push(`- ${item.meta.title}:`);
    lines.push(excerpt);
    lines.push("");
  }

  return lines.join("\n").trim();
}

async function buildAgentMemoryContext(): Promise<string> {
  const files = (await listMarkdownFiles(AGENT_MEMORY_DIR)).filter((fileName) => fileName !== "README.md");
  if (!files.length) {
    return "";
  }

  const fs = await import("node:fs/promises");
  const lines: string[] = ["## Agent Memory Rules"];
  for (const fileName of files.slice(0, 3)) {
    const content = await fs.readFile(join(AGENT_MEMORY_DIR, fileName), "utf-8");
    const excerpt = trimToMaxChars(content.trim(), 800);
    lines.push(`- ${toTitleFromFile(fileName)}:`);
    lines.push(excerpt);
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function buildActiveSessionContext(maxChars = 2600): Promise<string> {
  const active = await ensureActiveChatSession();
  const rawTail = await readFileTail(active.filePath, maxChars);
  const relevant = trimToMaxChars(rawTail, maxChars).trim();
  if (!relevant) return "";
  return ["## Active Chat Session", `- Session: ${active.name}`, "", relevant].join("\n\n");
}

export async function buildMessageWithMemoryContext(
  userMessage: string,
  onActivity?: ChiferActivityHandler,
  options?: {
    forceSessionCarryover?: boolean;
  },
): Promise<string> {
  await ensureMemoryDirectories();
  const memoryIntent = isMemoryIntentPrompt(userMessage);
  const sessionIntent = isSessionRecallPrompt(userMessage);
  const briefGreeting = isBriefGreetingPrompt(userMessage);
  const forceSessionCarryover = options?.forceSessionCarryover === true;

  if (!memoryIntent && !sessionIntent) {
    if (briefGreeting && !forceSessionCarryover) {
      onActivity?.("Memory: skipped (brief prompt)");
      return userMessage;
    }
    onActivity?.(
      forceSessionCarryover ? "Memory: ship-faster carryover loading" : "Memory: loading recent session",
    );
    const sessionMemory = await buildActiveSessionContext(forceSessionCarryover ? 4200 : 3200);
    if (!sessionMemory) {
      onActivity?.("Memory: skipped (no recent session)");
      return userMessage;
    }
    onActivity?.(
      forceSessionCarryover ? "Memory: ship-faster carryover attached" : "Memory: recent session attached",
    );
    const maxContextChars = forceSessionCarryover ? 2600 : 1800;
    const carryoverHeader = forceSessionCarryover
      ? "Ship-Faster carryover is active. Continue unfinished tasks from recent chat when relevant."
      : "Use the recent chat context only if relevant.";
    return [
      carryoverHeader,
      "",
      trimToMaxChars(sessionMemory, maxContextChars),
      "",
      "## Current User Message",
      userMessage,
    ].join("\n");
  }

  onActivity?.("Memory: scanning local files");

  const localSections: string[] = [];

  if (memoryIntent) {
    const aiMemory = await buildRelevantAiMemoryContext(userMessage);
    if (aiMemory) {
      localSections.push(aiMemory);
    }
  }

  if (memoryIntent) {
    const agentMemory = await buildAgentMemoryContext();
    if (agentMemory) {
      localSections.push(agentMemory);
    }
  }

  if (memoryIntent || sessionIntent) {
    const sessionMemory = await buildActiveSessionContext();
    if (sessionMemory) {
      localSections.push(sessionMemory);
    }
  }

  if (!localSections.length) {
    onActivity?.("Memory: no saved context found");
    return userMessage;
  }

  const localContext = trimToMaxChars(localSections.join("\n\n"), 9000);
  const state = await loadMemoryState();
  const resolved = state.cipherMcpEnabled === false
    ? { context: localContext, usedCipher: false, mode: "local-fast", reason: "disabled_in_state" }
    : await resolveChiferMemoryContext(userMessage, localContext, onActivity);
  const mergedContext = trimToMaxChars(resolved.context || localContext, 9000);
  onActivity?.(
    resolved.usedCipher ? "Memory: context attached" : "Memory: local fast context attached",
  );

  return [
    "Use the following long-term local memory only when it is relevant.",
    "",
    mergedContext,
    "",
    "## Current User Message",
    userMessage,
  ].join("\n");
}

export async function saveChatTurn(
  userMessage: string,
  assistantMessage: string,
  provider: string,
  modelName: string,
): Promise<void> {
  const fs = await import("node:fs/promises");
  const activeFilePath = await resolveActiveSessionFilePathFast();
  const timestamp = nowIso();

  const entry = [
    "",
    `### User @ ${timestamp}`,
    userMessage.trim(),
    "",
    `### ${modelName} (${provider}) @ ${timestamp}`,
    assistantMessage.trim(),
    "",
  ].join("\n");

  await fs.appendFile(activeFilePath, entry, "utf-8");
}

async function addMemoryFlow(): Promise<boolean> {
  await ensureMemoryDirectories();
  const titleInput = await readLine(`${white}Memory title:${reset} `);
  const content = await readMultiline("Paste memory content");
  if (!content) {
    console.log(`${red}No memory content provided.${reset}`);
    console.log("");
    await pause();
    return false;
  }

  const title = titleInput || `Memory ${new Date().toLocaleString("en-US")}`;
  const fileName = buildMemoryFileName(title);
  const filePath = join(AI_MEMORY_DIR, fileName);

  const fs = await import("node:fs/promises");
  const payload = [
    `# Memory: ${title}`,
    "",
    `- Created: ${nowIso()}`,
    "",
    "## Details",
    content,
    "",
  ].join("\n");

  await fs.writeFile(filePath, payload, "utf-8");
  console.log(`${green}✓ Memory saved:${reset} ${cyan}${fileName}${reset}`);
  console.log("");
  await pause();
  return true;
}

async function viewMemoryFlow(): Promise<boolean> {
  const memories = await listAiMemories();
  if (!memories.length) {
    console.log(`${gray}No memories saved yet.${reset}`);
    console.log("");
    await pause();
    return false;
  }

  const choice = await showMenu(
    "View Memory",
    [
      ...memories.map((memory, index) => ({
        key: `memory:${index}`,
        label: memory.title.slice(0, 16),
        description: `${new Date(memory.updatedAt).toLocaleString("en-US")}`,
      })),
      { key: "back", label: "Back", description: "Go back" },
    ],
  );

  if (choice === "back") {
    return false;
  }

  const picked = memories[Number(choice.replace("memory:", ""))];
  if (!picked) {
    return false;
  }

  const content = await readAiMemoryContent(picked);
  console.log(`${bold}${picked.title}${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log(content);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log("");
  await pause();
  return true;
}

async function deleteMemoryFlow(): Promise<boolean> {
  const action = await showMenu("Delete Memory", [
    { key: "single", label: "Delete One", description: "Delete a selected memory" },
    { key: "all", label: "Delete All", description: "Delete all saved memories" },
    { key: "back", label: "Back", description: "Go back" },
  ]);

  if (action === "back") {
    return false;
  }

  const fs = await import("node:fs/promises");
  if (action === "all") {
    const confirm = await showMenu("Delete All Memories", [
      { key: "confirm", label: "Delete All", description: "Remove every memory file" },
      { key: "cancel", label: "Cancel", description: "Keep current memories" },
    ]);

    if (confirm !== "confirm") {
      return false;
    }

    await clearDirectoryContents(AI_MEMORY_DIR);
    console.log(`${green}✓ All memories deleted.${reset}`);
    console.log("");
    await pause();
    return true;
  }

  const memories = await listAiMemories();
  if (!memories.length) {
    console.log(`${gray}No memories available for deletion.${reset}`);
    console.log("");
    await pause();
    return false;
  }

  const choice = await showMenu(
    "Delete One Memory",
    [
      ...memories.map((memory, index) => ({
        key: `memory:${index}`,
        label: memory.title.slice(0, 16),
        description: `${new Date(memory.updatedAt).toLocaleString("en-US")}`,
      })),
      { key: "back", label: "Back", description: "Go back" },
    ],
  );

  if (choice === "back") {
    return false;
  }

  const target = memories[Number(choice.replace("memory:", ""))];
  if (!target) {
    return false;
  }

  await fs.rm(target.filePath, { force: true });
  console.log(`${green}✓ Deleted memory:${reset} ${white}${target.title}${reset}`);
  console.log("");
  await pause();
  return true;
}

async function addChatSessionFlow(): Promise<boolean> {
  const nameInput = await readLine(`${white}Chat session name:${reset} `);
  const chatBody = await readMultiline("Paste chat content");

  if (!chatBody) {
    console.log(`${red}No chat content provided.${reset}`);
    console.log("");
    await pause();
    return false;
  }

  const sessionName = nameInput || `Imported Chat ${new Date().toLocaleString("en-US")}`;
  const created = await createChatSession(sessionName, chatBody);
  await setActiveChatSession(created.fileName, created.name);

  console.log(`${green}✓ Chat session saved and activated:${reset} ${cyan}${created.name}${reset}`);
  console.log("");
  await pause();
  return true;
}

async function viewChatSessionFlow(): Promise<boolean> {
  const sessions = await listChatSessions();
  if (!sessions.length) {
    console.log(`${gray}No chat sessions found.${reset}`);
    console.log("");
    await pause();
    return false;
  }

  const choice = await showMenu(
    "View Chat Session",
    [
      ...sessions.map((session, index) => ({
        key: `session:${index}`,
        label: session.name.slice(0, 16),
        description: `${new Date(session.updatedAt).toLocaleString("en-US")}`,
      })),
      { key: "back", label: "Back", description: "Go back" },
    ],
  );

  if (choice === "back") {
    return false;
  }

  const selected = sessions[Number(choice.replace("session:", ""))];
  if (!selected) {
    return false;
  }

  await setActiveChatSession(selected.fileName, selected.name);
  console.log(`${green}✓ Active chat session:${reset} ${cyan}${selected.name}${reset}`);
  const preview = trimToMaxChars(await readFileTail(selected.filePath, 2200), 2200).trim();
  if (preview) {
    console.log(`${gray}Loaded preview:${reset}`);
    console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
    console.log(preview);
    console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  }
  console.log(`${gray}You can continue from this exact session in main prompt.${reset}`);
  console.log("");
  await pause();
  return true;
}

async function deleteChatSessionFlow(): Promise<boolean> {
  const action = await showMenu("Delete Chat Session", [
    { key: "single", label: "Delete One", description: "Delete one session" },
    { key: "all", label: "Delete All", description: "Delete all chat sessions" },
    { key: "back", label: "Back", description: "Go back" },
  ]);

  if (action === "back") {
    return false;
  }

  const fs = await import("node:fs/promises");
  if (action === "all") {
    const confirm = await showMenu("Delete All Chat Sessions", [
      { key: "confirm", label: "Delete All", description: "Remove every chat session" },
      { key: "cancel", label: "Cancel", description: "Keep sessions" },
    ]);

    if (confirm !== "confirm") {
      return false;
    }

    await clearDirectoryContents(CHAT_MEMORY_DIR);
    await clearActiveChatSessionState();
    console.log(`${green}✓ All chat sessions deleted.${reset}`);
    console.log("");
    await pause();
    return true;
  }

  const sessions = await listChatSessions();
  if (!sessions.length) {
    console.log(`${gray}No chat sessions available.${reset}`);
    console.log("");
    await pause();
    return false;
  }

  const choice = await showMenu(
    "Delete One Chat Session",
    [
      ...sessions.map((session, index) => ({
        key: `session:${index}`,
        label: session.name.slice(0, 16),
        description: `${new Date(session.updatedAt).toLocaleString("en-US")}`,
      })),
      { key: "back", label: "Back", description: "Go back" },
    ],
  );

  if (choice === "back") {
    return false;
  }

  const target = sessions[Number(choice.replace("session:", ""))];
  if (!target) {
    return false;
  }

  await fs.rm(target.filePath, { force: true });
  const state = await loadMemoryState();
  if (state.activeChatSessionFile === target.fileName) {
    await clearActiveChatSessionState();
  }

  console.log(`${green}✓ Deleted chat session:${reset} ${white}${target.name}${reset}`);
  console.log("");
  await pause();
  return true;
}

async function resetAllData(): Promise<void> {
  const fs = await import("node:fs/promises");

  await Promise.all([
    deleteQwenToken(),
    deleteMiniMaxToken(),
    deleteCodexToken(),
    deleteAntigravityToken(),
    deleteOpenRouterToken(),
    deleteKiloToken(),
  ]);

  for (const fileName of STORE_FILES_TO_REMOVE) {
    await fs.rm(join(STORE_DIR, fileName), { force: true }).catch(() => undefined);
  }

  await fs.rm(CODEX_AUTH_FILE, { force: true }).catch(() => undefined);
  await fs.rm(CODEX_MODELS_CACHE_FILE, { force: true }).catch(() => undefined);
  await fs.rm(AI_ROUTER_FILE, { force: true }).catch(() => undefined);

  await clearDirectoryContents(CHAT_MEMORY_DIR);
  await clearDirectoryContents(AGENT_MEMORY_DIR, true);
  await clearDirectoryContents(AI_MEMORY_DIR);
  await clearActiveChatSessionState();

  await ensureMemoryDirectories();
}

export async function runMemoryMenu(): Promise<boolean> {
  await ensureMemoryDirectories();
  while (true) {
    const choice = await showMenu("Memory", [
      { key: 1, label: "Add Memory", description: "Save new AI memory" },
      { key: 2, label: "View Memory", description: "Show saved memories" },
      { key: 3, label: "Delete Memory", description: "Delete one/all memories" },
      { key: 0, label: "Back", description: "Go back" },
    ]);

    if (choice === 0) return false;
    if (choice === 1) return await addMemoryFlow();
    if (choice === 2) return await viewMemoryFlow();
    if (choice === 3) return await deleteMemoryFlow();
  }
}

export async function runChatSessionMenu(): Promise<boolean> {
  await ensureMemoryDirectories();
  while (true) {
    const choice = await showMenu("Chat Session", [
      { key: 1, label: "Add Chat", description: "Save a chat session" },
      { key: 2, label: "View Chat", description: "Open and continue a saved chat" },
      { key: 3, label: "Delete Chat Session", description: "Delete one/all chat sessions" },
      { key: 0, label: "Back", description: "Go back" },
    ]);

    if (choice === 0) return false;
    if (choice === 1) return await addChatSessionFlow();
    if (choice === 2) return await viewChatSessionFlow();
    if (choice === 3) return await deleteChatSessionFlow();
  }
}

export async function runResetMenu(): Promise<boolean> {
  const choice = await showMenu("Reset", [
    { key: "reset", label: "Reset", description: "Reset auth, memory, router, and chat state" },
    { key: "cancel", label: "Cancel", description: "Keep current setup" },
  ]);

  if (choice !== "reset") {
    return false;
  }

  console.log(`${gray}Resetting all CLI data...${reset}`);
  await resetAllData();
  console.log(`${green}✓ Full reset complete. CLI is now clean.${reset}`);
  console.log("");
  await pause();
  return true;
}

export async function runAgentMemoryMenu(): Promise<boolean> {
  await ensureMemoryDirectories();
  const files = await listMarkdownFiles(AGENT_MEMORY_DIR);
  console.log(`${gray}Agent Memory is ready for rule files.${reset}`);
  console.log(`${gray}Folder:${reset} ${white}${AGENT_MEMORY_DIR}${reset}`);
  if (files.length > 0) {
    console.log(`${gray}Found ${files.length} rule file(s).${reset}`);
  }
  console.log("");
  await pause();
  return false;
}

export async function getActiveChatSessionLabel(): Promise<string> {
  const active = await ensureActiveChatSession();
  return active.name;
}
