#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

const STORE_DIR = join(homedir(), ".hakathone", "store");
const BROWSER_PROFILE_STORE_FILE = join(STORE_DIR, "browser-profiles.json");
const CLI_BROWSER_PROFILE_ROOT = join(homedir(), ".hakathone", "browser-use", "profiles");

export type BrowserProfilePreference = {
  mode: "auto" | "manual";
  selectedProfileId?: string;
  updatedAt: number;
};

export type ManagedBrowserProfile = {
  id: string;
  name: string;
  sessionName: string;
  profileDir: string;
  createdAt: number;
  updatedAt: number;
};

type BrowserProfileStore = {
  managedProfiles: ManagedBrowserProfile[];
  preference: BrowserProfilePreference;
};

export type BrowserProfileOption = {
  id: string;
  kind: "system" | "managed";
  label: string;
  description: string;
  browserMode: "real" | "chromium";
  profileName?: string;
  sessionName?: string;
};

export type BrowserRuntimeSelection = {
  browserMode: "real" | "chromium";
  profileName?: string;
  sessionName?: string;
  profileId?: string;
  label: string;
  source: "manual" | "auto-system" | "auto-managed";
};

function now(): number {
  return Date.now();
}

function defaultStore(): BrowserProfileStore {
  return {
    managedProfiles: [],
    preference: {
      mode: "auto",
      updatedAt: now(),
    },
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function normalizeManagedProfile(raw: unknown): ManagedBrowserProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<ManagedBrowserProfile>;

  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const sessionName = typeof row.sessionName === "string" ? row.sessionName.trim() : "";
  const profileDir = typeof row.profileDir === "string" ? row.profileDir.trim() : "";

  if (!id || !name || !sessionName || !profileDir) {
    return null;
  }

  return {
    id,
    name,
    sessionName,
    profileDir,
    createdAt: Number.isFinite(row.createdAt) ? Number(row.createdAt) : now(),
    updatedAt: Number.isFinite(row.updatedAt) ? Number(row.updatedAt) : now(),
  };
}

function normalizePreference(raw: unknown): BrowserProfilePreference {
  if (!raw || typeof raw !== "object") {
    return {
      mode: "auto",
      updatedAt: now(),
    };
  }

  const row = raw as Partial<BrowserProfilePreference>;
  const mode = row.mode === "manual" ? "manual" : "auto";
  const selectedProfileId = typeof row.selectedProfileId === "string" && row.selectedProfileId.trim()
    ? row.selectedProfileId.trim()
    : undefined;

  return {
    mode,
    selectedProfileId,
    updatedAt: Number.isFinite(row.updatedAt) ? Number(row.updatedAt) : now(),
  };
}

function normalizeStore(raw: unknown): BrowserProfileStore {
  if (!raw || typeof raw !== "object") {
    return defaultStore();
  }

  const parsed = raw as {
    managedProfiles?: unknown;
    preference?: unknown;
  };

  const managedProfiles = Array.isArray(parsed.managedProfiles)
    ? parsed.managedProfiles
        .map((item) => normalizeManagedProfile(item))
        .filter(Boolean) as ManagedBrowserProfile[]
    : [];

  const dedup = new Map<string, ManagedBrowserProfile>();
  for (const profile of managedProfiles) {
    const current = dedup.get(profile.id);
    if (!current || profile.updatedAt >= current.updatedAt) {
      dedup.set(profile.id, profile);
    }
  }

  return {
    managedProfiles: Array.from(dedup.values()).sort((a, b) => a.name.localeCompare(b.name)),
    preference: normalizePreference(parsed.preference),
  };
}

async function ensureStoreDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(STORE_DIR, { recursive: true });
}

async function ensureCliProfileRoot(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(CLI_BROWSER_PROFILE_ROOT, { recursive: true });
}

async function loadStore(): Promise<BrowserProfileStore> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(BROWSER_PROFILE_STORE_FILE, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    const normalized = normalizeStore(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await saveStore(normalized);
    }

    return normalized;
  } catch {
    return defaultStore();
  }
}

async function saveStore(store: BrowserProfileStore): Promise<void> {
  await ensureStoreDir();
  const fs = await import("node:fs/promises");
  await fs.writeFile(BROWSER_PROFILE_STORE_FILE, JSON.stringify(normalizeStore(store), null, 2), "utf-8");
}

export async function getBrowserProfilePreference(): Promise<BrowserProfilePreference> {
  const store = await loadStore();
  return store.preference;
}

export async function setBrowserProfilePreferenceAuto(): Promise<void> {
  const store = await loadStore();
  store.preference = {
    mode: "auto",
    updatedAt: now(),
  };
  await saveStore(store);
}

export async function setBrowserProfilePreferenceManual(profileId: string): Promise<void> {
  const trimmed = profileId.trim();
  if (!trimmed) {
    throw new Error("Profile ID is required.");
  }

  const options = await listBrowserProfileOptions();
  const found = options.find((item) => item.id === trimmed);
  if (!found) {
    throw new Error(`Profile not found: ${trimmed}`);
  }

  const store = await loadStore();
  store.preference = {
    mode: "manual",
    selectedProfileId: trimmed,
    updatedAt: now(),
  };
  await saveStore(store);
}

export async function listManagedBrowserProfiles(): Promise<ManagedBrowserProfile[]> {
  const store = await loadStore();
  return store.managedProfiles;
}

