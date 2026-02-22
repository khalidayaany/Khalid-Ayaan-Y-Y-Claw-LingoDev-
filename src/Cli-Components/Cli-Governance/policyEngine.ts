#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

type PolicyMode = "relaxed" | "balanced" | "strict";
type ConfirmTarget = "download" | "install" | "deploy" | "workspace-write";

type PolicyConfig = {
  enabled: boolean;
  mode: PolicyMode;
  readOnlyWorkspace: boolean;
  blockedCommandPatterns: string[];
  requireConfirmation: Record<ConfirmTarget, boolean>;
  workspaceRoot: string;
  updatedAt: string;
};

type PolicyDecision = {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
  confirmHint?: string;
  tags: string[];
};

const STORE_DIR = join(homedir(), ".hakathone", "store");
const POLICY_FILE = join(STORE_DIR, "policy-engine.json");

const HARD_BLOCK_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/\b/i,
  /\brm\s+-rf\s+--no-preserve-root\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bwipefs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bcurl\b.*\|\s*(bash|sh)\b/i,
  /\bwget\b.*\|\s*(bash|sh)\b/i,
];

const TARGET_HINT: Record<ConfirmTarget, string> = {
  download: "allow download",
  install: "allow install",
  deploy: "allow deploy",
  "workspace-write": "allow workspace write",
};

function nowIso(): string {
  return new Date().toISOString();
}

function defaultPolicyConfig(workspaceRoot: string): PolicyConfig {
  return {
    enabled: true,
    mode: "balanced",
    readOnlyWorkspace: false,
    blockedCommandPatterns: [],
    requireConfirmation: {
      download: true,
      install: true,
      deploy: true,
      "workspace-write": false,
    },
    workspaceRoot,
    updatedAt: nowIso(),
  };
}

function normalizePolicyConfig(raw: Partial<PolicyConfig> | undefined, workspaceRoot: string): PolicyConfig {
  const defaults = defaultPolicyConfig(workspaceRoot);
  const mode: PolicyMode =
    raw?.mode === "strict" || raw?.mode === "relaxed" ? raw.mode : defaults.mode;
  const blockedCommandPatterns = Array.isArray(raw?.blockedCommandPatterns)
    ? raw!.blockedCommandPatterns.filter((item) => typeof item === "string" && item.trim())
    : defaults.blockedCommandPatterns;

  const config: PolicyConfig = {
    enabled: raw?.enabled !== false,
    mode,
    readOnlyWorkspace: Boolean(raw?.readOnlyWorkspace),
    blockedCommandPatterns,
    requireConfirmation: {
      download: raw?.requireConfirmation?.download ?? defaults.requireConfirmation.download,
      install: raw?.requireConfirmation?.install ?? defaults.requireConfirmation.install,
      deploy: raw?.requireConfirmation?.deploy ?? defaults.requireConfirmation.deploy,
      "workspace-write":
        raw?.requireConfirmation?.["workspace-write"] ?? defaults.requireConfirmation["workspace-write"],
    },
    workspaceRoot: raw?.workspaceRoot || workspaceRoot,
    updatedAt: raw?.updatedAt || nowIso(),
  };

  if (config.mode === "strict") {
    config.readOnlyWorkspace = true;
    config.requireConfirmation = {
      download: true,
      install: true,
      deploy: true,
      "workspace-write": true,
    };
  }

  if (config.mode === "relaxed") {
    config.readOnlyWorkspace = false;
    config.requireConfirmation = {
      download: false,
      install: false,
      deploy: true,
      "workspace-write": false,
    };
  }

  return config;
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function loadPolicyConfig(workspaceRoot: string): Promise<PolicyConfig> {
  const fs = await import("node:fs/promises");
  try {
    const raw = await fs.readFile(POLICY_FILE, "utf-8");
    return normalizePolicyConfig(JSON.parse(raw) as Partial<PolicyConfig>, workspaceRoot);
  } catch {
    return defaultPolicyConfig(workspaceRoot);
  }
}

export async function savePolicyConfig(config: PolicyConfig): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  const normalized = { ...config, updatedAt: nowIso() };
  await fs.writeFile(POLICY_FILE, JSON.stringify(normalized, null, 2), "utf-8");
}

export async function resetPolicyConfig(workspaceRoot: string): Promise<PolicyConfig> {
  const config = defaultPolicyConfig(workspaceRoot);
  await savePolicyConfig(config);
  return config;
}

export async function setPolicyMode(mode: PolicyMode, workspaceRoot: string): Promise<PolicyConfig> {
  const current = await loadPolicyConfig(workspaceRoot);
  const next = normalizePolicyConfig({ ...current, mode }, workspaceRoot);
  await savePolicyConfig(next);
  return next;
}

