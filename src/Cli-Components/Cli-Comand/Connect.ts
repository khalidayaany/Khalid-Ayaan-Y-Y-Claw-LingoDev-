#!/usr/bin/env bun

import { runProviderModelMenu } from "./model.js";
import { isChiferMcpEnabled, setChiferMcpEnabled } from "./memory.js";
import { runShellCommand } from "../Cli-Shell/runner.js";
import {
  BROWSER_USE_HOME,
  setupBrowserUseLocalStack,
} from "../Cli-Tools/Browser-Use/browserUse.js";
import {
  createManagedBrowserProfile,
  deleteAllManagedBrowserProfiles,
  deleteManagedBrowserProfile,
  listBrowserProfileOptions,
  listManagedBrowserProfiles,
  resolveBrowserRuntimeSelection,
  setBrowserProfilePreferenceAuto,
  setBrowserProfilePreferenceManual,
  type BrowserProfileOption,
} from "../Cli-Tools/Browser-Use/profileManager.js";
import {
  buildFirecrawlUsage,
  clearFirecrawlApiKey,
  executeFirecrawlRunIntent,
  getFirecrawlStatusSummary,
  setFirecrawlApiKey,
  type FirecrawlRunIntent,
} from "../Cli-Tools/Firecrawl/index.js";
import {
  installCoreCliSkillPacks,
  loadCliSkillsCatalog,
  loadCliSkillsState,
  relocateInstalledSkillsIntoCliSkills,
  searchCliSkills,
  syncAwesomeOpenClawCatalog,
  updateCliSkillsState,
} from "../Cli-Skills/index.js";

const orange = "\x1b[38;2;249;115;22m";
const white = "\x1b[38;2;229;231;235m";
const gray = "\x1b[90m";
const green = "\x1b[38;2;34;197;94m";
const red = "\x1b[38;2;239;68;68m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";

type MenuItem<T extends string> = {
  key: T;
  label: string;
  description: string;
};

type ConnectCategory = "providers" | "tools" | "llm" | "back";
type ProviderItem =
  | "codex"
  | "qwen"
  | "gemini"
  | "minimax"
  | "openrouter"
  | "opencode-zen"
  | "kilo"
  | "claude"
  | "back";
type ToolItem =
  | "supabase"
  | "mcp"
  | "skills"
  | "firecrawl"
  | "telegram"
  | "whatsapp"
  | "call"
  | "browser"
  | "back";
type LlmItem = "ollama" | "back";
type PlaceholderProvider = "claude";
type McpAction = "toggle" | "status" | "back";
type BrowserAction = "add-profile" | "use-browser" | "back";
type BrowserUseAction = "auto-use" | "select-profile" | "delete-profile" | "back";
type SkillsAction =
  | "toggle"
  | "mode"
  | "toggle-live-trace"
  | "toggle-shipfaster"
  | "toggle-shipfaster-carryover"
  | "toggle-chifer"
  | "pin-skill"
  | "unpin-skill"
  | "sync-awesome"
  | "install-core"
  | "relocate-installed"
  | "status"
  | "back";
type FirecrawlAction =
  | "status"
  | "set-key"
  | "clear-key"
  | "test-scrape"
  | "test-search"
  | "usage"
  | "install-skill"
  | "back";

function renderSelectMenu<T extends string>(
  title: string,
  items: Array<MenuItem<T>>,
  selectedIndex: number,
  renderedLines: number,
): number {
  const lines: string[] = [];
  lines.push(`${bold}${title}:${reset} ${gray}(use ↑↓ arrows, Enter to select)${reset}`);
  lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const isSelected = selectedIndex === index;
    const icon = isSelected ? `${orange}▶${reset}` : " ";
    const color = isSelected ? orange : white;
    lines.push(`  ${icon} ${color}${item.label.padEnd(24)}${reset} ${gray}│${reset} ${item.description}`);
  }

  lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);

  if (renderedLines > 0) {
    process.stdout.write(`\x1b[${renderedLines}A`);
  }
  for (const line of lines) {
    process.stdout.write(`\x1b[2K${line}\n`);
  }
  return lines.length;
}

