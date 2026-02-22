#!/usr/bin/env bun

import { runModelCommand as runQwenModelCommand } from "../Cli-Extenshone/Qwen/model.js";
import { runMiniMaxModelCommand } from "../Cli-Extenshone/Minimax/model.js";
import { runCodexModelCommand } from "../Cli-Extenshone/Codex/model.js";
import { runAntigravityModelCommand } from "../Cli-Extenshone/Antigravity/model.js";
import { runOpenrouterModelCommand } from "../Cli-Extenshone/Openrouter/model.js";
import { runKiloModelCommand } from "../Cli-Extenshone/Kilo/model.js";
import { loadQwenConfig, loadQwenToken } from "../Cli-Extenshone/Qwen/qwen.js";
import { loadMiniMaxConfig, loadMiniMaxToken } from "../Cli-Extenshone/Minimax/minimax.js";
import { loadCodexConfig, loadCodexToken } from "../Cli-Extenshone/Codex/codex.js";
import { loadAntigravityConfig, loadAntigravityToken } from "../Cli-Extenshone/Antigravity/antigravity.js";
import { loadOpenRouterConfig, loadOpenRouterToken } from "../Cli-Extenshone/Openrouter/openrouter.js";
import { loadKiloConfig, loadKiloToken } from "../Cli-Extenshone/Kilo/kilo.js";
import { setSelectedModelOverride, type ProviderId } from "./Ai.js";

const orange = "\x1b[38;2;249;115;22m";
const white = "\x1b[38;2;229;231;235m";
const gray = "\x1b[90m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";

function showProviderMenu(): Promise<number> {
  return new Promise((resolve) => {
    const providers = [
      { key: 1, label: "Qwen", description: "Open Qwen menu" },
      { key: 2, label: "MiniMax", description: "Open MiniMax menu" },
      { key: 3, label: "Codex", description: "Open Codex menu" },
      { key: 4, label: "Antigravity", description: "Open Antigravity menu" },
      { key: 5, label: "OpenRouter", description: "Open OpenRouter menu" },
      { key: 6, label: "Kilo", description: "Open Kilo menu" },
      { key: 0, label: "Cancel", description: "Go back" },
    ];

    let selectedIndex = 0;
    let renderedLines = 0;

    const renderMenu = () => {
      const lines: string[] = [];
      lines.push(`${bold}Select Provider:${reset} ${gray}(use ↑↓ arrows, Enter to select)${reset}`);
      lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
      for (let index = 0; index < providers.length; index++) {
        const item = providers[index];
        const isSelected = index === selectedIndex;
        const icon = isSelected ? `${orange}▶${reset}` : " ";
        const color = isSelected ? orange : white;
        lines.push(`  ${icon} ${color}${item.label.padEnd(10)}${reset} ${gray}│${reset} ${item.description}`);
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
        selectedIndex = (selectedIndex - 1 + providers.length) % providers.length;
        renderMenu();
      } else if (char === "\x1b[B" || char === "j") {
        selectedIndex = (selectedIndex + 1) % providers.length;
        renderMenu();
      } else if (char === "\r" || char === "\n") {
        process.stdin.removeListener("data", handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        resolve(providers[selectedIndex].key);
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

async function syncSelectionFromProvider(provider: ProviderId): Promise<void> {
  if (provider === "qwen") {
    const token = await loadQwenToken();
    if (!token) return;
    const config = await loadQwenConfig();
    if (config?.currentModel) {
      await setSelectedModelOverride("qwen", "fixed", config.currentModel);
      return;
    }
    await setSelectedModelOverride("qwen", "auto");
    return;
  }

  if (provider === "minimax") {
    const token = await loadMiniMaxToken();
    if (!token) return;
    const config = await loadMiniMaxConfig();
    if (config?.currentModel) {
      await setSelectedModelOverride("minimax", "fixed", config.currentModel);
      return;
    }
    await setSelectedModelOverride("minimax", "auto");
    return;
  }

  if (provider === "codex") {
    const token = await loadCodexToken();
    if (!token) return;
    const config = await loadCodexConfig();
    if (config?.currentModel) {
      await setSelectedModelOverride("codex", "fixed", config.currentModel);
      return;
    }
    await setSelectedModelOverride("codex", "auto");
    return;
  }

  if (provider === "antigravity") {
    const token = await loadAntigravityToken();
    if (!token) return;
    const config = await loadAntigravityConfig();
    if (config?.currentModel) {
      await setSelectedModelOverride("antigravity", "fixed", config.currentModel);
      return;
    }
    await setSelectedModelOverride("antigravity", "auto");
    return;
  }

  if (provider === "openrouter") {
    const token = await loadOpenRouterToken();
    if (!token) return;
    const config = await loadOpenRouterConfig();
    if (config?.currentModel) {
      await setSelectedModelOverride("openrouter", "fixed", config.currentModel);
      return;
    }
    await setSelectedModelOverride("openrouter", "auto");
    return;
  }

  const kiloToken = await loadKiloToken();
  if (!kiloToken) return;
  const kiloConfig = await loadKiloConfig();
  if (kiloConfig?.currentModel) {
    await setSelectedModelOverride("kilo", "fixed", kiloConfig.currentModel);
    return;
  }
  await setSelectedModelOverride("kilo", "auto");
}

export async function runProviderModelMenu(provider: ProviderId): Promise<void> {
  switch (provider) {
    case "qwen":
      await runQwenModelCommand();
      await syncSelectionFromProvider("qwen");
      return;
    case "minimax":
      await runMiniMaxModelCommand();
      await syncSelectionFromProvider("minimax");
      return;
    case "codex":
      await runCodexModelCommand();
      await syncSelectionFromProvider("codex");
      return;
    case "antigravity":
      await runAntigravityModelCommand();
      await syncSelectionFromProvider("antigravity");
      return;
    case "openrouter":
      await runOpenrouterModelCommand();
      await syncSelectionFromProvider("openrouter");
      return;
    case "kilo":
      await runKiloModelCommand();
      await syncSelectionFromProvider("kilo");
      return;
    default:
      return;
  }
}

export async function runModelCommand() {
  const provider = await showProviderMenu();
  switch (provider) {
    case 1:
      await runProviderModelMenu("qwen");
      return;
    case 2:
      await runProviderModelMenu("minimax");
      return;
    case 3:
      await runProviderModelMenu("codex");
      return;
    case 4:
      await runProviderModelMenu("antigravity");
      return;
    case 5:
      await runProviderModelMenu("openrouter");
      return;
    case 6:
      await runProviderModelMenu("kilo");
      return;
    case 0:
    default:
      return;
  }
}
