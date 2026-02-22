import { homedir } from "node:os";
import { join } from "node:path";
import type { CliSkillSelectionMode, CliSkillsState } from "./types.js";

const STORE_DIR = join(homedir(), ".hakathone", "store");
export const CLI_SKILLS_STATE_FILE = join(STORE_DIR, "cli-skills-state.json");
export const CLI_SKILLS_AWESOME_CACHE_FILE = join(STORE_DIR, "cli-skills-awesome-cache.json");

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultCliSkillsState(): CliSkillsState {
  return {
    enabled: true,
    selectionMode: "auto",
    liveTraceEnabled: true,
    preferShipFaster: true,
    shipFasterSessionCarryover: true,
    preferChiferMemory: true,
    maxAutoSkills: 4,
    pinnedSkillIds: [],
    blockedSkillIds: [],
    awesomeCatalogLastSyncAt: undefined,
    awesomeCatalogCount: 0,
  };
}

function normalizeStringArray(value: unknown, max = 128): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    unique.add(trimmed);
    if (unique.size >= max) {
      break;
    }
  }
  return Array.from(unique);
}

function normalizeSelectionMode(value: unknown): CliSkillSelectionMode {
  return value === "manual" ? "manual" : "auto";
}

function normalizeState(value: unknown): CliSkillsState {
  const fallback = defaultCliSkillsState();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const row = value as Partial<CliSkillsState>;
  const maxAuto = Number.isFinite(row.maxAutoSkills)
    ? Math.max(1, Math.min(8, Number(row.maxAutoSkills)))
    : fallback.maxAutoSkills;

  return {
    enabled: row.enabled !== false,
    selectionMode: normalizeSelectionMode(row.selectionMode),
    liveTraceEnabled: row.liveTraceEnabled !== false,
    preferShipFaster: row.preferShipFaster !== false,
    shipFasterSessionCarryover: row.shipFasterSessionCarryover !== false,
    preferChiferMemory: row.preferChiferMemory !== false,
    maxAutoSkills: maxAuto,
    pinnedSkillIds: normalizeStringArray(row.pinnedSkillIds),
    blockedSkillIds: normalizeStringArray(row.blockedSkillIds),
    awesomeCatalogLastSyncAt:
      typeof row.awesomeCatalogLastSyncAt === "string" && row.awesomeCatalogLastSyncAt.trim()
        ? row.awesomeCatalogLastSyncAt
        : undefined,
    awesomeCatalogCount: Number.isFinite(row.awesomeCatalogCount)
      ? Math.max(0, Math.floor(Number(row.awesomeCatalogCount)))
      : fallback.awesomeCatalogCount,
  };
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function loadCliSkillsState(): Promise<CliSkillsState> {
  const fs = await import("node:fs/promises");

  try {
    const raw = await fs.readFile(CLI_SKILLS_STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeState(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveCliSkillsState(normalized);
    }

    return normalized;
  } catch {
    const fallback = defaultCliSkillsState();
    await saveCliSkillsState(fallback);
    return fallback;
  }
}

export async function saveCliSkillsState(state: CliSkillsState): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureStoreDir();
  await fs.writeFile(CLI_SKILLS_STATE_FILE, JSON.stringify(normalizeState(state), null, 2), "utf-8");
}

export async function updateCliSkillsState(
  patch: Partial<CliSkillsState> | ((current: CliSkillsState) => CliSkillsState),
): Promise<CliSkillsState> {
  const current = await loadCliSkillsState();
  const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
  const normalized = normalizeState(next);
  await saveCliSkillsState(normalized);
  return normalized;
}

export async function markAwesomeCatalogSync(count: number): Promise<CliSkillsState> {
  return await updateCliSkillsState((current) => ({
    ...current,
    awesomeCatalogCount: Math.max(0, Math.floor(count)),
    awesomeCatalogLastSyncAt: nowIso(),
  }));
}