function selectMenu<T extends string>(title: string, items: Array<MenuItem<T>>): Promise<T> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;

    const render = () => {
      renderedLines = renderSelectMenu(title, items, selectedIndex, renderedLines);
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

async function readLinePrompt(message: string): Promise<string> {
  process.stdin.setRawMode?.(false);
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`${white}${message}${reset}`);
  } finally {
    rl.close();
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function truncate(value: string, max = 56): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

async function hasBrowserUseBinary(): Promise<boolean> {
  const result = await runShellCommand(`[ -x ${shellSingleQuote(`${BROWSER_USE_HOME}/.venv/bin/browser-use`)} ]`);
  return result.exitCode === 0;
}

async function ensureBrowserUseReady(): Promise<boolean> {
  const installed = await hasBrowserUseBinary();
  if (installed) return true;

  console.log(`${gray}Browser:${reset} ${white}Browser-Use not installed. Running local setup...${reset}`);
  const setup = await setupBrowserUseLocalStack((status) => {
    const line = status.length > 120 ? `${status.slice(0, 117)}...` : status;
    console.log(`${gray}${line}${reset}`);
  });

  if (!setup.success) {
    console.log(`${red}✗ ${setup.summary}${reset}`);
    for (const detail of setup.details.slice(-8)) {
      console.log(`${gray}${detail}${reset}`);
    }
    console.log("");
    return false;
  }

  console.log(`${green}✓ ${setup.summary}${reset}`);
  console.log("");
  return true;
}

async function openCliBrowserSignIn(sessionName: string): Promise<boolean> {
  const command = [
    `PATH=\"$HOME/.local/bin:$PATH\"`,
    `${shellSingleQuote(`${BROWSER_USE_HOME}/.venv/bin/browser-use`)}`,
    "--browser chromium",
    "--headed",
    `--session ${shellSingleQuote(sessionName)}`,
    "open https://accounts.google.com",
  ].join(" ");

  const result = await runShellCommand(command);
  if (result.exitCode !== 0) {
    console.log(`${red}✗ Failed to open CLI browser sign-in flow.${reset}`);
    if (result.output.trim()) {
      console.log(`${gray}${truncate(result.output.trim(), 240)}${reset}`);
    }
    console.log("");
    return false;
  }

  console.log(`${green}✓ CLI browser opened for sign-in.${reset}`);
  console.log(`${gray}Session:${reset} ${white}${sessionName}${reset}`);
  console.log(`${gray}Now sign in from the opened browser window.${reset}`);
  console.log("");
  return true;
}

function toProfileMenuItem(option: BrowserProfileOption): MenuItem<string> {
  return {
    key: option.id,
    label: truncate(option.label, 24),
    description: truncate(option.description, 58),
  };
}

async function runBrowserAddProfileMenu(): Promise<void> {
  const ready = await ensureBrowserUseReady();
  if (!ready) {
    return;
  }

  const nameInput = (await readLinePrompt("Profile name (empty for auto): ")).trim();
  const managed = await createManagedBrowserProfile(nameInput || `Browser Profile ${Date.now()}`);
  await setBrowserProfilePreferenceManual(`managed:${managed.id}`);

  console.log(`${green}✓ Browser profile created:${reset} ${white}${managed.name}${reset}`);
  console.log(`${gray}Mode:${reset} ${white}CLI Browser (chromium)${reset}`);

  await openCliBrowserSignIn(managed.sessionName);
}

async function runBrowserSelectProfileMenu(): Promise<void> {
  const options = await listBrowserProfileOptions();
  if (!options.length) {
    console.log(`${gray}Browser:${reset} ${white}No profile found. Add Browser Profile first.${reset}`);
    console.log("");
    return;
  }

  const picked = await selectMenu(
    "Select Browser Profile Use AI",
    [
      ...options.map(toProfileMenuItem),
      { key: "back", label: "Back", description: "Go back" },
    ],
  );

  if (picked === "back") {
    return;
  }

  await setBrowserProfilePreferenceManual(picked);
  const selected = options.find((item) => item.id === picked);

  if (selected) {
    console.log(`${green}✓ Browser profile selected for AI.${reset}`);
    console.log(`${gray}Selected:${reset} ${white}${selected.label}${reset}`);
    console.log("");
  }
}

async function runBrowserDeleteProfileMenu(): Promise<void> {
  const managed = await listManagedBrowserProfiles();
  if (!managed.length) {
    console.log(`${gray}Browser:${reset} ${white}No CLI browser profile to delete.${reset}`);
    console.log("");
    return;
  }

  const items: Array<MenuItem<string>> = [
    { key: "delete-all", label: "Delete All", description: "Delete all CLI browser profiles" },
    ...managed.map((profile) => ({
      key: profile.id,
      label: truncate(profile.name, 24),
      description: "Delete this CLI browser profile",
    })),
    { key: "back", label: "Back", description: "Go back" },
  ];

  const picked = await selectMenu("Delete Browser Profile", items);
  if (picked === "back") {
    return;
  }

  if (picked === "delete-all") {
    const removed = await deleteAllManagedBrowserProfiles();
    console.log(`${green}✓ Deleted ${removed} browser profiles.${reset}`);
    console.log("");
    return;
  }

  const ok = await deleteManagedBrowserProfile(picked);
  if (ok) {
    console.log(`${green}✓ Browser profile deleted.${reset}`);
  } else {
    console.log(`${gray}Browser:${reset} ${white}Profile not found.${reset}`);
  }
  console.log("");
}

async function runBrowserUseMenu(): Promise<void> {
  while (true) {
    const action = await selectMenu("Use Browser", [
      { key: "auto-use", label: "Aouto Us", description: "Auto select browser/profile for AI" },
      { key: "select-profile", label: "Seelct Brwsher Profile Use Ai", description: "Manually select profile" },
      { key: "delete-profile", label: "Delect Brwsher Profile", description: "Delete CLI browser profiles" },
      { key: "back", label: "Back", description: "Go back" },
    ] as Array<MenuItem<BrowserUseAction>>);

    if (action === "back") {
      return;
    }

    if (action === "auto-use") {
      await setBrowserProfilePreferenceAuto();
      const selected = await resolveBrowserRuntimeSelection();
      if (selected) {
        console.log(`${green}✓ Browser selection set to auto.${reset}`);
        console.log(`${gray}Auto selected:${reset} ${white}${selected.label}${reset}`);
      } else {
        console.log(`${green}✓ Browser selection set to auto.${reset}`);
        console.log(`${gray}Auto selected:${reset} ${white}No profile yet (fallback will be used).${reset}`);
      }
      console.log("");
      continue;
    }

    if (action === "select-profile") {
      await runBrowserSelectProfileMenu();
      continue;
    }

    await runBrowserDeleteProfileMenu();
  }
}

async function runBrowserToolMenu(): Promise<void> {
  while (true) {
    const picked = await selectMenu("Browser", [
      { key: "add-profile", label: "Add Brwser Profile", description: "Create CLI browser profile and sign in" },
      { key: "use-browser", label: "Use Brwsher", description: "Choose how AI should use browser" },
      { key: "back", label: "Back", description: "Go back" },
    ] as Array<MenuItem<BrowserAction>>);

    if (picked === "back") {
      return;
    }

    if (picked === "add-profile") {
      await runBrowserAddProfileMenu();
      continue;
    }

    await runBrowserUseMenu();
  }
}

function summarizeFirecrawlPreview(text: string, maxChars = 320): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}

