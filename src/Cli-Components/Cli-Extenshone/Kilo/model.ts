#!/usr/bin/env bun

import {
  deleteKiloToken,
  getKiloModels,
  loadKiloToken,
  saveCurrentKiloModel,
  saveKiloToken,
  verifyKiloApiKey,
  type KiloModel,
} from "./kilo.js";

const orange = "\x1b[38;2;249;115;22m";
const cyan = "\x1b[38;2;34;211;238m";
const green = "\x1b[38;2;34;197;94m";
const red = "\x1b[38;2;239;68;68m";
const yellow = "\x1b[38;2;251;191;36m";
const white = "\x1b[38;2;229;231;235m";
const gray = "\x1b[90m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
const KILO_GATEWAY_BASE_URL = "https://api.kilo.ai/api/gateway";

type MenuItem<T extends string | number> = {
  key: T;
  label: string;
  description: string;
};

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

async function waitAnyKey(): Promise<void> {
  console.log(`${white}Press any key to continue...${reset}`);
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
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const active = selectedIndex === index;
        const icon = active ? `${orange}▶${reset}` : " ";
        const color = active ? orange : white;
        lines.push(`  ${icon} ${color}${item.label.padEnd(18)}${reset} ${gray}│${reset} ${item.description}`);
      }
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );

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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

function dedupeModels(models: KiloModel[]): KiloModel[] {
  const seen = new Set<string>();
  const unique: KiloModel[] = [];
  for (const model of models) {
    const id = model.id?.trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(model);
  }
  return unique;
}