export async function createManagedBrowserProfile(name: string): Promise<ManagedBrowserProfile> {
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error("Profile name is required.");
  }

  await ensureCliProfileRoot();
  const store = await loadStore();

  const base = slugify(cleanName) || "profile";
  let suffix = 0;
  let id = base;
  while (store.managedProfiles.some((profile) => profile.id === id)) {
    suffix += 1;
    id = `${base}-${suffix}`;
  }

  const createdAt = now();
  const profileDir = join(CLI_BROWSER_PROFILE_ROOT, id);
  const sessionName = `khalid-cli-${id}`;

  const fs = await import("node:fs/promises");
  await fs.mkdir(profileDir, { recursive: true });

  const profile: ManagedBrowserProfile = {
    id,
    name: cleanName,
    sessionName,
    profileDir,
    createdAt,
    updatedAt: createdAt,
  };

  store.managedProfiles.push(profile);
  await saveStore(store);
  return profile;
}

export async function deleteManagedBrowserProfile(profileId: string): Promise<boolean> {
  const trimmed = profileId.trim();
  if (!trimmed) return false;

  const store = await loadStore();
  const existing = store.managedProfiles.find((profile) => profile.id === trimmed);
  if (!existing) {
    return false;
  }

  store.managedProfiles = store.managedProfiles.filter((profile) => profile.id !== trimmed);

  if (store.preference.mode === "manual" && store.preference.selectedProfileId === `managed:${trimmed}`) {
    store.preference = {
      mode: "auto",
      updatedAt: now(),
    };
  }

  await saveStore(store);

  try {
    const fs = await import("node:fs/promises");
    await fs.rm(existing.profileDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  return true;
}

export async function deleteAllManagedBrowserProfiles(): Promise<number> {
  const store = await loadStore();
  const total = store.managedProfiles.length;
  if (!total) {
    return 0;
  }

  const profiles = [...store.managedProfiles];
  store.managedProfiles = [];
  store.preference = {
    mode: "auto",
    updatedAt: now(),
  };
  await saveStore(store);

  const fs = await import("node:fs/promises");
  for (const profile of profiles) {
    await fs.rm(profile.profileDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return total;
}

export async function listSystemBrowserProfiles(): Promise<BrowserProfileOption[]> {
  const fs = await import("node:fs/promises");
  const roots: Array<{ browserLabel: string; root: string }> = [
    { browserLabel: "google-chrome", root: join(homedir(), ".config", "google-chrome") },
    { browserLabel: "chromium", root: join(homedir(), ".config", "chromium") },
  ];

  const options: BrowserProfileOption[] = [];
  const dedup = new Set<string>();

  for (const rootItem of roots) {
    try {
      const entries = await fs.readdir(rootItem.root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const profileName = entry.name;
        if (!(profileName === "Default" || /^Profile \d+$/i.test(profileName))) {
          continue;
        }

        const historyPath = join(rootItem.root, profileName, "History");
        const preferencesPath = join(rootItem.root, profileName, "Preferences");
        const hasHistory = await fs.stat(historyPath).then((stat) => stat.isFile()).catch(() => false);
        const hasPreferences = await fs.stat(preferencesPath).then((stat) => stat.isFile()).catch(() => false);

        if (!hasHistory && !hasPreferences) {
          continue;
        }

        const dedupKey = `${profileName.toLowerCase()}::${rootItem.browserLabel}`;
        if (dedup.has(dedupKey)) {
          continue;
        }
        dedup.add(dedupKey);

        options.push({
          id: `system:${rootItem.browserLabel}:${profileName}`,
          kind: "system",
          label: `${profileName} (${rootItem.browserLabel})`,
          description: `Local system browser profile: ${profileName}`,
          browserMode: "real",
          profileName,
        });
      }
    } catch {
      continue;
    }
  }

  options.sort((a, b) => {
    if (a.profileName === "Default" && b.profileName !== "Default") return -1;
    if (b.profileName === "Default" && a.profileName !== "Default") return 1;
    return a.label.localeCompare(b.label);
  });

  return options;
}

export async function listBrowserProfileOptions(): Promise<BrowserProfileOption[]> {
  const system = await listSystemBrowserProfiles();
  const managed = await listManagedBrowserProfiles();

  const managedOptions: BrowserProfileOption[] = managed.map((profile) => ({
    id: `managed:${profile.id}`,
    kind: "managed",
    label: `${profile.name} (CLI Browser)`,
    description: `CLI-installed browser profile: ${profile.name}`,
    browserMode: "chromium",
    sessionName: profile.sessionName,
  }));

  return [...system, ...managedOptions];
}

export async function resolveBrowserRuntimeSelection(): Promise<BrowserRuntimeSelection | null> {
  const options = await listBrowserProfileOptions();
  if (!options.length) {
    return null;
  }

  const preference = await getBrowserProfilePreference();

  if (preference.mode === "manual" && preference.selectedProfileId) {
    const selected = options.find((item) => item.id === preference.selectedProfileId);
    if (selected) {
      return {
        browserMode: selected.browserMode,
        profileName: selected.profileName,
        sessionName: selected.sessionName,
        profileId: selected.id,
        label: selected.label,
        source: "manual",
      };
    }
  }

  const defaultSystem = options.find((item) => item.kind === "system" && item.profileName === "Default");
  if (defaultSystem) {
    return {
      browserMode: defaultSystem.browserMode,
      profileName: defaultSystem.profileName,
      profileId: defaultSystem.id,
      label: defaultSystem.label,
      source: "auto-system",
    };
  }

  const firstSystem = options.find((item) => item.kind === "system");
  if (firstSystem) {
    return {
      browserMode: firstSystem.browserMode,
      profileName: firstSystem.profileName,
      profileId: firstSystem.id,
      label: firstSystem.label,
      source: "auto-system",
    };
  }

  const firstManaged = options.find((item) => item.kind === "managed");
  if (firstManaged) {
    return {
      browserMode: firstManaged.browserMode,
      sessionName: firstManaged.sessionName,
      profileId: firstManaged.id,
      label: firstManaged.label,
      source: "auto-managed",
    };
  }

  return null;
}