async function runFirecrawlIntent(intent: FirecrawlRunIntent): Promise<void> {
  try {
    const text = await executeFirecrawlRunIntent(intent);
    console.log(`${green}✓ Firecrawl request completed.${reset}`);
    console.log(`${gray}${summarizeFirecrawlPreview(text, 420)}${reset}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Firecrawl error";
    console.log(`${red}✗ Firecrawl failed:${reset} ${white}${message}${reset}`);
  }
  console.log("");
}

export async function runFirecrawlToolMenu(): Promise<void> {
  while (true) {
    const action = await selectMenu("Firecrawl", [
      { key: "status", label: "Status", description: "Show Firecrawl configuration status" },
      { key: "set-key", label: "Set API Key", description: "Save Firecrawl API key (fc-...)" },
      { key: "clear-key", label: "Clear API Key", description: "Remove stored Firecrawl key" },
      { key: "test-scrape", label: "Test Scrape", description: "Scrape https://example.com with markdown" },
      { key: "test-search", label: "Test Search", description: "Search web via Firecrawl demo query" },
      { key: "usage", label: "Usage", description: "Show Firecrawl command usage" },
      { key: "install-skill", label: "Install Firecrawl Skill", description: "Run: npx skills add firecrawl/cli -y -a codex" },
      { key: "back", label: "Back", description: "Go back" },
    ] as Array<MenuItem<FirecrawlAction>>);

    if (action === "back") {
      return;
    }

    if (action === "status") {
      const status = await getFirecrawlStatusSummary();
      console.log(status);
      console.log("");
      continue;
    }

    if (action === "set-key") {
      const key = (await readLinePrompt("Firecrawl API Key (fc-...): ")).trim();
      if (!key) {
        console.log(`${gray}Firecrawl:${reset} ${white}No key provided.${reset}`);
        console.log("");
        continue;
      }
      try {
        await setFirecrawlApiKey(key);
        console.log(`${green}✓ Firecrawl API key saved.${reset}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to save Firecrawl key";
        console.log(`${red}✗ ${message}${reset}`);
      }
      console.log("");
      continue;
    }

    if (action === "clear-key") {
      await clearFirecrawlApiKey();
      console.log(`${green}✓ Firecrawl API key cleared.${reset}`);
      console.log("");
      continue;
    }

    if (action === "test-scrape") {
      await runFirecrawlIntent({ kind: "scrape", url: "https://example.com", formats: ["markdown"] });
      continue;
    }

    if (action === "test-search") {
      await runFirecrawlIntent({ kind: "search", query: "firecrawl web scraping", limit: 3 });
      continue;
    }

    if (action === "usage") {
      console.log(buildFirecrawlUsage());
      console.log("");
      continue;
    }

    console.log(`${gray}Firecrawl:${reset} ${white}Installing Firecrawl skill...${reset}`);
    const result = await runShellCommand("npx -y skills add firecrawl/cli -y -a codex");
    if (result.exitCode === 0) {
      console.log(`${green}✓ Firecrawl skill installed.${reset}`);
      const relocation = await relocateInstalledSkillsIntoCliSkills();
      const relocationColor = relocation.success ? green : red;
      const relocationMark = relocation.success ? "✓" : "✗";
      console.log(`${relocationColor}${relocationMark} ${relocation.message}${reset}`);
    } else {
      console.log(`${red}✗ Firecrawl skill install failed.${reset}`);
      const tail = summarizeFirecrawlPreview(result.output, 300);
      if (tail) {
        console.log(`${gray}${tail}${reset}`);
      }
    }
    console.log("");
  }
}

