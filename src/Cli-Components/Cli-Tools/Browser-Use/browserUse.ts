#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";
import { runShellCommand } from "../../Cli-Shell/runner.js";

export const BROWSER_USE_HOME = join(homedir(), ".hakathone", "browser-use");

export type BrowserUseSetupResult = {
  success: boolean;
  summary: string;
  details: string[];
};

export type BrowserUseCommandIntent = {
  command: string;
  summary: string;
  rawArgs: string;
  subcommand: string;
  requiresLlm: boolean;
  browserMode: "default" | "chromium" | "real" | "remote";
  modeExplicit: boolean;
  headed: boolean;
  liveUi: boolean;
  tabHistoryReport: boolean;
  profileName?: string;
  sessionName?: string;
};

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function isBrowserUseSetupIntent(message: string): boolean {
  const lower = message.toLowerCase();
  const mentionsBrowserUse = hasAny(lower, ["browser-use", "browser use", "chrome browser", "google chrome"]);
  const setupAction = hasAny(lower, ["install", "setup", "set up", "configure", "config", "add feature", "feature add"]);
  return mentionsBrowserUse && setupAction;
}

function detectBrowserMode(rawArgs: string): BrowserUseCommandIntent["browserMode"] {
  const match = rawArgs.match(/(?:^|\s)--browser\s+(chromium|real|remote)(?=\s|$)/i);
  if (!match?.[1]) return "default";
  const mode = match[1].toLowerCase();
  if (mode === "chromium" || mode === "real" || mode === "remote") {
    return mode;
  }
  return "default";
}

function hasFlag(rawArgs: string, flag: string): boolean {
  const pattern = new RegExp(`(^|\\s)--${flag}(?=\\s|$)`, "i");
  return pattern.test(rawArgs);
}

function stripKnownTopLevelFlags(rawArgs: string): {
  commandArgs: string;
  browserMode: BrowserUseCommandIntent["browserMode"];
  modeExplicit: boolean;
  headed: boolean;
  profileName?: string;
  sessionName?: string;
} {
  const browserMode = detectBrowserMode(rawArgs);
  const modeExplicit = /(?:^|\s)--browser\s+(chromium|real|remote)(?=\s|$)/i.test(rawArgs);
  const headed = hasFlag(rawArgs, "headed");
  const profileMatch = rawArgs.match(/(?:^|\s)--profile\s+("([^"]+)"|'([^']+)'|([^\s]+))/i);
  const profileName = profileMatch
    ? (profileMatch[2] || profileMatch[3] || profileMatch[4] || "").trim()
    : undefined;
  const sessionMatch = rawArgs.match(/(?:^|\s)--session\s+("([^"]+)"|'([^']+)'|([^\s]+))/i);
  const sessionName = sessionMatch
    ? (sessionMatch[2] || sessionMatch[3] || sessionMatch[4] || "").trim()
    : undefined;

  const cleaned = rawArgs
    .replace(/(^|\s)--browser\s+(chromium|real|remote)(?=\s|$)/gi, " ")
    .replace(/(^|\s)--headed(?=\s|$)/gi, " ")
    .replace(/(^|\s)--profile\s+("([^"]+)"|'([^']+)'|([^\s]+))(?=\s|$)/gi, " ")
    .replace(/(^|\s)--session\s+("([^"]+)"|'([^']+)'|([^\s]+))(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    commandArgs: cleaned,
    browserMode,
    modeExplicit,
    headed,
    profileName,
    sessionName,
  };
}

function ensureLiveMode(rawArgs: string): string {
  let next = rawArgs.trim();
  if (!next) {
    next = "open https://www.google.com";
  }
  if (!/(^|\s)--browser\s+(chromium|real|remote)(?=\s|$)/i.test(next)) {
    next = `${next} --browser real`;
  }
  if (!hasFlag(next, "headed")) {
    next = `${next} --headed`;
  }
  return next.trim();
}

