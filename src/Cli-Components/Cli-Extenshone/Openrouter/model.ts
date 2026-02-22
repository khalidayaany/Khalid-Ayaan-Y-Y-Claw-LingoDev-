#!/usr/bin/env bun

import { loginOpenRouterOAuth } from "./oauth.js";
import {
  saveOpenRouterToken,
  loadOpenRouterToken,
  deleteOpenRouterToken,
  saveCurrentOpenRouterModel,
  getOpenRouterModels,
  getOpenRouterFreeModels,
  type OpenRouterModel,
} from "./openrouter.js";

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
      { key: 1, label: "OpenRouter Auth", description: "Authenticate with OpenRouter" },
      { key: 2, label: "OpenRouter Models", description: "Select from all OpenRouter models" },
      { key: 3, label: "Search Model", description: "Type model name and auto-filter results" },
      { key: 4, label: "Free Models", description: "Show and select OpenRouter free models" },
      { key: 5, label: "OpenRouter Logout", description: "Logout from OpenRouter" },
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 3)}...`;
}

async function selectModelArrow(
  models: OpenRouterModel[],
  title = "Select a model",
  hint = "use ↑↓ arrows, Enter to select, 0 to cancel",
): Promise<number> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;
    const visibleRows = 12;

    const renderSelection = () => {
      const total = models.length;
      const start = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, total - visibleRows)));
      const end = Math.min(total, start + visibleRows);

      const lines: string[] = [];
      lines.push(`${bold}${title}:${reset} ${gray}(${hint})${reset}`);
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

function filterModelsByQuery(models: OpenRouterModel[], query: string): OpenRouterModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(q));
}

async function searchModelArrow(models: OpenRouterModel[]): Promise<number> {
  return new Promise((resolve) => {
    let query = "";
    let selectedIndex = 0;
    let renderedLines = 0;
    const visibleRows = 10;

    const render = () => {
      const filtered = filterModelsByQuery(models, query);
      if (selectedIndex >= filtered.length) {
        selectedIndex = filtered.length > 0 ? filtered.length - 1 : 0;
      }

      const total = filtered.length;
      const start = Math.max(0, Math.min(selectedIndex - Math.floor(visibleRows / 2), Math.max(0, total - visibleRows)));
      const end = Math.min(total, start + visibleRows);

      const lines: string[] = [];
      lines.push(`${bold}Search Model:${reset} ${gray}(type to filter, Enter to select, Esc to cancel)${reset}`);
      lines.push(`${white}Query:${reset} ${cyan}${query || "(all models)"}${reset}`);
      lines.push(`${gray}Matches: ${total}${reset}`);
      lines.push(
        `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
      );

      if (!total) {
        lines.push(`${red}No models matched your query.${reset}`);
      } else {
        for (let index = start; index < end; index++) {
          const model = filtered[index];
          const isSelected = index === selectedIndex;
          const icon = isSelected ? `${orange}▶${reset}` : " ";
          const color = isSelected ? orange : white;
          const name = truncate(model.name, 32).padEnd(32);
          lines.push(`  ${icon} ${color}${name}${reset} ${gray}│${reset} ${cyan}${model.id}${reset}`);
        }
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
      const filtered = filterModelsByQuery(models, query);

      if (char === "\x1b[A" || char === "k") {
        if (filtered.length > 0) {
          selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
          render();
        }
      } else if (char === "\x1b[B" || char === "j") {
        if (filtered.length > 0) {
          selectedIndex = (selectedIndex + 1) % filtered.length;
          render();
        }
      } else if (char === "\u007f") {
        if (query.length > 0) {
          query = query.slice(0, -1);
          selectedIndex = 0;
          render();
        }
      } else if (char === "\r" || char === "\n") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        const finalFiltered = filterModelsByQuery(models, query);
        if (!finalFiltered.length) {
          resolve(-1);
          return;
        }
        const selected = finalFiltered[selectedIndex];
        const originalIndex = models.findIndex((model) => model.id === selected.id);
        resolve(originalIndex);
      } else if (char === "\x1b" || char === "\u0003") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(-1);
      } else if (/^[ -~]$/.test(char)) {
        query += char;
        selectedIndex = 0;
        render();
      }
    };

    process.stdin.on("data", handleData);
    process.stdin.setRawMode?.(true);
  });
}