function summarizeSkillMode(mode: "auto" | "manual"): string {
  return mode === "manual" ? "Manual (pinned skills)" : "Auto";
}

async function printSkillsStatus(): Promise<void> {
  const [state, catalog] = await Promise.all([loadCliSkillsState(), loadCliSkillsCatalog()]);
  const selectedNames = state.pinnedSkillIds
    .map((skillId) => catalog.skills.find((item) => item.id === skillId)?.name || skillId)
    .slice(0, 8);

  console.log(
    `${gray}CLI Skills:${reset} ${state.enabled ? `${green}Enabled${reset}` : `${white}Disabled${reset}`}`,
  );
  console.log(`${gray}Mode:${reset} ${white}${summarizeSkillMode(state.selectionMode)}${reset}`);
  console.log(`${gray}Live trace:${reset} ${white}${state.liveTraceEnabled ? "ON" : "OFF"}${reset}`);
  console.log(`${gray}Prefer Ship-Faster:${reset} ${white}${state.preferShipFaster ? "ON" : "OFF"}${reset}`);
  console.log(
    `${gray}Ship-Faster carryover:${reset} ${white}${state.shipFasterSessionCarryover ? "ON" : "OFF"}${reset}`,
  );
  console.log(`${gray}Prefer Chifer memory:${reset} ${white}${state.preferChiferMemory ? "ON" : "OFF"}${reset}`);
  console.log(`${gray}Max auto skills:${reset} ${white}${state.maxAutoSkills}${reset}`);
  console.log(`${gray}Catalog size:${reset} ${white}${catalog.skills.length}${reset}`);
  if (state.awesomeCatalogLastSyncAt) {
    console.log(
      `${gray}Awesome sync:${reset} ${white}${state.awesomeCatalogLastSyncAt} (${state.awesomeCatalogCount} skills)${reset}`,
    );
  }
  console.log(
    `${gray}Pinned skills:${reset} ${white}${selectedNames.length ? selectedNames.join(", ") : "None"}${reset}`,
  );
  console.log("");
}

