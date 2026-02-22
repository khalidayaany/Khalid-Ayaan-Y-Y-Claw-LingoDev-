#!/usr/bin/env bun

export type ChiferActivityHandler = (message: string) => void;

export type ChiferResolution = {
  context: string;
  usedCipher: boolean;
  mode: "local-fast";
  reason: string;
};

export function isMemoryIntentPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  const intentKeywords = [
    "remember",
    "memory",
    "memeory",
    "my name",
    "about me",
    "who am i",
    "previous",
    "earlier",
    "last time",
    "session",
    "history",
    "amar",
    "amr",
    "name",
    "mone",
    "mone ase",
    "mone ache",
    "ki mone ase",
    "ki mone ache",
    "what did i ask",
    "what i asked",
    "age",
  ];

  return intentKeywords.some((keyword) => lower.includes(keyword));
}

function scoreLine(line: string, keywords: string[]): number {
  const lower = line.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (keyword.length < 2) continue;
    if (lower.includes(keyword)) {
      score += keyword.length >= 5 ? 3 : 2;
    }
  }
  if (line.startsWith("# ")) score += 1;
  if (line.startsWith("### ")) score += 1;
  return score;
}

export async function resolveChiferMemoryContext(
  userPrompt: string,
  localContext: string,
  activity?: ChiferActivityHandler,
): Promise<ChiferResolution> {
  activity?.("Chifer MCP: local fast retrieval");

  if (!localContext.trim()) {
    return {
      context: "",
      usedCipher: false,
      mode: "local-fast",
      reason: "no_local_context",
    };
  }

  if (!isMemoryIntentPrompt(userPrompt)) {
    return {
      context: localContext,
      usedCipher: false,
      mode: "local-fast",
      reason: "prompt_not_memory_intent",
    };
  }

  const keywords = Array.from(
    new Set(
      userPrompt
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2),
    ),
  );

  const lines = localContext.split("\n").filter((line) => line.trim().length > 0);
  const scored = lines
    .map((line, index) => ({ line, index, score: scoreLine(line, keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score))
    .slice(0, 24)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.line);

  const context = scored.length ? scored.join("\n") : localContext;
  activity?.(scored.length ? "Chifer MCP: matched local memory lines" : "Chifer MCP: fallback full memory");
  return {
    context,
    usedCipher: false,
    mode: "local-fast",
    reason: scored.length ? "local_keyword_match" : "local_full_context",
  };
}
