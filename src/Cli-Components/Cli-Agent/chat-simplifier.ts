#!/usr/bin/env bun

export type ChatSimplifierOptions = {
  keepLineBreaks?: boolean;
};

const ANSI_PATTERN = /\x1B\[[0-9;]*[A-Za-z]/g;
const DECORATIVE_SYMBOL_PATTERN = /[•●○◦▪▫▶▷▸▹►▻◆◇■□▲△▼▽★☆✓✔✗✘✦✧]/g;
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\u2600-\u27BF]/gu;

function stripMarkdownArtifacts(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

function collapseNoisyPunctuation(value: string): string {
  return value
    .replace(/\?{2,}/g, "?")
    .replace(/!{2,}/g, "!")
    .replace(/,{2,}/g, ",")
    .replace(/\.{3,}/g, ".")
    .replace(/\/{3,}/g, "/")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([,.;!?])([^\s\n])/g, "$1 $2")
    .replace(/[ \t]{2,}/g, " ");
}

export function simplifyChatAnswer(raw: string, options: ChatSimplifierOptions = {}): string {
  const keepLineBreaks = options.keepLineBreaks !== false;

  const cleaned = collapseNoisyPunctuation(
    stripMarkdownArtifacts(raw || "")
      .replace(ANSI_PATTERN, "")
      .replace(DECORATIVE_SYMBOL_PATTERN, "")
      .replace(EMOJI_PATTERN, ""),
  );

  const normalized = keepLineBreaks
    ? cleaned
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
    : cleaned.replace(/\s+/g, " ");

  return normalized.trim();
}
