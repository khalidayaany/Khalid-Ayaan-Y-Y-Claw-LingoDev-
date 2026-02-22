#!/usr/bin/env bun

import { resolveKiloBaseUrl, verifyKiloApiKey, type KiloToken } from "./kilo.js";

const KILO_LOGIN_URL = "https://app.kilo.ai/";
const KILO_API_KEYS_URL = "https://app.kilo.ai/settings/api-keys";

export async function loginKiloOAuth(params: {
  openUrl: (url: string) => Promise<void>;
  prompt: (message: string) => Promise<string>;
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (message: string) => void; stop: (message?: string) => void };
}): Promise<KiloToken> {
  await params.note(
    [
      "Kilo OAuth uses browser sign-in and account-issued API key.",
      "1) Sign in to your Kilo account in browser",
      "2) Open API Keys page and create/copy key",
      "3) Paste that key in terminal for verification",
      "",
      `Login URL: ${KILO_LOGIN_URL}`,
      `API Keys URL: ${KILO_API_KEYS_URL}`,
    ].join("\n"),
    "Kilo OAuth",
  );

  try {
    await params.openUrl(KILO_API_KEYS_URL);
  } catch {
    // manual fallback
  }

  params.progress.update("Waiting for Kilo API key...");
  const apiKey = (await params.prompt("Paste Kilo API key: ")).trim();
  if (!apiKey) {
    throw new Error("API key is required.");
  }

  params.progress.update("Verifying Kilo API key...");
  const baseUrl = resolveKiloBaseUrl();
  const verified = await verifyKiloApiKey(apiKey, baseUrl);
  if (!verified.ok) {
    throw new Error(verified.message || "Kilo API key verification failed.");
  }

  params.progress.stop("Kilo OAuth complete");
  return {
    apiKey,
    userId: verified.userId,
    createdAt: Date.now(),
    authMode: "oauth",
    baseUrl,
  };
}
