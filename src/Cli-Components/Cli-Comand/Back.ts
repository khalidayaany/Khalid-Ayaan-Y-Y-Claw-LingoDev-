#!/usr/bin/env bun

import { clearSelectedModelOverride, hasSelectedModelOverride } from "./Ai.js";

export const BACK_COMMANDS = new Set(["/back", "/b"]);

export function isBackCommand(input: string): boolean {
  const cmd = input.trim().toLowerCase();
  return BACK_COMMANDS.has(cmd);
}

export async function runBackToMain(): Promise<{
  handled: boolean;
  clearedPersonalMode: boolean;
  message: string;
}> {
  const hadPersonalMode = await hasSelectedModelOverride();
  if (!hadPersonalMode) {
    return {
      handled: true,
      clearedPersonalMode: false,
      message: "Already at main prompt.",
    };
  }

  const cleared = await clearSelectedModelOverride();
  return {
    handled: true,
    clearedPersonalMode: cleared,
    message: cleared
      ? "Returned to default routing from personal model selection."
      : "Back command handled.",
  };
}