async function runPinSkillMenu(): Promise<void> {
  const query = (await readLinePrompt("Skill search term: ")).trim();
  const results = await searchCliSkills(query, 12);
  if (!results.length) {
    console.log(`${gray}Skills:${reset} ${white}No matching skill found.${reset}`);
    console.log("");
    return;
  }

  const picked = await selectMenu(
    "Pin Skill",
    [
      ...results.map((skill) => ({
        key: skill.id,
        label: truncate(skill.name, 24),
        description: truncate(`${skill.category} | ${skill.description}`, 58),
      })),
      { key: "back", label: "Back", description: "Go back" },
    ],
  );

  if (picked === "back") {
    return;
  }

  const state = await updateCliSkillsState((current) => ({
    ...current,
    selectionMode: "manual",
    pinnedSkillIds: Array.from(new Set([...current.pinnedSkillIds, picked])),
  }));
  const pinnedCount = state.pinnedSkillIds.length;
  console.log(`${green}✓ Skill pinned.${reset}`);
  console.log(`${gray}Mode:${reset} ${white}${summarizeSkillMode(state.selectionMode)}${reset}`);
  console.log(`${gray}Pinned count:${reset} ${white}${pinnedCount}${reset}`);
  console.log("");
}

async function runUnpinSkillMenu(): Promise<void> {
  const [state, catalog] = await Promise.all([loadCliSkillsState(), loadCliSkillsCatalog()]);
  if (!state.pinnedSkillIds.length) {
    console.log(`${gray}Skills:${reset} ${white}No pinned skills to remove.${reset}`);
    console.log("");
    return;
  }

  const items: Array<MenuItem<string>> = [
    { key: "__clear__", label: "Clear All", description: "Remove all pinned skills" },
    ...state.pinnedSkillIds.map((skillId) => {
      const skill = catalog.skills.find((item) => item.id === skillId);
      return {
        key: skillId,
        label: truncate(skill?.name || skillId, 24),
        description: truncate(skill?.description || "Pinned skill", 58),
      };
    }),
    { key: "back", label: "Back", description: "Go back" },
  ];

  const picked = await selectMenu("Unpin Skill", items);
  if (picked === "back") {
    return;
  }

  if (picked === "__clear__") {
    await updateCliSkillsState((current) => ({
      ...current,
      pinnedSkillIds: [],
      selectionMode: "auto",
    }));
    console.log(`${green}✓ Cleared all pinned skills.${reset}`);
    console.log("");
    return;
  }

  await updateCliSkillsState((current) => ({
    ...current,
    pinnedSkillIds: current.pinnedSkillIds.filter((item) => item !== picked),
  }));
  console.log(`${green}✓ Skill unpinned.${reset}`);
  console.log("");
}