function buildBrowserIntent(rawArgs: string): BrowserUseCommandIntent | null {
  const raw = rawArgs.trim();
  if (!raw) return null;
  const normalized = stripKnownTopLevelFlags(raw);
  const commandArgs = normalized.commandArgs;
  if (!commandArgs) return null;

  const allowed = [
    "open",
    "state",
    "click",
    "type",
    "input",
    "scroll",
    "back",
    "screenshot",
    "switch",
    "close-tab",
    "keys",
    "select",
    "eval",
    "extract",
    "hover",
    "dblclick",
    "rightclick",
    "cookies",
    "wait",
    "get",
    "python",
    "run",
    "task",
    "install",
    "doctor",
    "init",
    "setup",
    "close",
  ];

  const firstToken = commandArgs.split(/\s+/)[0]?.toLowerCase();
  if (!firstToken || !allowed.includes(firstToken)) {
    return null;
  }

  const topLevelArgs: string[] = [];
  if (normalized.browserMode !== "default") {
    topLevelArgs.push(`--browser ${normalized.browserMode}`);
  }
  if (normalized.headed) {
    topLevelArgs.push("--headed");
  }
  if (normalized.profileName) {
    topLevelArgs.push(`--profile ${JSON.stringify(normalized.profileName)}`);
  }
  if (normalized.sessionName) {
    topLevelArgs.push(`--session ${JSON.stringify(normalized.sessionName)}`);
  }
  const canonicalArgs = [...topLevelArgs, commandArgs].join(" ").trim();
  const command = `PATH="$HOME/.local/bin:$PATH" "${BROWSER_USE_HOME}/.venv/bin/browser-use" ${canonicalArgs}`;
  const liveUi = normalized.browserMode === "real" && normalized.headed;
  const requiresLlm = firstToken === "run" || firstToken === "task" || firstToken === "extract";
  return {
    command,
    summary: `browser-use ${canonicalArgs}`,
    rawArgs: commandArgs,
    subcommand: firstToken,
    requiresLlm,
    browserMode: normalized.browserMode,
    modeExplicit: normalized.modeExplicit,
    headed: normalized.headed,
    liveUi,
    tabHistoryReport: false,
    profileName: normalized.profileName,
    sessionName: normalized.sessionName,
  };
}

function buildTabHistoryIntent(): BrowserUseCommandIntent {
  const canonicalArgs = "--browser real --headed state";
  return {
    command: `PATH="$HOME/.local/bin:$PATH" "${BROWSER_USE_HOME}/.venv/bin/browser-use" ${canonicalArgs}`,
    summary: "browser-use tab/history report",
    rawArgs: "state",
    subcommand: "state",
    requiresLlm: false,
    browserMode: "real",
    modeExplicit: true,
    headed: true,
    liveUi: true,
    tabHistoryReport: true,
    profileName: undefined,
    sessionName: undefined,
  };
}

function extractFirstUrl(input: string): string | null {
  const match = input.match(/https?:\/\/[^\s"'`]+/i);
  return match?.[0] || null;
}

export function resolveBrowserUseCommandIntent(message: string): BrowserUseCommandIntent | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (lower === "/browser" || lower === "/browser-live" || lower === "/browser-ui" || lower === "/browserui") {
    if (lower === "/browser-live" || lower === "/browser-ui" || lower === "/browserui") {
      return buildBrowserIntent("open https://www.google.com --browser real --headed");
    }
    return buildBrowserIntent("open https://www.google.com --headed");
  }
  if (lower === "/browser-use" || lower === "browser-use") {
    return buildBrowserIntent("doctor");
  }

  let raw = "";
  let forceLiveMode = false;

  if (lower.startsWith("browser-use ")) {
    raw = trimmed.slice("browser-use ".length).trim();
  } else if (lower.startsWith("/browser-use ")) {
    raw = trimmed.slice("/browser-use ".length).trim();
  } else if (lower.startsWith("/browser-live ")) {
    raw = trimmed.slice("/browser-live ".length).trim();
    forceLiveMode = true;
  } else if (lower.startsWith("/browser-ui ")) {
    raw = trimmed.slice("/browser-ui ".length).trim();
    forceLiveMode = true;
  } else if (lower.startsWith("/browserui ")) {
    raw = trimmed.slice("/browserui ".length).trim();
    forceLiveMode = true;
  } else if (lower.startsWith("/browser ")) {
    raw = trimmed.slice("/browser ".length).trim();
  }

  if (!raw) return null;
  if (/^(tabs?|tab-list|history|report)$/i.test(raw)) {
    return buildTabHistoryIntent();
  }
  return buildBrowserIntent(forceLiveMode ? ensureLiveMode(raw) : raw);
}

export function inferBrowserUseNaturalIntent(message: string): BrowserUseCommandIntent | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return null;

  const lower = trimmed.toLowerCase();
  const mentionsBrowser = hasAny(lower, [
    "browser",
    "brwsher",
    "brwser",
    "chrome",
    "website",
    "web site",
    "webpage",
    "web page",
  ]);
  if (!mentionsBrowser) return null;

  const url = extractFirstUrl(trimmed);
  const asksTabList = hasAny(lower, [
    "tab",
    "tabs",
    "history",
    "website list",
    "list daw",
    "ki ki tab",
    "ki ki search",
    "search korecilam",
  ]);
  if (asksTabList) {
    return buildTabHistoryIntent();
  }

  const asksOpen = hasAny(lower, ["open", "oprn", "khulo", "open koro", "browser khulo"]);
  if (asksOpen || url) {
    const target = url || "https://www.google.com";
    return buildBrowserIntent(`open ${target} --headed`);
  }

  const asksDataTask = hasAny(lower, [
    "collect",
    "data",
    "find",
    "search",
    "check",
    "analysis",
    "analyze",
    "scrape",
    "amazon",
  ]);
  if (asksDataTask) {
    const taskText = trimmed.replace(/\s+/g, " ").trim();
    return buildBrowserIntent(`run ${JSON.stringify(taskText)} --headed`);
  }

  return null;
}

