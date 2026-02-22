#!/usr/bin/env bun

import { loginMiniMaxPortalOAuth } from "./oauth.js";
import {
  saveMiniMaxToken,
  loadMiniMaxToken,
  deleteMiniMaxToken,
  saveCurrentMiniMaxModel,
  getMiniMaxModels,
  resolveMiniMaxBaseUrl,
  type MiniMaxToken,
  type MiniMaxModel,
} from "./minimax.js";

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

function showMenu(): Promise<number> {
  return new Promise((resolve) => {
    const menuItems = [
      { key: 1, label: "MiniMax Auth", description: "Authenticate with MiniMax" },
      { key: 2, label: "MiniMax Model", description: "Select and use MiniMax models" },
      { key: 3, label: "MiniMax Logout", description: "Logout from MiniMax" },
      { key: 0, label: "Cancel", description: "Go back" },
    ];

    let selectedIndex = 0;
    let renderedLines = 0;

    const renderMenu = () => {
      const lines: string[] = [];
      lines.push(`${bold}Select an option:${reset} ${gray}(use ↑↓ arrows, Enter to select)${reset}`);
      lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
      for (let index = 0; index < menuItems.length; index++) {
        const item = menuItems[index];
        const isSelected = index === selectedIndex;
        const icon = isSelected ? `${orange}▶${reset}` : " ";
        const color = isSelected ? orange : white;
        lines.push(`  ${icon} ${color}${item.label.padEnd(15)}${reset} ${gray}│${reset} ${item.description}`);
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
  console.log(`${bold}${cyan}MiniMax OAuth Authentication${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log("");

  try {
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

    const token = await loginMiniMaxPortalOAuth({
      openUrl: async (url: string) => {
        const opened = await openUrl(url);
        if (!opened) {
          console.log(`${yellow}Could not open browser automatically. Please open manually.${reset}`);
        }
      },
      note: async (message: string, title?: string) => {
        if (title) console.log(`${bold}${title}${reset}`);
        console.log(message);
      },
      progress,
      region: "global",
    });

    const expires = token.expires > 1_000_000_000_000
      ? token.expires
      : token.expires > 1_000_000_000
        ? token.expires * 1000
        : Date.now() + token.expires * 1000;

    await saveMiniMaxToken({
      access: token.access,
      refresh: token.refresh,
      expires,
      resourceUrl: token.resourceUrl,
    });
    await getMiniMaxModels();

    console.log("");
    console.log(`${green}✓ MiniMax OAuth complete!${reset}`);
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

async function selectModelArrow(models: MiniMaxModel[]): Promise<number> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;

    const renderSelection = () => {
      const lines: string[] = [];
      lines.push(`${bold}Select a model:${reset} ${gray}(use ↑↓ arrows, Enter to select, 0 to cancel)${reset}`);
      lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
      for (let index = 0; index < models.length; index++) {
        const model = models[index];
        const isSelected = index === selectedIndex;
        const icon = isSelected ? `${orange}▶${reset}` : " ";
        const color = isSelected ? orange : white;
        lines.push(`  ${icon} ${color}${model.name.padEnd(20)}${reset} ${gray}│${reset} ${cyan}${model.id}${reset}`);
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

async function callMiniMaxAPI(model: MiniMaxModel, token: MiniMaxToken, message: string): Promise<string> {
  const baseUrl = resolveMiniMaxBaseUrl(token);
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.access}`,
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: Math.min(model.maxTokens, 2048),
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (Array.isArray(data.content)) {
    const text = data.content
      .filter((item: any) => item?.type === "text" && typeof item?.text === "string")
      .map((item: any) => item.text)
      .join("");
    if (text) return text;
  }
  return data.choices?.[0]?.message?.content || data.reply || data.base_resp?.status_msg || "No response from model";
}

async function startChat(model: MiniMaxModel, token: MiniMaxToken) {
  while (true) {
    process.stdout.write(`${orange}You${reset} ${cyan}>${reset} `);
    let input = "";

    const userInput = await new Promise<string>((resolve) => {
      const handleData = (data: Buffer) => {
        const char = data.toString();
        if (char === "\r" || char === "\n") {
          process.stdin.removeListener("data", handleData);
          console.log("");
          resolve(input);
        } else if (char === "\u0003") {
          process.stdin.removeListener("data", handleData);
          console.log("");
          resolve("exit");
        } else if (char === "\u007f") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (char >= " ") {
          input += char;
          process.stdout.write(char);
        }
      };
      process.stdin.on("data", handleData);
      process.stdin.setRawMode?.(true);
    });

    if (userInput.toLowerCase() === "exit") {
      console.log(`${gray}Exiting chat.${reset}`);
      console.log("");
      break;
    }
    if (!userInput.trim()) continue;

    console.log(`${cyan}You:${reset} ${white}${userInput}${reset}`);
    console.log(`${orange}${model.name}:${reset} ${gray}Processing...${reset}`);

    try {
      const response = await callMiniMaxAPI(model, token, userInput);
      console.log(`${orange}${model.name}:${reset} ${white}${response}${reset}`);
    } catch (error: any) {
      console.log(`${orange}${model.name}:${reset} ${red}Error: ${error?.message || "Request failed"}${reset}`);
    }
    console.log("");
  }
}

async function handleModels(): Promise<boolean> {
  console.log("");
  console.log(`${bold}${cyan}MiniMax Models${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log("");

  const token = await loadMiniMaxToken();
  if (!token) {
    console.log(`${red}Not authenticated. Please select 'MiniMax Auth' first.${reset}`);
    console.log("");
    await waitAnyKey();
    return false;
  }

  try {
    console.log(`${gray}Fetching available models...${reset}`);
    const models = await getMiniMaxModels(token);

    console.log("");
    console.log(`${bold}Available MiniMax Models:${reset}`);
    console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);

    models.forEach((model, index) => {
      const inputTypes = model.input.join(", ");
      console.log(`  ${orange}${index + 1}${reset} ${gray}│${reset} ${white}${model.name}${reset}`);
      console.log(`     ${gray}│${reset} ID: ${cyan}${model.id}${reset}`);
      console.log(`     ${gray}│${reset} Input: ${gray}${inputTypes}${reset} | Context: ${gray}${model.contextWindow.toLocaleString()}${reset} | Max Tokens: ${gray}${model.maxTokens.toLocaleString()}${reset}`);
      console.log("");
    });

    console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
    console.log(`${green}✓ Authenticated!${reset} ${gray}Select a model to chat.${reset}`);
    console.log("");

    const selectedModel = await selectModelArrow(models);
    if (selectedModel >= 0 && selectedModel < models.length) {
      const model = models[selectedModel];
      await saveCurrentMiniMaxModel(model.id);
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

async function handleLogout() {
  console.log("");
  console.log(`${bold}${cyan}MiniMax Logout${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log("");

  const token = await loadMiniMaxToken();
  if (!token) {
    console.log(`${gray}Not authenticated.${reset}`);
    console.log("");
    await waitAnyKey();
    return;
  }

  await deleteMiniMaxToken();
  console.log(`${green}✓ Successfully logged out from MiniMax.${reset}`);
  console.log("");
  await waitAnyKey();
}

export async function runMiniMaxModelCommand() {
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
