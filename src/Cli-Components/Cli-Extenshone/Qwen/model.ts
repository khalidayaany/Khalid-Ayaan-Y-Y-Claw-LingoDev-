#!/usr/bin/env bun

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  saveQwenToken,
  loadQwenToken,
  deleteQwenToken,
  saveCurrentModel,
  getQwenModels,
  resolveQwenBaseUrl,
  type QwenToken,
  type QwenModel,
} from "./qwen.js";

// Colors
const orange = '\x1b[38;2;249;115;22m';
const cyan = '\x1b[38;2;34;211;238m';
const green = '\x1b[38;2;34;197;94m';
const red = '\x1b[38;2;239;68;68m';
const yellow = '\x1b[38;2;251;191;36m';
const white = '\x1b[38;2;229;231;235m';
const gray = '\x1b[90m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';

// Qwen OAuth constants
const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_OAUTH_SCOPE = "openid profile email model.completion";
const QWEN_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function requestDeviceCode(challenge: string): Promise<{
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}> {
  const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: toFormUrlEncoded({
      client_id: QWEN_OAUTH_CLIENT_ID,
      scope: QWEN_OAUTH_SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen device authorization failed: ${text || response.statusText}`);
  }

  const payload = await response.json();
  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new Error("Qwen device authorization returned an incomplete payload.");
  }
  return payload;
}

async function pollDeviceToken(deviceCode: string, verifier: string): Promise<{
  status: "success" | "pending" | "error";
  slowDown?: boolean;
  token?: QwenToken;
  message?: string;
}> {
  try {
    const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: toFormUrlEncoded({
        grant_type: QWEN_OAUTH_GRANT_TYPE,
        client_id: QWEN_OAUTH_CLIENT_ID,
        device_code: deviceCode,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      let payload: { error?: string; error_description?: string } | undefined;
      try {
        payload = await response.json();
      } catch {
        const text = await response.text();
        return { status: "error", message: text || response.statusText };
      }

      if (payload?.error === "authorization_pending") {
        return { status: "pending" };
      }

      if (payload?.error === "slow_down") {
        return { status: "pending", slowDown: true };
      }

      if (payload?.error === "expired_token") {
        return { status: "error", message: "OAuth code expired. Please restart authentication." };
      }

      if (payload?.error === "access_denied") {
        return { status: "error", message: "Access denied. Please try again." };
      }

      return {
        status: "error",
        message: payload?.error_description || payload?.error || response.statusText,
      };
    }

    const tokenPayload = await response.json();

    if (!tokenPayload.access_token || !tokenPayload.refresh_token || !tokenPayload.expires_in) {
      return { status: "error", message: "Qwen OAuth returned incomplete token payload." };
    }

    return {
      status: "success",
      token: {
        access: tokenPayload.access_token,
        refresh: tokenPayload.refresh_token,
        expires: Date.now() + tokenPayload.expires_in * 1000,
        resourceUrl: tokenPayload.resource_url,
      },
    };
  } catch (error: any) {
    return {
      status: "error",
      message: error.message || "Network error during OAuth polling",
    };
  }
}

async function generateOAuthUrl(): Promise<{
  url: string;
  userCode: string;
  deviceCode: string;
  verifier: string;
  expiresInMs: number;
  pollIntervalMs: number;
}> {
  const { verifier, challenge } = generatePkce();
  const device = await requestDeviceCode(challenge);

  const verificationUrl = device.verification_uri_complete || device.verification_uri;

  return {
    url: verificationUrl,
    userCode: device.user_code,
    deviceCode: device.device_code,
    verifier,
    expiresInMs: device.expires_in * 1000,
    pollIntervalMs: (device.interval ?? 2) * 1000,
  };
}

async function completeOAuth(params: {
  verifier: string;
  deviceCode: string;
  expiresInMs: number;
  initialPollIntervalMs: number;
}): Promise<QwenToken> {
  const start = Date.now();
  const timeoutMs = params.expiresInMs;
  let pollIntervalMs = params.initialPollIntervalMs;

  while (Date.now() - start < timeoutMs) {
    const result = await pollDeviceToken(params.deviceCode, params.verifier);

    if (result.status === "success" && result.token) {
      await saveQwenToken(result.token);
      await getQwenModels(result.token);

      return result.token;
    }

    if (result.status === "error") {
      throw new Error(`Qwen OAuth failed: ${result.message}`);
    }

    if (result.status === "pending" && result.slowDown) {
      pollIntervalMs = Math.min(pollIntervalMs * 1.5, 10000);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Qwen OAuth timed out waiting for authorization.");
}

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
      { key: 1, label: 'Qwen Auth', description: 'Authenticate with Qwen' },
      { key: 2, label: 'Qwen Model', description: 'Select and use Qwen models' },
      { key: 3, label: 'Qwen Logout', description: 'Logout from Qwen' },
      { key: 0, label: 'Cancel', description: 'Go back' },
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

      if (char === '\x1b[A' || char === 'k') {
        selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
        renderMenu();
      }
      else if (char === '\x1b[B' || char === 'j') {
        selectedIndex = (selectedIndex + 1) % menuItems.length;
        renderMenu();
      }
      else if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write('\n');
        resolve(menuItems[selectedIndex].key);
      }
      else if (char === '\u0003') {
        process.stdin.removeListener('data', handleData);
        console.log('');
        resolve(0);
      }
    };
    
    process.stdin.on('data', handleData);
    process.stdin.setRawMode?.(true);
  });
}

async function handleAuth(): Promise<boolean> {
  console.log('');
  console.log(`${bold}${cyan}Qwen OAuth Authentication${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log('');

  try {
    console.log(`${gray}Generating OAuth URL...${reset}`);
    const { url, userCode, deviceCode, verifier, expiresInMs, pollIntervalMs } = await generateOAuthUrl();

    console.log('');
    console.log(`${white}Open this URL in your browser:${reset}`);
    console.log(`${cyan}${url}${reset}`);
    console.log('');
    console.log(`${white}User Code: ${bold}${orange}${userCode}${reset}`);
    console.log('');
    console.log(`${gray}Opening browser...${reset}`);

    const opened = await openUrl(url);

    if (!opened) {
      console.log(`${yellow}Could not open browser automatically. Please copy the URL above.${reset}`);
    }

    console.log('');
    console.log(`${bold}${green}→ Complete authentication in your browser${reset}`);
    console.log(`${gray}Polling for authorization...${reset}`);
    console.log('');

    // Show progress
    const progressInterval = setInterval(() => {
      const dots = '.'.repeat(Math.floor(Date.now() / 500) % 4);
      process.stdout.write(`\r${gray}Waiting for Qwen approval${dots}   ${reset}`);
    }, 500);

    const token = await completeOAuth({
      deviceCode,
      verifier,
      expiresInMs,
      initialPollIntervalMs: pollIntervalMs,
    });

    clearInterval(progressInterval);
    console.log('\n');
    console.log(`${green}✓ Qwen OAuth complete!${reset}`);
    console.log('');
    console.log(`${green}✓ Successfully authenticated!${reset}`);
    console.log('');
    console.log(`${white}Returning to main menu...${reset}`);
    
    // Wait a moment then return
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return true; // Success

  } catch (error: any) {
    console.log('');
    console.log(`${red}✗ OAuth failed: ${error.message}${reset}`);
    console.log('');
    console.log(`${white}Press any key to continue...${reset}`);
    
    // Wait for key press
    await new Promise<void>((resolve) => {
      const handleData = () => {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        resolve();
      };
      process.stdin.once('data', handleData);
      process.stdin.setRawMode?.(true);
    });
    
    return false; // Failed
  }
}

async function handleModels(): Promise<boolean> {
  console.log('');
  console.log(`${bold}${cyan}Qwen Models${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log('');

  const token = await loadQwenToken();

  if (!token) {
    console.log(`${red}Not authenticated. Please select 'Qwen Auth' first.${reset}`);
    console.log('');
    console.log(`${white}Press any key to continue...${reset}`);
    await new Promise<void>((resolve) => {
      const handleData = () => {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        resolve();
      };
      process.stdin.once('data', handleData);
      process.stdin.setRawMode?.(true);
    });
    return false;
  }

  try {
    console.log(`${gray}Fetching available models...${reset}`);
    const models = await getQwenModels(token);

    console.log('');
    console.log(`${bold}Available Qwen Models:${reset}`);
    console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);

    models.forEach((model, index) => {
      const inputTypes = model.input.join(', ');
      console.log(`  ${orange}${index + 1}${reset} ${gray}│${reset} ${white}${model.name}${reset}`);
      console.log(`     ${gray}│${reset} ID: ${cyan}${model.id}${reset}`);
      console.log(`     ${gray}│${reset} Input: ${gray}${inputTypes}${reset} | Context: ${gray}${model.contextWindow.toLocaleString()}${reset} | Max Tokens: ${gray}${model.maxTokens.toLocaleString()}${reset}`);
      console.log('');
    });

    console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
    console.log(`${green}✓ Authenticated!${reset} ${gray}Select a model to chat.${reset}`);
    console.log('');
    
    // Model selection with arrow keys
    const selectedModel = await selectModelArrow(models);
    
    if (selectedModel >= 0 && selectedModel < models.length) {
      const model = models[selectedModel];
      await saveCurrentModel(model.id);
      console.log('');
      console.log(`${green}✓ Selected: ${white}${model.name}${reset}`);
      console.log(`${gray}Model saved. Returning to main prompt...${reset}`);
      console.log('');
      await new Promise((resolve) => setTimeout(resolve, 600));
      return true;
    }

    return false;

  } catch (error: any) {
    console.log(`${red}Failed to fetch models: ${error.message}${reset}`);
    console.log('');
    console.log(`${white}Press any key to continue...${reset}`);
    await new Promise<void>((resolve) => {
      const handleData = () => {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        resolve();
      };
      process.stdin.once('data', handleData);
      process.stdin.setRawMode?.(true);
    });
    return false;
  }
}

async function selectModelArrow(models: QwenModel[]): Promise<number> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;

    const renderSelection = () => {
      const lines: string[] = [];
      lines.push(`${bold}Select a model:${reset} ${gray}(use ↑↓ arrows, Enter to select, 0 to cancel)${reset}`);
      lines.push(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
      models.forEach((model, index) => {
        const isSelected = index === selectedIndex;
        const icon = isSelected ? `${orange}▶${reset}` : ' ';
        const color = isSelected ? orange : white;
        lines.push(`  ${icon} ${color}${model.name.padEnd(20)}${reset} ${gray}│${reset} ${cyan}${model.id}${reset}`);
      });
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
      
      // Check for '0' key to cancel
      if (char === '0') {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write('\n');
        resolve(-1);
        return;
      }
      
      // Up arrow or 'k'
      if (char === '\x1b[A' || char === 'k') {
        selectedIndex = (selectedIndex - 1 + models.length) % models.length;
        renderSelection();
      }
      // Down arrow or 'j'
      else if (char === '\x1b[B' || char === 'j') {
        selectedIndex = (selectedIndex + 1) % models.length;
        renderSelection();
      }
      // Enter
      else if (char === '\r' || char === '\n') {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        process.stdout.write('\n');
        resolve(selectedIndex);
      }
      // Ctrl+C
      else if (char === '\u0003') {
        process.stdin.removeListener('data', handleData);
        console.log('');
        resolve(-1);
      }
    };
    
    process.stdin.on('data', handleData);
    process.stdin.setRawMode?.(true);
  });
}

async function startChat(model: QwenModel, token: QwenToken) {
  while (true) {
    process.stdout.write(`${orange}You${reset} ${cyan}>${reset} `);
    
    let input = '';
    
    const userInput = await new Promise<string>((resolve) => {
      const handleData = (data: Buffer) => {
        const char = data.toString();
        
        if (char === '\r' || char === '\n') {
          process.stdin.removeListener('data', handleData);
          console.log('');
          resolve(input);
        } else if (char === '\u0003') {
          process.stdin.removeListener('data', handleData);
          console.log('');
          resolve('exit');
        } else if (char === '\u007f') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char >= ' ') {
          input += char;
          process.stdout.write(char);
        }
      };
      
      process.stdin.on('data', handleData);
      process.stdin.setRawMode?.(true);
    });
    
    if (userInput.toLowerCase() === 'exit') {
      console.log(`${gray}Exiting chat.${reset}`);
      console.log('');
      break;
    }
    
    if (!userInput.trim()) continue;
    
    // Show user message
    console.log(`${cyan}You:${reset} ${white}${userInput}${reset}`);
    
    // Simulate AI response (in real implementation, this would call Qwen API)
    console.log(`${orange}${model.name}:${reset} ${gray}Processing...${reset}`);
    
    try {
      const response = await callQwenAPI(model, token, userInput);
      console.log(`${orange}${model.name}:${reset} ${white}${response}${reset}`);
    } catch (error: any) {
      console.log(`${orange}${model.name}:${reset} ${red}Error: ${error.message}${reset}`);
    }
    
    console.log('');
  }
}

async function callQwenAPI(model: QwenModel, token: QwenToken, message: string): Promise<string> {
  const baseUrl = resolveQwenBaseUrl(token);
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token.access}`,
    },
    body: JSON.stringify({
      model: model.id,
      messages: [
        { role: "user", content: message }
      ],
      max_tokens: Math.min(model.maxTokens, 2048),
    }),
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "No response from model";
}

async function handleLogout() {
  console.log('');
  console.log(`${bold}${cyan}Qwen Logout${reset}`);
  console.log(`${gray}────────────────────────────────────────────────────────────────────────────────────────────────────${reset}`);
  console.log('');

  const token = await loadQwenToken();

  if (!token) {
    console.log(`${gray}Not authenticated.${reset}`);
    console.log('');
    console.log(`${white}Press any key to continue...${reset}`);
    await new Promise<void>((resolve) => {
      const handleData = () => {
        process.stdin.removeListener('data', handleData);
        process.stdin.setRawMode?.(false);
        resolve();
      };
      process.stdin.once('data', handleData);
      process.stdin.setRawMode?.(true);
    });
    return;
  }

  await deleteQwenToken();
  console.log(`${green}✓ Successfully logged out from Qwen.${reset}`);
  console.log('');
  console.log(`${white}Press any key to continue...${reset}`);
  await new Promise<void>((resolve) => {
    const handleData = () => {
      process.stdin.removeListener('data', handleData);
      process.stdin.setRawMode?.(false);
      resolve();
    };
    process.stdin.once('data', handleData);
    process.stdin.setRawMode?.(true);
  });
}

export async function runModelCommand() {
  while (true) {
    const choice = await showMenu();

    switch (choice) {
      case 1:
        const authSuccess = await handleAuth();
        if (authSuccess) {
          return;
        }
        // If failed, continue to show menu
        continue;
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