export async function setPolicyEnabled(enabled: boolean, workspaceRoot: string): Promise<PolicyConfig> {
  const current = await loadPolicyConfig(workspaceRoot);
  const next = normalizePolicyConfig({ ...current, enabled }, workspaceRoot);
  await savePolicyConfig(next);
  return next;
}

export async function setPolicyConfirmation(
  target: ConfirmTarget,
  enabled: boolean,
  workspaceRoot: string,
): Promise<PolicyConfig> {
  const current = await loadPolicyConfig(workspaceRoot);
  const next = normalizePolicyConfig(
    {
      ...current,
      requireConfirmation: {
        ...current.requireConfirmation,
        [target]: enabled,
      },
    },
    workspaceRoot,
  );
  await savePolicyConfig(next);
  return next;
}

function includesPermissionPhrase(message: string, target: ConfirmTarget): boolean {
  const lower = message.toLowerCase();
  const hint = TARGET_HINT[target];
  return lower.includes(hint);
}

function classifyCommandTags(command: string): string[] {
  const lower = command.toLowerCase();
  const tags: string[] = [];

  if (/\bcurl\b|\bwget\b|\bgit\s+clone\b/.test(lower)) tags.push("download");
  if (/\bnpm\s+install\b|\bpnpm\s+add\b|\bbun\s+add\b|\byarn\s+add\b|\bpip(?:3)?\s+install\b|\bapt(?:-get)?\s+install\b/.test(lower)) {
    tags.push("install");
  }
  if (/\bdeploy\b|\bvercel\b|\bwrangler\s+deploy\b|\bkubectl\s+apply\b|\bterraform\s+apply\b/.test(lower)) {
    tags.push("deploy");
  }
  if (/\b(mkdir|touch|mv|cp|rm|truncate|sed\s+-i)\b/.test(lower)) {
    tags.push("workspace-write");
  }

  return tags;
}

export function evaluateCommandPolicy(
  command: string,
  fullMessage: string,
  config: PolicyConfig,
): PolicyDecision {
  if (!config.enabled) {
    return { allowed: true, requiresConfirmation: false, tags: [] };
  }

  for (const pattern of HARD_BLOCK_PATTERNS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: "Harmful/destructive command is blocked by policy.",
        requiresConfirmation: false,
        tags: ["hard-block"],
      };
    }
  }

  for (const item of config.blockedCommandPatterns) {
    try {
      const re = new RegExp(item, "i");
      if (re.test(command)) {
        return {
          allowed: false,
          reason: `Command blocked by custom policy regex: ${item}`,
          requiresConfirmation: false,
          tags: ["custom-block"],
        };
      }
    } catch {
      continue;
    }
  }

  const tags = classifyCommandTags(command);
  if (config.readOnlyWorkspace && tags.includes("workspace-write")) {
    return {
      allowed: false,
      reason: "Workspace write operation blocked (read-only workspace policy).",
      requiresConfirmation: false,
      tags,
    };
  }

  for (const target of ["download", "install", "deploy", "workspace-write"] as ConfirmTarget[]) {
    if (!tags.includes(target)) continue;
    if (!config.requireConfirmation[target]) continue;
    if (includesPermissionPhrase(fullMessage, target)) continue;

    return {
      allowed: true,
      requiresConfirmation: true,
      confirmHint: TARGET_HINT[target],
      tags,
      reason: `${target} command requires explicit permission phrase.`,
    };
  }

  return {
    allowed: true,
    requiresConfirmation: false,
    tags,
  };
}

export function formatPolicyConfigLines(config: PolicyConfig): string[] {
  return [
    `Policy engine: ${config.enabled ? "enabled" : "disabled"}`,
    `Mode: ${config.mode}`,
    `Read-only workspace: ${config.readOnlyWorkspace ? "yes" : "no"}`,
    `Confirm download: ${config.requireConfirmation.download ? "yes" : "no"}`,
    `Confirm install: ${config.requireConfirmation.install ? "yes" : "no"}`,
    `Confirm deploy: ${config.requireConfirmation.deploy ? "yes" : "no"}`,
    `Confirm workspace-write: ${config.requireConfirmation["workspace-write"] ? "yes" : "no"}`,
    `Custom blocked patterns: ${config.blockedCommandPatterns.length}`,
    `Updated: ${config.updatedAt}`,
  ];
}

export type { ConfirmTarget, PolicyConfig, PolicyDecision, PolicyMode };