async function runSkillsToolMenu(): Promise<void> {
  while (true) {
    const state = await loadCliSkillsState();
    const action = await selectMenu("Skills", [
      {
        key: "toggle",
        label: state.enabled ? "Disable Auto Skills" : "Enable Auto Skills",
        description: state.enabled ? "Turn off CLI skill auto-routing" : "Turn on CLI skill auto-routing",
      },
      {
        key: "mode",
        label: `Mode: ${summarizeSkillMode(state.selectionMode)}`,
        description: "Switch Auto/Manual skill mode",
      },
      {
        key: "toggle-live-trace",
        label: state.liveTraceEnabled ? "Live Trace: ON" : "Live Trace: OFF",
        description: "Show/hide [SKILL] traces in live activity",
      },
      {
        key: "toggle-shipfaster",
        label: state.preferShipFaster ? "Ship-Faster Priority: ON" : "Ship-Faster Priority: OFF",
        description: "Prefer ship-faster workflows for complex tasks",
      },
      {
        key: "toggle-shipfaster-carryover",
        label: state.shipFasterSessionCarryover
          ? "Ship-Faster Carryover: ON"
          : "Ship-Faster Carryover: OFF",
        description: "Continue from previous session even on short start prompts",
      },
      {
        key: "toggle-chifer",
        label: state.preferChiferMemory ? "Chifer Memory Priority: ON" : "Chifer Memory Priority: OFF",
        description: "Prefer Chifer memory bridge when selecting skills",
      },
      { key: "pin-skill", label: "Pin Skill", description: "Pin a skill and use manual mode" },
      { key: "unpin-skill", label: "Unpin Skill", description: "Remove pinned skills" },
      { key: "sync-awesome", label: "Sync Awesome Catalog", description: "Sync skills from awesome OpenClaw list" },
      { key: "install-core", label: "Install Core Skill Packs", description: "Install Agent Skills + validate ClawHub" },
      {
        key: "relocate-installed",
        label: "Relocate Installed Skills",
        description: "Move installed skills into Cli-Skills/installed/skills",
      },
      { key: "status", label: "Skills Status", description: "Show CLI skills runtime status" },
      { key: "back", label: "Back", description: "Go back" },
    ] as Array<MenuItem<SkillsAction>>);

    if (action === "back") {
      return;
    }

    if (action === "toggle") {
      const next = await updateCliSkillsState((current) => ({
        ...current,
        enabled: !current.enabled,
      }));
      console.log(`${green}✓ CLI skills ${next.enabled ? "enabled" : "disabled"}.${reset}`);
      console.log("");
      continue;
    }

    if (action === "mode") {
      const next = await updateCliSkillsState((current) => ({
        ...current,
        selectionMode: current.selectionMode === "auto" ? "manual" : "auto",
      }));
      console.log(`${green}✓ Skill mode switched to ${summarizeSkillMode(next.selectionMode)}.${reset}`);
      console.log("");
      continue;
    }

    if (action === "toggle-live-trace") {
      const next = await updateCliSkillsState((current) => ({
        ...current,
        liveTraceEnabled: !current.liveTraceEnabled,
      }));
      console.log(`${green}✓ Skill live trace ${next.liveTraceEnabled ? "enabled" : "disabled"}.${reset}`);
      console.log("");
      continue;
    }

    if (action === "toggle-shipfaster") {
      const next = await updateCliSkillsState((current) => ({
        ...current,
        preferShipFaster: !current.preferShipFaster,
      }));
      console.log(`${green}✓ Ship-Faster priority ${next.preferShipFaster ? "enabled" : "disabled"}.${reset}`);
      console.log("");
      continue;
    }

    if (action === "toggle-shipfaster-carryover") {
      const next = await updateCliSkillsState((current) => ({
        ...current,
        shipFasterSessionCarryover: !current.shipFasterSessionCarryover,
      }));
      console.log(
        `${green}✓ Ship-Faster carryover ${next.shipFasterSessionCarryover ? "enabled" : "disabled"}.${reset}`,
      );
      console.log("");
      continue;
    }

    if (action === "toggle-chifer") {
      const next = await updateCliSkillsState((current) => ({
        ...current,
        preferChiferMemory: !current.preferChiferMemory,
      }));
      console.log(`${green}✓ Chifer memory priority ${next.preferChiferMemory ? "enabled" : "disabled"}.${reset}`);
      console.log("");
      continue;
    }

    if (action === "pin-skill") {
      await runPinSkillMenu();
      continue;
    }

    if (action === "unpin-skill") {
      await runUnpinSkillMenu();
      continue;
    }

    if (action === "sync-awesome") {
      console.log(`${gray}Skills:${reset} ${white}Syncing Awesome OpenClaw catalog...${reset}`);
      const result = await syncAwesomeOpenClawCatalog();
      if (result.success) {
        console.log(`${green}✓ ${result.message}${reset}`);
        if (result.sourceUrl) {
          console.log(`${gray}Source:${reset} ${white}${result.sourceUrl}${reset}`);
        }
      } else {
        console.log(`${red}✗ ${result.message}${reset}`);
      }
      console.log("");
      continue;
    }

    if (action === "install-core") {
      console.log(`${gray}Skills:${reset} ${white}Installing core skill packs...${reset}`);
      const report = await installCoreCliSkillPacks(runShellCommand);
      for (const step of report.steps) {
        const ok = step.exitCode === 0;
        console.log(`${ok ? green : red}${ok ? "✓" : "✗"}${reset} ${white}${step.label}${reset}`);
        if (!ok && step.outputTail) {
          console.log(`${gray}${truncate(step.outputTail, 220)}${reset}`);
        }
      }
      if (report.success) {
        console.log(`${green}✓ Core skill packs installed.${reset}`);
      } else {
        console.log(`${red}✗ Core skill pack install incomplete.${reset}`);
      }
      console.log("");
      continue;
    }

    if (action === "relocate-installed") {
      const relocation = await relocateInstalledSkillsIntoCliSkills();
      if (relocation.success) {
        console.log(`${green}✓ ${relocation.message}${reset}`);
      } else {
        console.log(`${red}✗ ${relocation.message}${reset}`);
      }
      console.log(`${gray}Target:${reset} ${white}${relocation.targetPath}${reset}`);
      console.log("");
      continue;
    }

    await printSkillsStatus();
  }
}