async function handleAuth(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}OpenRouter OAuth Authentication${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  try {
    const existing = await loadOpenRouterToken();
    if (existing) {
      console.log(`${green}✓ OpenRouter already authenticated.${reset}`);
      if (existing.userId) {
        console.log(`${white}User: ${cyan}${existing.userId}${reset}`);
      }
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

    const token = await loginOpenRouterOAuth({
      isRemote: Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY),
      openUrl: async (url: string) => {
        const opened = await openUrl(url);
        if (!opened) {
          console.log(`${yellow}Browser did not open automatically. Open the URL manually.${reset}`);
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

    await saveOpenRouterToken(token);
    await getOpenRouterModels(token);

    console.log("");
    console.log(`${green}✓ OpenRouter OAuth complete!${reset}`);
    if (token.userId) {
      console.log(`${green}✓ Authenticated user: ${white}${token.userId}${reset}`);
    }
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

async function handleModels(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}OpenRouter Models${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadOpenRouterToken();
  if (!token) {
    console.log(`${red}Not authenticated. Please run 'OpenRouter Auth' first.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  try {
    console.log(`${gray}Fetching available models...${reset}`);
    const models = await getOpenRouterModels(token);
    if (!models.length) {
      console.log(`${yellow}No OpenRouter models were returned for this account.${reset}`);
      console.log("");
      await waitAnyKey();
      return false;
    }
    console.log(`${green}✓ Loaded ${models.length} models (A-Z).${reset}`);
    console.log(`${gray}Tip: Use 'Search Model' to quickly find a specific model.${reset}`);
    console.log("");

    const selectedModel = await selectModelArrow(models);
    if (selectedModel >= 0 && selectedModel < models.length) {
      const model = models[selectedModel];
      await saveCurrentOpenRouterModel(model.id);
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

async function handleSearchModels(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}OpenRouter Search Model${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadOpenRouterToken();
  if (!token) {
    console.log(`${red}Not authenticated. Please run 'OpenRouter Auth' first.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  try {
    console.log(`${gray}Fetching available models...${reset}`);
    const models = await getOpenRouterModels(token);
    if (!models.length) {
      console.log(`${yellow}No OpenRouter models were returned for this account.${reset}`);
      console.log("");
      await waitAnyKey();
      return false;
    }
    console.log(`${green}✓ Loaded ${models.length} models.${reset}`);
    console.log("");

    const selectedModel = await searchModelArrow(models);
    if (selectedModel >= 0 && selectedModel < models.length) {
      const model = models[selectedModel];
      await saveCurrentOpenRouterModel(model.id);
      console.log(`${green}✓ Selected: ${white}${model.name}${reset}`);
      console.log(`${gray}Model saved. Returning to main prompt...${reset}`);
      console.log("");
      await new Promise((resolve) => setTimeout(resolve, 600));
      return true;
    }

    return false;
  } catch (error: any) {
    console.log(`${red}Search failed: ${error?.message || "Unknown error"}${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }
}

async function handleFreeModels(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}OpenRouter Free Models${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadOpenRouterToken();
  if (!token) {
    console.log(`${red}Not authenticated. Please run 'OpenRouter Auth' first.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  try {
    console.log(`${gray}Fetching free models...${reset}`);
    const freeModels = await getOpenRouterFreeModels(token);
    if (!freeModels.length) {
      console.log(`${yellow}No free models detected on your OpenRouter model list.${reset}`);
      console.log("");
      await waitAnyKey();
      return false;
    }

    console.log(`${green}✓ Loaded ${freeModels.length} free models (A-Z).${reset}`);
    console.log("");

    const selectedModel = await selectModelArrow(freeModels, "Select a free model");
    if (selectedModel >= 0 && selectedModel < freeModels.length) {
      const model = freeModels[selectedModel];
      await saveCurrentOpenRouterModel(model.id);
      console.log(`${green}✓ Selected: ${white}${model.name}${reset}`);
      console.log(`${gray}Model saved. Returning to main prompt...${reset}`);
      console.log("");
      await new Promise((resolve) => setTimeout(resolve, 600));
      return true;
    }

    return false;
  } catch (error: any) {
    console.log(`${red}Failed to load free models: ${error?.message || "Unknown error"}${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }
}

async function handleLogout(): Promise<void> {
  console.log("");
  console.log(`${bold}${cyan}OpenRouter Logout${reset}`);
  console.log(
    `${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`,
  );
  console.log("");

  const token = await loadOpenRouterToken();
  if (!token) {
    console.log(`${gray}Not authenticated.${reset}`);
    console.log("");
    await waitAnyKey();
    return;
  }

  await deleteOpenRouterToken();
  console.log(`${green}✓ Successfully logged out from OpenRouter.${reset}`);
  console.log("");
  await waitAnyKey();
}

export async function runOpenrouterModelCommand(): Promise<void> {
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
        if (await handleSearchModels()) {
          return;
        }
        continue;
      case 4:
        if (await handleFreeModels()) {
          return;
        }
        continue;
      case 5:
        await handleLogout();
        continue;
      case 0:
      default:
        return;
    }
  }
}
