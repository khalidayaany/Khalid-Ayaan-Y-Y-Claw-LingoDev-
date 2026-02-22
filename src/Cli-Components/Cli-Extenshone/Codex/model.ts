#!/usr/bin/env bun

import { loginCodexOAuth, logoutCodexOAuth } from "./oauth.js";
import {
  saveCodexToken,
  loadCodexToken,
  deleteCodexToken,
  saveCurrentCodexModel,
  getCodexModels,
  type CodexModel,
} from "./codex.js";

const orange = "\x1b[38;2;249;115;22m";
const cyan = "\x1b[38;2;34;211;238m";
const green = "\x1b[38;2;34;197;94m";
const red = "\x1b[38;2;239;68;68m";
const white = "\x1b[38;2;229;231;235m";
const gray = "\x1b[90m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";

function showMenu(): Promise<number> {
  return new Promise((resolve) => {
    const menuItems = [
      { key: 1, label: "Codex Auth", description: "Authenticate with Codex CLI" },
      { key: 2, label: "Codex Model", description: "Select and use Codex models" },
      { key: 3, label: "Codex Logout", description: "Logout from Codex CLI" },
      { key: 0, label: "Cancel", description: "Go back" },
    ];

    let selectedIndex = 0;
    let renderedLines = 0;

    const renderMenu = () => {
      const lines: string[] = [];
      lines.push(`${bold}Select an option:${reset} ${gray}(use ↑↓ arrows, Enter to select)${reset}`);
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );
      for (let index = 0; index < menuItems.length; index++) {
        const item = menuItems[index];
        const isSelected = index === selectedIndex;
        const icon = isSelected ? `${orange}▶${reset}` : " ";
        const color = isSelected ? orange : white;
        lines.push(`  ${icon} ${color}${item.label.padEnd(15)}${reset} ${gray}│${reset} ${item.description}`);
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

    renderMenu();

    const handleData = (data: Buffer) => {
      const char = data.toString();
      if (char === "\x1b[A" || char === "k") {
        selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
        renderMenu();
      } else if (char === "\x1b[B" || char === "j") {
        selectedIndex = (selectedIndex + 1) % menuItems.length;
        renderMenu();
      } else if (char === "\r" || char === "\n") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(menuItems[selectedIndex].key);
      } else if (char === "\u0003") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(0);
      }
    };

    process.stdin.on("data", handleData);
    process.stdin.setRawMode?.(true);
  });
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

async function handleAuth(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}Codex OAuth Authentication${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  try {
    const existing = await loadCodexToken();
    if (existing) {
      console.log(`${green}✓ Codex is already authenticated.${reset}`);
      console.log(`${white}Auth Mode: ${cyan}${existing.authMode}${reset}`);
      console.log(`${white}Returning to main menu...${reset}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return true;
    }

    const progress = {
      update: (message: string) => {
        process.stdout.write(`\r${gray}${message}     ${reset}`);
      },
      stop: (message?: string) => {
        process.stdout.write("\r\x1b[2K");
        if (message) {
          console.log(`${gray}${message}${reset}`);
        }
      },
    };

    const result = await loginCodexOAuth({
      note: async (message: string, title?: string) => {
        if (title) console.log(`${bold}${title}${reset}`);
        console.log(message);
      },
      progress,
    });

    await saveCodexToken(result.token);
    await getCodexModels(result.token);

    console.log("");
    console.log(`${green}✓ Codex OAuth complete!${reset}`);
    console.log(`${green}✓ Authenticated with real Codex account.${reset}`);
    console.log(`${white}Returning to main menu...${reset}`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return true;
  } catch (error: any) {
    console.log("");
    console.log(`${red}✗ OAuth failed: ${error?.message || "Unknown error"}${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }
}

async function selectModelArrow(models: CodexModel[]): Promise<number> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;

    const renderSelection = () => {
      const lines: string[] = [];
      lines.push(`${bold}Select a model:${reset} ${gray}(use ↑↓ arrows, Enter to select, 0 to cancel)${reset}`);
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );
      for (let index = 0; index < models.length; index++) {
        const model = models[index];
        const isSelected = index === selectedIndex;
        const icon = isSelected ? `${orange}▶${reset}` : " ";
        const color = isSelected ? orange : white;
        lines.push(`  ${icon} ${color}${model.name.padEnd(24)}${reset} ${gray}│${reset} ${cyan}${model.id}${reset}`);
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
      } else if (char === "\u0003") {
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

async function handleModels(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}Codex Models${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadCodexToken();
  if (!token) {
    console.log(`${red}Not authenticated. Please select 'Codex Auth' first.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  try {
    console.log(`${gray}Fetching available models...${reset}`);
    const models = await getCodexModels(token);

    console.log("");
    console.log(`${bold}Available Codex Models:${reset}`);
    console.log(
      `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
    );

    models.forEach((model, index) => {
      const inputTypes = model.input.join(", ");
      console.log(`  ${orange}${index + 1}${reset} ${gray}│${reset} ${white}${model.name}${reset}`);
      console.log(`     ${gray}│${reset} ID: ${cyan}${model.id}${reset}`);
      console.log(
        `     ${gray}│${reset} Input: ${gray}${inputTypes}${reset} | Context: ${gray}${model.contextWindow.toLocaleString()}${reset} | Max Tokens: ${gray}${model.maxTokens.toLocaleString()}${reset}`,
      );
      console.log("");
    });

    console.log(
      `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
    );
    console.log(`${green}✓ Authenticated!${reset} ${gray}Select a model to use.${reset}`);
    console.log("");

    const selectedModel = await selectModelArrow(models);
    if (selectedModel >= 0 && selectedModel < models.length) {
      const model = models[selectedModel];
      await saveCurrentCodexModel(model.id);
      console.log("");
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
  console.log(`${bold}${cyan}Codex Logout${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadCodexToken();
  if (!token) {
    console.log(`${gray}Not authenticated.${reset}`);
    console.log("");
    await waitAnyKey();
    return;
  }

  try {
    await logoutCodexOAuth();
  } catch (error: any) {
    console.log(`${red}Codex logout command failed: ${error?.message || "Unknown error"}${reset}`);
    console.log(`${gray}Cleaning local store entry anyway...${reset}`);
  }

  await deleteCodexToken();
  console.log(`${green}✓ Successfully logged out from Codex.${reset}`);
  console.log("");
  await waitAnyKey();
}

export async function runCodexModelCommand(): Promise<void> {
  while (true) {
    const choice = await showMenu();
    switch (choice) {
      case 1: {
        const ok = await handleAuth();
        if (ok) return;
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