async function commandExists(commandName: string): Promise<boolean> {
  const result = await runShellCommand(`command -v ${commandName} >/dev/null 2>&1`);
  return result.exitCode === 0;
}

async function runStep(command: string, details: string[], onStatus?: (status: string) => void): Promise<boolean> {
  onStatus?.(command);
  const result = await runShellCommand(command);
  if (result.exitCode !== 0) {
    details.push(`FAILED: ${command}`);
    details.push((result.output || "").trim() || `exit ${result.exitCode ?? "unknown"}`);
    return false;
  }

  const output = (result.output || "").trim();
  details.push(`OK: ${command}`);
  if (output) {
    details.push(output.split("\n").slice(-4).join("\n"));
  }
  return true;
}

async function writeBrowserUseGuide(details: string[]): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(BROWSER_USE_HOME, { recursive: true });

  const guidePath = join(BROWSER_USE_HOME, "USAGE.md");
  const guide = [
    "# Browser-Use Local Setup (Khalid AI)",
    "",
    "This setup is local-first and does not require Browser-Use Cloud API.",
    "",
    "## Use with your existing model providers",
    "You can use any OpenAI-compatible provider by exporting:",
    "- OPENAI_API_KEY",
    "- OPENAI_BASE_URL",
    "- BROWSER_USE_MODEL",
    "",
    "Example (OpenRouter):",
    "```bash",
    "export OPENAI_API_KEY=\"<your-openrouter-key>\"",
    "export OPENAI_BASE_URL=\"https://openrouter.ai/api/v1\"",
    "export BROWSER_USE_MODEL=\"openai/gpt-4.1-mini\"",
    "```",
    "",
    "Then run browser-use from this directory:",
    "```bash",
    "cd ~/.hakathone/browser-use",
    "browser-use open https://example.com",
    "browser-use state",
    "```",
    "",
    "Chromium install command (already attempted by setup):",
    "```bash",
    "browser-use install",
    "```",
  ].join("\n");

  await fs.writeFile(guidePath, guide, "utf-8");
  details.push(`Guide written: ${guidePath}`);
}

export async function setupBrowserUseLocalStack(
  onStatus?: (status: string) => void,
): Promise<BrowserUseSetupResult> {
  const details: string[] = [];
  const fs = await import("node:fs/promises");
  await fs.mkdir(BROWSER_USE_HOME, { recursive: true });

  const hasUv = await commandExists("uv");
  const hasUvx = await commandExists("uvx");

  if (hasUv && hasUvx) {
    const steps = [
      `cd "${BROWSER_USE_HOME}" && [ -f pyproject.toml ] || uv init --name hakathone-browser-use`,
      `cd "${BROWSER_USE_HOME}" && uv add browser-use`,
      `cd "${BROWSER_USE_HOME}" && uv sync`,
    ];

    for (const step of steps) {
      const ok = await runStep(step, details, onStatus);
      if (!ok) {
        await writeBrowserUseGuide(details);
        return {
          success: false,
          summary: "Browser-Use setup failed while running uv-based install.",
          details,
        };
      }
    }

    const browserInstall = await runStep(`cd "${BROWSER_USE_HOME}" && uvx browser-use install`, details, onStatus);
    if (!browserInstall) {
      details.push("Chromium install failed (sudo/system dependency step may require manual run).");
      details.push(`Retry manually: cd "${BROWSER_USE_HOME}" && uvx browser-use install`);
    }
  } else {
    const steps = [
      `cd "${BROWSER_USE_HOME}" && [ -d .venv ] || python3 -m venv .venv`,
      `cd "${BROWSER_USE_HOME}" && .venv/bin/pip install --upgrade pip`,
      `cd "${BROWSER_USE_HOME}" && .venv/bin/pip install browser-use`,
    ];

    for (const step of steps) {
      const ok = await runStep(step, details, onStatus);
      if (!ok) {
        await writeBrowserUseGuide(details);
        return {
          success: false,
          summary: "Browser-Use setup failed while running pip-based install.",
          details,
        };
      }
    }

    const ok = await runStep(`cd "${BROWSER_USE_HOME}" && .venv/bin/browser-use install`, details, onStatus);
    if (!ok) {
      details.push("Chromium install failed (sudo/system dependency step may require manual run).");
      details.push(`Retry manually: PATH="$HOME/.local/bin:$PATH" ${BROWSER_USE_HOME}/.venv/bin/browser-use install`);
    }
  }

  await writeBrowserUseGuide(details);
  return {
    success: true,
    summary: `Browser-Use local stack is ready at ${BROWSER_USE_HOME}`,
    details,
  };
}