const categoryItems: Array<MenuItem<ConnectCategory>> = [
  { key: "providers", label: "AI Provider", description: "Connect AI providers" },
  { key: "tools", label: "Tools", description: "Connect tool integrations" },
  { key: "llm", label: "LLM", description: "Connect local LLM runtimes" },
  { key: "back", label: "Back", description: "Return to main CLI" },
];

const providerItems: Array<MenuItem<ProviderItem>> = [
  { key: "codex", label: "Codex (Recommended)", description: "Connect Codex" },
  { key: "qwen", label: "Qwen", description: "Connect Qwen" },
  { key: "gemini", label: "Gemini", description: "Connect Gemini" },
  { key: "minimax", label: "MiniMax", description: "Connect MiniMax" },
  { key: "openrouter", label: "OpenRouter", description: "Connect OpenRouter" },
  { key: "opencode-zen", label: "OpenCode Zen", description: "Use Kilo-style auth/model flow" },
  { key: "kilo", label: "Kilo", description: "Connect Kilo" },
  { key: "claude", label: "Claude (Coming Soon)", description: "Coming Soon" },
  { key: "back", label: "Back", description: "Go back" },
];

const toolItems: Array<MenuItem<ToolItem>> = [
  { key: "supabase", label: "Supabase", description: "Connect Supabase" },
  { key: "mcp", label: "MCP", description: "Connect MCP server" },
  { key: "skills", label: "Skills", description: "Use local skills toolchain" },
  { key: "firecrawl", label: "Firecrawl", description: "Connect Firecrawl web data API" },
  { key: "telegram", label: "Telegram", description: "Connect Telegram" },
  { key: "whatsapp", label: "Whatsapp", description: "Connect Whatsapp" },
  { key: "call", label: "Call", description: "Connect voice call tools" },
  { key: "browser", label: "Browser", description: "Connect browser control" },
  { key: "back", label: "Back", description: "Go back" },
];

const llmItems: Array<MenuItem<LlmItem>> = [
  { key: "ollama", label: "Ollama", description: "Connect Ollama runtime" },
  { key: "back", label: "Back", description: "Go back" },
];

function mapProviderToModelMenuProvider(provider: ProviderItem):
  | "qwen"
  | "minimax"
  | "codex"
  | "antigravity"
  | "kilo"
  | "openrouter"
  | null {
  if (provider === "qwen") return "qwen";
  if (provider === "minimax") return "minimax";
  if (provider === "codex") return "codex";
  if (provider === "gemini") return "antigravity";
  if (provider === "opencode-zen") return "kilo";
  if (provider === "kilo") return "kilo";
  if (provider === "openrouter") return "openrouter";
  return null;
}