async function selectModelArrow(models: KiloModel[]): Promise<number> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;
    const visibleRows = 12;

    const renderSelection = () => {
      const total = models.length;
      const start = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, total - visibleRows)));
      const end = Math.min(total, start + visibleRows);

      const lines: string[] = [];
      lines.push(`${bold}Select a model:${reset} ${gray}(use ↑↓ arrows, Enter to select, 0 to cancel)${reset}`);
      lines.push(`${gray}Showing ${start + 1}-${end} of ${total}${reset}`);
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );
      for (let index = start; index < end; index++) {
        const model = models[index];
        const isSelected = index === selectedIndex;
        const icon = isSelected ? `${orange}▶${reset}` : " ";
        const color = isSelected ? orange : white;
        const name = truncate(model.name, 32).padEnd(32);
        lines.push(`  ${icon} ${color}${name}${reset} ${gray}│${reset} ${cyan}${model.id}${reset}`);
      }
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );

      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A`);
      }
      for (const line of lines) {
        process.stdout.write(`\x1b[2K${line}\n`);
      }
      renderedLines = lines.length;
    };

    renderSelection();

    const handleData = (data: Buffer) => {
      const char = data.toString();
      if (char === "0") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(-1);
      } else if (char === "\x1b[A" || char === "k") {
        selectedIndex = (selectedIndex - 1 + models.length) % models.length;
        renderSelection();
      } else if (char === "\x1b[B" || char === "j") {
        selectedIndex = (selectedIndex + 1) % models.length;
        renderSelection();
      } else if (char === "\r" || char === "\n") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(selectedIndex);
      } else if (char === "\u0003" || char === "\x1b") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(-1);
      }
    };

    process.stdin.on("data", handleData);
    process.stdin.setRawMode?.(true);
  });
}

async function handleApiAuth(): Promise<boolean> {
  console.log("");
  const apiKey = (await readLinePrompt("Paste Kilo API key: ")).trim();
  if (!apiKey) {
    console.log(`${red}API key is required.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  console.log(`${gray}Verifying Kilo API key...${reset}`);
  const verify = await verifyKiloApiKey(apiKey, KILO_GATEWAY_BASE_URL);
  if (!verify.ok) {
    console.log(`${red}Kilo API verify failed: ${verify.message || "Unknown error"}${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  const savedToken = {
    apiKey,
    userId: verify.userId,
    createdAt: Date.now(),
    authMode: "api" as const,
    baseUrl: KILO_GATEWAY_BASE_URL,
  };

  await saveKiloToken(savedToken);
  await getKiloModels(savedToken);
  console.log(`${green}✓ Kilo API connected.${reset}`);
  if (verify.message) {
    console.log(`${yellow}${verify.message}${reset}`);
  }
  console.log(`${green}✓ Model list synced.${reset}`);
  console.log(`${white}Returning to main menu...${reset}`);
  await new Promise((resolve) => setTimeout(resolve, 900));
  return true;
}

async function handleOAuthAuth(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}Kilo OAuth${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log(`${yellow}Kilo does not provide direct OAuth token flow in this CLI.${reset}`);
  console.log(`${gray}Use API key authentication for Kilo access.${reset}`);
  console.log("");
  return await handleApiAuth();
}

async function handleAuth(): Promise<boolean> {
  const selected = await showMenu("Kilo Auth", [
    { key: 1, label: "Kilo Api", description: "Paste and save Kilo API key" },
    { key: 2, label: "Kilo OAuth", description: "Use same API key flow (no browser OAuth)" },
    { key: 0, label: "Back", description: "Go back" },
  ]);

  if (selected === 1) {
    return await handleApiAuth();
  }
  if (selected === 2) {
    return await handleOAuthAuth();
  }
  return false;
}

async function handleModels(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}Kilo Models${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadKiloToken();
  if (!token) {
    console.log(`${red}Not authenticated. Please run 'Kilo Auth' first.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  try {
    console.log(`${gray}Fetching available models...${reset}`);
    const models = await getKiloModels(token);
    if (!models.length) {
      console.log(`${yellow}No Kilo models were returned for this account.${reset}`);
      console.log("");
      await waitAnyKey();
      return false;
    }

    const uniqueModels = dedupeModels(models);
    console.log(
      uniqueModels.length === models.length
        ? `${green}✓ Loaded ${uniqueModels.length} models.${reset}`
        : `${green}✓ Loaded ${uniqueModels.length} unique models.${reset} ${gray}(${models.length} received)${reset}`,
    );
    console.log("");

    const selectedModel = await selectModelArrow(uniqueModels);
    if (selectedModel >= 0 && selectedModel < uniqueModels.length) {
      const model = uniqueModels[selectedModel];
      await saveCurrentKiloModel(model.id);
      console.log(`${green}✓ Selected: ${white}${model.name}${reset}`);
      console.log(`${gray}Model saved. Returning to main prompt...${reset}`);
      console.log("");
      await new Promise((resolve) => setTimeout(resolve, 600));
      return true;
    }
    return false;
  } catch (error: any) {
    console.log(`${red}Failed to fetch models: ${error?.message || "Unknown error"}${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }
}

async function handleLogout(): Promise<void> {
  console.log("");
  console.log(`${bold}${cyan}Kilo Logout${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadKiloToken();
  if (!token) {
    console.log(`${gray}Not authenticated.${reset}`);
    console.log("");
    await waitAnyKey();
    return;
  }

  await deleteKiloToken();
  console.log(`${green}✓ Successfully logged out from Kilo.${reset}`);
  console.log("");
  await waitAnyKey();
}

export async function runKiloModelCommand(): Promise<void> {
  while (true) {
    const choice = await showMenu("Select an option", [
      { key: 1, label: "Kilo Auth", description: "Authenticate with Kilo" },
      { key: 2, label: "Kilo Model", description: "Select and use Kilo models" },
      { key: 3, label: "Kilo Logout", description: "Logout from Kilo" },
      { key: 0, label: "Cancel", description: "Go back" },
    ]);

    switch (choice) {
      case 1: {
        const ok = await handleAuth();
        if (ok) {
          return;
        }
        continue;
      }
      case 2:
        if (await handleModels()) {
          return;
        }
        continue;
      case 3:
        await handleLogout();
        continue;
      case 0:
      default:
        return;
    }
  }
}
