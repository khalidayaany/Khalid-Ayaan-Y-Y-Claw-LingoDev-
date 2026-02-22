#!/usr/bin/env bun

import { loginAntigravityPortalOAuth } from "./oauth.js";
import {
  saveAntigravityToken,
  loadAntigravityToken,
  deleteAntigravityToken,
  saveCurrentAntigravityModel,
  getAntigravityModels,
  type AntigravityModel,
} from "./antigravity.js";

const orange = "\x1b[38;2;249;115;22m";
const cyan = "\x1b[38;2;34;211;238m";
const green = "\x1b[38;2;34;197;94m";
const red = "\x1b[38;2;239;68;68m";
const yellow = "\x1b[38;2;251;191;36m";
const white = "\x1b[38;2;229;231;235m";
const gray = "\x1b[90m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";

async function openUrl(url: string): Promise<boolean> {
  const platform = process.platform;
  const { exec } = await import("node:child_process");

  try {
    if (platform === "darwin") {
      exec(`open "${url}"`);
    } else if (platform === "win32") {
      exec(`cmd /c start "" "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
    return true;
  } catch {
    return false;
  }
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

function showMenu(): Promise<number> {
  return new Promise((resolve) => {
    const menuItems = [
      { key: 1, label: "Antigravity Auth", description: "Authenticate with Google Antigravity" },
      { key: 2, label: "Antigravity Model", description: "Select and use Antigravity models" },
      { key: 3, label: "Antigravity Logout", description: "Logout from Antigravity" },
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
  console.log(`${bold}${cyan}Google Antigravity OAuth Authentication${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  try {
    const existing = await loadAntigravityToken();
    if (existing) {
      console.log(`${green}✓ Antigravity is already authenticated.${reset}`);
      console.log(`${white}Project: ${cyan}${existing.projectId}${reset}`);
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

    const token = await loginAntigravityPortalOAuth({
      isRemote: Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY),
      openUrl: async (url: string) => {
        const opened = await openUrl(url);
        if (!opened) {
          console.log(`${yellow}Could not open browser automatically. Open URL manually.${reset}`);
        }
      },
      prompt: async (message: string) => readLinePrompt(message),
      note: async (message: string, title?: string) => {
        if (title) {
          console.log(`${bold}${title}${reset}`);
        }
        console.log(message);
      },
      progress,
    });

    await saveAntigravityToken(token);
    await getAntigravityModels(token);

    console.log("");
    console.log(`${green}✓ Antigravity OAuth complete!${reset}`);
    if (token.email) {
      console.log(`${green}✓ Authenticated as: ${white}${token.email}${reset}`);
    }
    console.log(`${green}✓ Project: ${cyan}${token.projectId}${reset}`);
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

async function selectModelArrow(models: AntigravityModel[]): Promise<number> {
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
        lines.push(`  ${icon} ${color}${model.name.padEnd(34)}${reset} ${gray}│${reset} ${cyan}${model.id}${reset}`);
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
  console.log(`${bold}${cyan}Antigravity Models${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadAntigravityToken();
  if (!token) {
    console.log(`${red}Not authenticated. Please select 'Antigravity Auth' first.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  try {
    console.log(`${gray}Fetching available models...${reset}`);
    const models = await getAntigravityModels(token);

    console.log("");
    console.log(`${bold}Available Antigravity Models:${reset}`);
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
      await saveCurrentAntigravityModel(model.id);
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
  console.log(`${bold}${cyan}Antigravity Logout${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadAntigravityToken();
  if (!token) {
    console.log(`${gray}Not authenticated.${reset}`);
    console.log("");
    await waitAnyKey();
    return;
  }

  await deleteAntigravityToken();
  console.log(`${green}✓ Successfully logged out from Antigravity.${reset}`);
  console.log("");
  await waitAnyKey();
}

export async function runAntigravityModelCommand(): Promise<void> {
  while (true) {
    const choice = await showMenu();

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