async function runPlaceholderProviderMenu(provider: PlaceholderProvider): Promise<void> {
  if (provider !== "claude") {
    return;
  }
  console.log(`${gray}Claude:${reset} ${white}(Coming Soon)${reset}`);
  console.log("");
}

async function runProviderConnectMenu(): Promise<void> {
  while (true) {
    const picked = await selectMenu("AI Provider", providerItems);
    if (picked === "back") {
      return;
    }

    const mapped = mapProviderToModelMenuProvider(picked);
    if (mapped) {
      if (picked === "opencode-zen") {
        console.log(`${gray}OpenCode Zen:${reset} ${white}Using Kilo-compatible flow.${reset}`);
        console.log("");
      }
      await runProviderModelMenu(mapped);
      continue;
    }

    await runPlaceholderProviderMenu(picked as PlaceholderProvider);
  }
}

async function runStaticCategoryMenu<T extends string>(
  title: string,
  items: Array<MenuItem<T>>,
): Promise<void> {
  while (true) {
    const picked = await selectMenu(title, items);
    if (picked === "back") {
      return;
    }

    const selectedItem = items.find((item) => item.key === picked);
    if (!selectedItem) {
      continue;
    }

    console.log(`${gray}Selected:${reset} ${white}${selectedItem.label}${reset}`);
    console.log(`${gray}Status:${reset} ${white}Not connected yet. Setup will be added next.${reset}`);
    console.log("");
  }
}

async function runMcpToolMenu(): Promise<void> {
  while (true) {
    const enabled = await isChiferMcpEnabled();
    const action = await selectMenu("MCP Tools", [
      {
        key: "toggle",
        label: enabled ? "Disable MCP" : "Enable MCP",
        description: enabled ? "Turn off Chifer MCP memory retrieval" : "Turn on Chifer MCP memory retrieval",
      },
      { key: "status", label: "MCP Status", description: "Show current MCP status" },
      { key: "back", label: "Back", description: "Go back" },
    ] as Array<MenuItem<McpAction>>);

    if (action === "back") {
      return;
    }

    if (action === "status") {
      console.log(
        `${gray}Chifer MCP:${reset} ${enabled ? `${white}${bold}Enabled${reset}` : `${white}Disabled${reset}`}`,
      );
      console.log(`${gray}Scope:${reset} ${white}Local memory retrieval + context matching${reset}`);
      console.log("");
      continue;
    }

    await setChiferMcpEnabled(!enabled);
    console.log(`${green}✓ MCP ${!enabled ? "enabled" : "disabled"} successfully.${reset}`);
    console.log("");
  }
}

async function runToolConnectMenu(): Promise<void> {
  while (true) {
    const picked = await selectMenu("Tools", toolItems);
    if (picked === "back") {
      return;
    }
    if (picked === "mcp") {
      await runMcpToolMenu();
      continue;
    }
    if (picked === "skills") {
      await runSkillsToolMenu();
      continue;
    }
    if (picked === "firecrawl") {
      await runFirecrawlToolMenu();
      continue;
    }
    if (picked === "browser") {
      await runBrowserToolMenu();
      continue;
    }

    const selectedItem = toolItems.find((item) => item.key === picked);
    if (!selectedItem) {
      continue;
    }

    console.log(`${gray}Selected:${reset} ${white}${selectedItem.label}${reset}`);
    console.log(`${gray}Status:${reset} ${white}Not connected yet. Setup will be added next.${reset}`);
    console.log("");
  }
}

export async function runSkillsConnectMenu(): Promise<void> {
  await runSkillsToolMenu();
}

export async function runFirecrawlConnectMenu(): Promise<void> {
  await runFirecrawlToolMenu();
}

export async function runConnectCommand(): Promise<void> {
  while (true) {
    const category = await selectMenu("Connect", categoryItems);
    if (category === "back") return;

    if (category === "providers") {
      await runProviderConnectMenu();
      continue;
    }

    if (category === "tools") {
      await runToolConnectMenu();
      continue;
    }

    await runStaticCategoryMenu("LLM", llmItems);
  }
}
