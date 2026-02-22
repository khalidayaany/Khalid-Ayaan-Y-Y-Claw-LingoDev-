import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const WORKSPACE_ROOT = resolve(MODULE_DIR, "..", "..", "..");
const CLI_SKILLS_INSTALLED_DIR = resolve(WORKSPACE_ROOT, "Cli-Skills", "installed", "skills");
const AGENT_MOUNTS_DIR = resolve(WORKSPACE_ROOT, "Cli-Skills", "installed", "agent-mounts");
const AGENTS_DIR = resolve(WORKSPACE_ROOT, ".agents");
const AGENTS_SKILLS_PATH = resolve(AGENTS_DIR, "skills");
const ROOT_SKILLS_PATH = resolve(WORKSPACE_ROOT, "skills");
const RESERVED_DOT_DIRS = new Set([".git", ".next", ".vscode", ".idea"]);
const ROOT_COMPAT_MOUNTS = new Set([".agents"]);

const KNOWN_AGENT_MOUNTS = [
  ".adal",
  ".agent",
  ".agents",
  ".augment",
  ".claude",
  ".cline",
  ".codebuddy",
  ".commandcode",
  ".continue",
  ".cortex",
  ".crush",
  ".factory",
  ".goose",
  ".iflow",
  ".junie",
  ".kilocode",
  ".kiro",
  ".kode",
  ".mcpjam",
  ".mux",
  ".neovate",
  ".openhands",
  ".pi",
  ".pochi",
  ".qoder",
  ".qwen",
  ".roo",
  ".trae",
  ".vibe",
  ".windsurf",
  ".zencoder",
];

export interface InstalledSkillsRelocationResult {
  success: boolean;
  movedSkills: string[];
  movedMounts: string[];
  targetPath: string;
  message: string;
}

async function pathStat(path: string) {
  const fs = await import("node:fs/promises");
  try {
    return await fs.lstat(path);
  } catch {
    return null;
  }
}

async function ensureDir(path: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(path, { recursive: true });
}

async function moveEntriesInto(sourceDir: string, targetDir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const moved: string[] = [];
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);
    await fs.rm(targetPath, { recursive: true, force: true });

    try {
      await fs.rename(sourcePath, targetPath);
    } catch {
      await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
      await fs.rm(sourcePath, { recursive: true, force: true });
    }

    moved.push(entry.name);
  }

  return moved;
}

async function makeDirSymlink(linkPath: string, targetPath: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.rm(linkPath, { recursive: true, force: true });
  const linkParent = resolve(linkPath, "..");
  const relativeTarget = relative(linkParent, targetPath) || ".";
  await fs.symlink(relativeTarget, linkPath, "dir");
}

async function sameRealPath(leftPath: string, rightPath: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  const [leftRealPath, rightRealPath] = await Promise.all([
    fs.realpath(leftPath).catch(() => null),
    fs.realpath(rightPath).catch(() => rightPath),
  ]);
  if (!leftRealPath || !rightRealPath) {
    return false;
  }
  return resolve(leftRealPath) === resolve(rightRealPath);
}

async function listWorkspaceEntries(): Promise<Array<{ name: string; isDirectory: boolean }>> {
  const fs = await import("node:fs/promises");
  try {
    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

async function collectAgentMountNames(): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const names = new Set<string>();

  for (const mount of KNOWN_AGENT_MOUNTS) {
    names.add(mount);
  }

  const entries = await listWorkspaceEntries();
  for (const entry of entries) {
    if (!entry.name.startsWith(".")) {
      continue;
    }
    if (RESERVED_DOT_DIRS.has(entry.name)) {
      continue;
    }
    const skillsPath = resolve(WORKSPACE_ROOT, entry.name, "skills");
    const stat = await pathStat(skillsPath);
    if (stat) {
      names.add(entry.name);
    }
  }

  try {
    const mounted = await fs.readdir(AGENT_MOUNTS_DIR, { withFileTypes: true });
    for (const entry of mounted) {
      if (!entry.isDirectory() || !entry.name.startsWith(".")) {
        continue;
      }
      names.add(entry.name);
    }
  } catch {
    // Ignore if mount directory does not exist yet.
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

async function rewireAgentMountDirs(targetDir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const movedMounts: string[] = [];
  await ensureDir(AGENT_MOUNTS_DIR);
  const mounts = await collectAgentMountNames();

  for (const mountName of mounts) {
    const mountDir = resolve(AGENT_MOUNTS_DIR, mountName);
    await ensureDir(mountDir);

    const mountSkills = resolve(mountDir, "skills");
    await makeDirSymlink(mountSkills, targetDir);

    const rootMountPath = resolve(WORKSPACE_ROOT, mountName);
    const rootStat = await pathStat(rootMountPath);

    if (ROOT_COMPAT_MOUNTS.has(mountName)) {
      if (rootStat?.isSymbolicLink() && (await sameRealPath(rootMountPath, mountDir))) {
        continue;
      }
      await fs.rm(rootMountPath, { recursive: true, force: true });
      await makeDirSymlink(rootMountPath, mountDir);
      continue;
    }

    if (!rootStat) {
      continue;
    }

    // Merge any legacy root mount content into Cli-Skills mount storage.
    if (rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
      await fs.cp(rootMountPath, mountDir, { recursive: true, force: true, errorOnExist: false });
      const rootSkillsPath = resolve(rootMountPath, "skills");
      const rootSkillsStat = await pathStat(rootSkillsPath);
      if (rootSkillsStat?.isDirectory() && !rootSkillsStat.isSymbolicLink()) {
        await moveEntriesInto(rootSkillsPath, targetDir);
      }
    }

    if (rootStat.isSymbolicLink() && !(await sameRealPath(rootMountPath, mountDir))) {
      const rootSkillsPath = resolve(rootMountPath, "skills");
      const rootSkillsStat = await pathStat(rootSkillsPath);
      if (rootSkillsStat?.isDirectory() && !rootSkillsStat.isSymbolicLink()) {
        await moveEntriesInto(rootSkillsPath, targetDir);
      }
    }

    await fs.rm(rootMountPath, { recursive: true, force: true });
    movedMounts.push(mountName);
  }

  return movedMounts;
}

async function relocateAgentsSkillsSource(targetDir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const moved: string[] = [];
  const stat = await pathStat(AGENTS_SKILLS_PATH);

  if (!stat) {
    await ensureDir(AGENTS_DIR);
    await makeDirSymlink(AGENTS_SKILLS_PATH, targetDir);
    return moved;
  }

  if (stat.isSymbolicLink()) {
    const linkedRealPath = await fs.realpath(AGENTS_SKILLS_PATH).catch(() => null);
    const targetRealPath = await fs.realpath(targetDir).catch(() => targetDir);

    if (linkedRealPath && resolve(linkedRealPath) === resolve(targetRealPath)) {
      return moved;
    }

    await makeDirSymlink(AGENTS_SKILLS_PATH, targetDir);
    return moved;
  }

  if (stat.isDirectory()) {
    const merged = await moveEntriesInto(AGENTS_SKILLS_PATH, targetDir);
    moved.push(...merged);
    await fs.rm(AGENTS_SKILLS_PATH, { recursive: true, force: true });
    await makeDirSymlink(AGENTS_SKILLS_PATH, targetDir);
    return moved;
  }

  await makeDirSymlink(AGENTS_SKILLS_PATH, targetDir);
  return moved;
}

async function relocateRootSkillsLink(targetDir: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const stat = await pathStat(ROOT_SKILLS_PATH);

  if (!stat) {
    await makeDirSymlink(ROOT_SKILLS_PATH, targetDir);
    return;
  }

  if (stat.isSymbolicLink()) {
    const linkedRealPath = await fs.realpath(ROOT_SKILLS_PATH).catch(() => null);
    const targetRealPath = await fs.realpath(targetDir).catch(() => targetDir);
    if (linkedRealPath && resolve(linkedRealPath) === resolve(targetRealPath)) {
      return;
    }
  }

  await makeDirSymlink(ROOT_SKILLS_PATH, targetDir);
}

export async function relocateInstalledSkillsIntoCliSkills(): Promise<InstalledSkillsRelocationResult> {
  try {
    await ensureDir(CLI_SKILLS_INSTALLED_DIR);
    const movedSkills = await relocateAgentsSkillsSource(CLI_SKILLS_INSTALLED_DIR);
    await relocateRootSkillsLink(CLI_SKILLS_INSTALLED_DIR);
    const movedMounts = await rewireAgentMountDirs(CLI_SKILLS_INSTALLED_DIR);

    const uniqueMoved = Array.from(new Set(movedSkills)).sort((a, b) => a.localeCompare(b));
    const uniqueMovedMounts = Array.from(new Set(movedMounts)).sort((a, b) => a.localeCompare(b));
    const messageParts: string[] = [];
    if (uniqueMoved.length) {
      messageParts.push(`Moved ${uniqueMoved.length} installed skills into Cli-Skills/installed/skills.`);
    }
    if (uniqueMovedMounts.length) {
      messageParts.push(
        `Moved ${uniqueMovedMounts.length} root agent folders into Cli-Skills/installed/agent-mounts.`,
      );
    }
    const message = messageParts.length
      ? messageParts.join(" ")
      : "Installed skills path already aligned with Cli-Skills/installed/skills.";

    return {
      success: true,
      movedSkills: uniqueMoved,
      movedMounts: uniqueMovedMounts,
      targetPath: CLI_SKILLS_INSTALLED_DIR,
      message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown relocation error";
    return {
      success: false,
      movedSkills: [],
      movedMounts: [],
      targetPath: CLI_SKILLS_INSTALLED_DIR,
      message: `Failed to relocate installed skills: ${message}`,
    };
  }
}
