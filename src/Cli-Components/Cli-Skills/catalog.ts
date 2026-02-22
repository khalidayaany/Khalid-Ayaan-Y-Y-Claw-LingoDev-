import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  CLI_SKILLS_AWESOME_CACHE_FILE,
  loadCliSkillsState,
  markAwesomeCatalogSync,
} from "./state.js";
import type {
  AwesomeCatalogSyncResult,
  AwesomeSkillCache,
  CliSkillDefinition,
  CliSkillsCatalog,
} from "./types.js";

const MODULE_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const WORKSPACE_ROOT = resolve(MODULE_DIR, "..", "..", "..");
const WORKSPACE_SKILL_PACKS_DIR = resolve(WORKSPACE_ROOT, "Cli-Skills", "skill-packs");
const WORKSPACE_CUSTOM_SKILLS_DIR = resolve(WORKSPACE_ROOT, "Cli-Skills", "custom");
const WORKSPACE_SKILLS_CACHE_DIR = resolve(WORKSPACE_ROOT, "Cli-Skills", "catalog-cache");
const WORKSPACE_AWESOME_CACHE_FILE = resolve(WORKSPACE_SKILLS_CACHE_DIR, "awesome-openclaw-cache.json");
const WORKSPACE_ALL_SKILLS_FILE = resolve(WORKSPACE_SKILLS_CACHE_DIR, "all-cli-skills.json");

const AWESOME_OPENCLAW_SOURCE_URLS = [
  "https://raw.githubusercontent.com/sundial-org/awesome-openclaw-skills/main/README.md",
  "https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/README.md",
  "https://raw.githubusercontent.com/openclaw/skills/main/README.md",
  "https://raw.githubusercontent.com/VoltAgent/voltagent/main/README.md",
];

const BUILTIN_SKILLS: CliSkillDefinition[] = [
  {
    id: "khalidayaany-core-orchestrator",
    name: "KHALIDAYAAN Y Core Orchestrator",
    description: "Auto orchestrates Ship-Faster flow, role split, and final synthesis for complex tasks.",
    category: "core",
    source: "khalidayaany-core",
    triggers: ["complex", "orchestrate", "plan", "multi step", "workflow", "ship"],
    tags: ["orchestration", "planning", "execution"],
    priority: 7,
  },
  {
    id: "khalidayaany-chifer-memory-bridge",
    name: "KHALIDAYAAN Y Chifer Memory Bridge",
    description: "Bridges selected tasks with Chifer memory context so the assistant stays on target.",
    category: "core",
    source: "khalidayaany-core",
    triggers: ["memory", "context", "chifer", "history", "recall", "previous"],
    tags: ["memory", "context"],
    priority: 6,
  },
  {
    id: "react-best-practices",
    name: "React Best Practices",
    description: "40+ React and Next.js performance rules from Vercel engineering guidance.",
    category: "agent-skills",
    source: "agent-skills",
    triggers: ["react", "next", "component", "rerender", "bundle", "performance"],
    tags: ["frontend", "react", "nextjs", "performance"],
    installHint: "npx skills add vercel-labs/agent-skills",
    priority: 5,
  },
  {
    id: "web-design-guidelines",
    name: "Web Design Guidelines",
    description: "UI/UX, accessibility, and web interface audit rules for production interfaces.",
    category: "agent-skills",
    source: "agent-skills",
    triggers: ["ui", "ux", "a11y", "accessibility", "design", "frontend", "form"],
    tags: ["frontend", "design", "accessibility"],
    installHint: "npx skills add vercel-labs/agent-skills",
    priority: 5,
  },
  {
    id: "react-native-guidelines",
    name: "React Native Guidelines",
    description: "React Native and Expo patterns for performance, layout, animation, and architecture.",
    category: "agent-skills",
    source: "agent-skills",
    triggers: ["react native", "expo", "mobile", "android", "ios", "gesture"],
    tags: ["mobile", "react-native"],
    installHint: "npx skills add vercel-labs/agent-skills",
    priority: 4,
  },
  {
    id: "composition-patterns",
    name: "Composition Patterns",
    description: "Scalable React component composition patterns and prop API simplification.",
    category: "agent-skills",
    source: "agent-skills",
    triggers: ["composition", "compound", "props", "component api", "prop drilling"],
    tags: ["react", "architecture"],
    installHint: "npx skills add vercel-labs/agent-skills",
    priority: 4,
  },
  {
    id: "vercel-deploy-claimable",
    name: "Vercel Deploy Claimable",
    description: "Deploy apps quickly and return preview URL plus claim URL.",
    category: "agent-skills",
    source: "agent-skills",
    triggers: ["deploy", "production", "vercel", "go live", "launch"],
    tags: ["deploy", "devops"],
    installHint: "npx skills add vercel-labs/agent-skills",
    priority: 4,
  },
  {
    id: "workflow-ship-faster",
    name: "Workflow Ship Faster",
    description: "End-to-end project workflow from idea to production-ready MVP.",
    category: "ship-faster",
    source: "ship-faster",
    triggers: ["ship", "launch", "mvp", "workflow", "production", "deploy"],
    tags: ["workflow", "planning", "execution"],
    priority: 6,
  },
  {
    id: "workflow-feature-shipper",
    name: "Workflow Feature Shipper",
    description: "Plan -> implement -> verify flow for PR-sized feature delivery.",
    category: "ship-faster",
    source: "ship-faster",
    triggers: ["feature", "implement", "plan", "verify", "task"],
    tags: ["workflow", "implementation"],
    priority: 5,
  },
  {
    id: "workflow-brainstorm",
    name: "Workflow Brainstorm",
    description: "Turns vague ideas into concrete, confirmed implementation specs.",
    category: "ship-faster",
    source: "ship-faster",
    triggers: ["brainstorm", "idea", "spec", "requirements", "clarify"],
    tags: ["discovery", "planning"],
    priority: 4,
  },
  {
    id: "workflow-project-intake",
    name: "Workflow Project Intake",
    description: "Clarifies user goal and routes to the right implementation workflow.",
    category: "ship-faster",
    source: "ship-faster",
    triggers: ["project", "intake", "kickoff", "route", "requirements"],
    tags: ["planning", "routing"],
    priority: 4,
  },
  {
    id: "tool-systematic-debugging",
    name: "Systematic Debugging",
    description: "Structured debugging method before proposing fixes.",
    category: "ship-faster",
    source: "ship-faster",
    triggers: ["bug", "error", "failing", "debug", "broken", "fix"],
    tags: ["debugging", "quality"],
    priority: 5,
  },
  {
    id: "review-quality",
    name: "Review Quality",
    description: "Merge-readiness and quality review with risk-first findings.",
    category: "ship-faster",
    source: "ship-faster",
    triggers: ["review", "audit", "quality", "merge", "pr"],
    tags: ["review", "quality"],
    priority: 4,
  },
  {
    id: "tool-openclaw",
    name: "OpenClaw Ops",
    description: "Install, configure, and operate OpenClaw channels, nodes, and plugins.",
    category: "openclaw",
    source: "ship-faster",
    triggers: ["openclaw", "clawdbot", "gateway", "plugin", "channel", "onboard"],
    tags: ["openclaw", "ops"],
    priority: 6,
  },
  {
    id: "firecrawl-cli",
    name: "Firecrawl CLI",
    description: "Scrape, crawl, map, search, and agent extraction from websites with LLM-ready output.",
    category: "web-data",
    source: "awesome-openclaw",
    triggers: ["firecrawl", "scrape", "crawl", "map", "extract", "llm-ready", "structured json"],
    tags: ["scraping", "crawler", "web-data", "firecrawl"],
    installHint: "npx skills add firecrawl/cli -y -a codex",
    priority: 7,
  },
  {
    id: "firecrawl-mcp",
    name: "Firecrawl MCP",
    description: "Use Firecrawl MCP integration for automated web research and extraction pipelines.",
    category: "web-data",
    source: "awesome-openclaw",
    triggers: ["firecrawl mcp", "mcp", "web research", "web extraction"],
    tags: ["scraping", "mcp", "research", "firecrawl"],
    installHint: "See Firecrawl MCP documentation",
    priority: 5,
  },
  {
    id: "browser-use",
    name: "Browser Use",
    description: "Browser automation runtime for profile-aware and cloud browser workflows.",
    category: "browser-automation",
    source: "awesome-openclaw",
    triggers: ["browser", "automation", "captcha", "web", "login", "session"],
    tags: ["browser", "automation"],
    installHint: "npx clawhub@latest install browser-use",
    priority: 5,
  },
  {
    id: "playwright-cli",
    name: "Playwright CLI",
    description: "Reliable browser automation via Playwright command workflows.",
    category: "browser-automation",
    source: "awesome-openclaw",
    triggers: ["playwright", "e2e", "test", "browser test", "automation"],
    tags: ["testing", "browser"],
    installHint: "npx clawhub@latest install playwright-cli",
    priority: 4,
  },
  {
    id: "skill-vetter",
    name: "Skill Vetter",
    description: "Security-first vetting for external skills before installation.",
    category: "security",
    source: "awesome-openclaw",
    triggers: ["security", "scan", "malicious", "vet", "safe install"],
    tags: ["security", "skills"],
    installHint: "npx clawhub@latest install skill-vetter",
    priority: 4,
  },
  {
    id: "secure-install",
    name: "Secure Install",
    description: "Scans skills with risk checks before enabling them in runtime.",
    category: "security",
    source: "awesome-openclaw",
    triggers: ["secure", "install", "scan", "risk", "virustotal"],
    tags: ["security", "skills"],
    installHint: "npx clawhub@latest install secure-install",
    priority: 4,
  },
  {
    id: "clawdhub",
    name: "ClawHub CLI",
    description: "Search, install, update, and publish OpenClaw skills from registry.",
    category: "openclaw",
    source: "awesome-openclaw",
    triggers: ["clawhub", "skill search", "install skill", "registry"],
    tags: ["skills", "openclaw"],
    installHint: "npx clawhub@latest install clawdhub",
    priority: 4,
  },
  {
    id: "vercel-deploy",
    name: "Vercel Deploy",
    description: "Deploy applications and websites to Vercel from agent workflows.",
    category: "devops",
    source: "awesome-openclaw",
    triggers: ["vercel", "deploy", "preview", "production"],
    tags: ["deploy", "devops"],
    installHint: "npx clawhub@latest install vercel-deploy",
    priority: 3,
  },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractKeywords(value: string, minLength = 3, max = 12): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= minLength && token.length <= 32);

  const unique = new Set<string>();
  for (const token of tokens) {
    unique.add(token);
    if (unique.size >= max) {
      break;
    }
  }
  return Array.from(unique);
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "skill";
}

function normalizeSkill(skill: CliSkillDefinition): CliSkillDefinition {
  const triggerSet = new Set<string>();
  for (const trigger of skill.triggers) {
    const normalized = normalizeWhitespace(trigger.toLowerCase());
    if (normalized) {
      triggerSet.add(normalized);
    }
  }

  for (const keyword of extractKeywords(`${skill.id} ${skill.name}`)) {
    triggerSet.add(keyword);
  }

  const tagSet = new Set<string>();
  for (const tag of skill.tags) {
    const normalized = normalizeWhitespace(tag.toLowerCase());
    if (normalized) {
      tagSet.add(normalized);
    }
  }

  return {
    ...skill,
    id: normalizeWhitespace(skill.id),
    name: normalizeWhitespace(skill.name),
    description: normalizeWhitespace(skill.description),
    category: normalizeWhitespace(skill.category.toLowerCase()),
    triggers: Array.from(triggerSet).slice(0, 32),
    tags: Array.from(tagSet).slice(0, 16),
    priority: Number.isFinite(skill.priority) ? Number(skill.priority) : 0,
  };
}

async function readAwesomeSkillCacheFile(path: string): Promise<AwesomeSkillCache | null> {
  const fs = await import("node:fs/promises");
  try {
    const raw = await fs.readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AwesomeSkillCache>;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (!Array.isArray(parsed.skills)) {
      return null;
    }

    const normalizedSkills = parsed.skills
      .filter((item): item is CliSkillDefinition => Boolean(item && typeof item === "object"))
      .map((item) => normalizeSkill(item))
      .filter((item) => item.source === "awesome-openclaw");

    if (!normalizedSkills.length) {
      return null;
    }

    return {
      syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : new Date(0).toISOString(),
      sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : "",
      skills: normalizedSkills,
    };
  } catch {
    return null;
  }
}

async function loadAwesomeSkillCache(): Promise<AwesomeSkillCache | null> {
  const [workspaceCache, storeCache] = await Promise.all([
    readAwesomeSkillCacheFile(WORKSPACE_AWESOME_CACHE_FILE),
    readAwesomeSkillCacheFile(CLI_SKILLS_AWESOME_CACHE_FILE),
  ]);

  if (!workspaceCache && !storeCache) {
    return null;
  }

  if (workspaceCache && !storeCache) {
    return workspaceCache;
  }

  if (!workspaceCache && storeCache) {
    return storeCache;
  }

  const workspace = workspaceCache as AwesomeSkillCache;
  const store = storeCache as AwesomeSkillCache;
  if (workspace.skills.length !== store.skills.length) {
    return workspace.skills.length > store.skills.length ? workspace : store;
  }

  return workspace.syncedAt >= store.syncedAt ? workspace : store;
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const fs = await import("node:fs/promises");
  const dir = resolve(path, "..");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

async function saveAwesomeSkillCache(cache: AwesomeSkillCache): Promise<void> {
  await Promise.all([
    writeJsonFile(CLI_SKILLS_AWESOME_CACHE_FILE, cache),
    writeJsonFile(WORKSPACE_AWESOME_CACHE_FILE, cache),
  ]);
}

async function loadWorkspaceCustomSkills(): Promise<CliSkillDefinition[]> {
  const fs = await import("node:fs/promises");
  const custom: CliSkillDefinition[] = [];

  try {
    const entries = await fs.readdir(WORKSPACE_CUSTOM_SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = resolve(WORKSPACE_CUSTOM_SKILLS_DIR, entry.name);
      try {
        const raw = await fs.readFile(fullPath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;

        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of rows) {
          if (!row || typeof row !== "object") {
            continue;
          }
          const skill = row as Partial<CliSkillDefinition>;
          if (!skill.id || !skill.name || !skill.description) {
            continue;
          }
          custom.push(
            normalizeSkill({
              id: String(skill.id),
              name: String(skill.name),
              description: String(skill.description),
              category: String(skill.category || "workspace-custom"),
              source: "workspace-custom",
              triggers: Array.isArray(skill.triggers) ? skill.triggers.map((item) => String(item)) : [],
              tags: Array.isArray(skill.tags) ? skill.tags.map((item) => String(item)) : [],
              priority: Number.isFinite(skill.priority) ? Number(skill.priority) : 2,
              installHint: typeof skill.installHint === "string" ? skill.installHint : undefined,
            }),
          );
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return custom;
}

async function loadWorkspacePackSkills(): Promise<CliSkillDefinition[]> {
  const fs = await import("node:fs/promises");
  try {
    const entries = await fs.readdir(WORKSPACE_SKILL_PACKS_DIR, { withFileTypes: true });
    const loaded: CliSkillDefinition[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const packPath = resolve(WORKSPACE_SKILL_PACKS_DIR, entry.name);
      let parsed: unknown = null;
      try {
        const raw = await fs.readFile(packPath, "utf-8");
        parsed = JSON.parse(raw) as unknown;
      } catch {
        continue;
      }

      const rows = Array.isArray(parsed) ? parsed : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const skill = row as Partial<CliSkillDefinition>;
        if (!skill.id || !skill.name || !skill.description) {
          continue;
        }

        const sourceCandidate = typeof skill.source === "string" ? skill.source : "agent-skills";
        const source = (
          sourceCandidate === "khalidayaany-core" ||
          sourceCandidate === "agent-skills" ||
          sourceCandidate === "ship-faster" ||
          sourceCandidate === "awesome-openclaw" ||
          sourceCandidate === "workspace-custom"
        )
          ? sourceCandidate
          : "agent-skills";

        loaded.push(
          normalizeSkill({
            id: String(skill.id),
            name: String(skill.name),
            description: String(skill.description),
            category: String(skill.category || "agent-skills"),
            source,
            triggers: Array.isArray(skill.triggers) ? skill.triggers.map((item) => String(item)) : [],
            tags: Array.isArray(skill.tags) ? skill.tags.map((item) => String(item)) : [],
            priority: Number.isFinite(skill.priority) ? Number(skill.priority) : 3,
            installHint: typeof skill.installHint === "string" ? skill.installHint : undefined,
          }),
        );
      }
    }

    return loaded;
  } catch {
    return [];
  }
}

function dedupSkills(skills: CliSkillDefinition[]): CliSkillDefinition[] {
  const map = new Map<string, CliSkillDefinition>();
  for (const skill of skills) {
    const key = skill.id.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const current = map.get(key);
    if (!current || (skill.priority || 0) >= (current.priority || 0)) {
      map.set(key, skill);
    }
  }

  return Array.from(map.values());
}

function normalizeCategoryHeader(value: string): string {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) {
    return "awesome-community";
  }
  return normalized
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9\s/-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "awesome-community";
}

function isLikelySkillLine(line: string): boolean {
  if (!/\s[-–—]\s/.test(line)) {
    return false;
  }

  if (/^#+\s/.test(line)) {
    return false;
  }

  if (/^\*\*/.test(line)) {
    return false;
  }

  return true;
}

function parseAwesomeSkillsFromMarkdown(markdown: string): CliSkillDefinition[] {
  const lines = markdown.split(/\r?\n/);
  let category = "awesome-community";
  const parsed: CliSkillDefinition[] = [];

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) {
      continue;
    }

    const headingMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headingMatch) {
      category = normalizeCategoryHeader(headingMatch[1]);
      continue;
    }

    if (line.startsWith("|")) {
      const cells = line.split("|").map((cell) => normalizeWhitespace(cell));
      if (cells.length >= 5) {
        const installNameCell = cells[2].replace(/`/g, "");
        const descriptionCell = cells[3];

        const installName = installNameCell.toLowerCase();
        if (
          installName &&
          installName !== "install name" &&
          descriptionCell &&
          descriptionCell.toLowerCase() !== "description"
        ) {
          const tags = extractKeywords(category, 3, 6);
          const triggers = extractKeywords(`${installName} ${descriptionCell}`, 3, 10);
          parsed.push(
            normalizeSkill({
              id: `awesome:${installName}`,
              name: installName,
              description: descriptionCell,
              category,
              source: "awesome-openclaw",
              triggers,
              tags,
              installHint: `npx clawhub@latest install ${installName}`,
              priority: 1,
            }),
          );
        }
      }
      continue;
    }

    const markdownLinkMatch = line.match(/^\s*(?:[-*]\s+)?\[(.+?)\]\(([^)]+)\)\s*[-–—]\s+(.+)$/);
    if (markdownLinkMatch) {
      const linkText = normalizeWhitespace(markdownLinkMatch[1]);
      const url = markdownLinkMatch[2];
      const description = normalizeWhitespace(markdownLinkMatch[3]);
      if (!description) {
        continue;
      }

      const slugFromUrl = url.match(/\/skills\/[^/]+\/([^/]+)\/SKILL\.md/i)?.[1];
      const slug = slugify((slugFromUrl || linkText).toLowerCase());
      const tags = extractKeywords(category, 3, 6);
      const triggers = extractKeywords(`${slug} ${description}`, 3, 10);

      parsed.push(
        normalizeSkill({
          id: `awesome:${slug}`,
          name: slug,
          description,
          category,
          source: "awesome-openclaw",
          triggers,
          tags,
          installHint: `npx clawhub@latest install ${slug}`,
          priority: 1,
        }),
      );
      continue;
    }

    if (!isLikelySkillLine(line)) {
      continue;
    }

    const skillMatch = line.match(/^\s*(?:[-*]\s+)?([a-z0-9][a-z0-9-]{1,120})\s*[-–—]\s+(.+)$/i);
    if (!skillMatch) {
      continue;
    }

    const slug = skillMatch[1].toLowerCase();
    const description = normalizeWhitespace(skillMatch[2]);
    if (!description) {
      continue;
    }

    if (description.toLowerCase().includes("table of contents")) {
      continue;
    }

    const tags = extractKeywords(category, 3, 6);
    const triggers = extractKeywords(`${slug} ${description}`, 3, 10);

    parsed.push(
      normalizeSkill({
        id: `awesome:${slug}`,
        name: slug,
        description,
        category,
        source: "awesome-openclaw",
        triggers,
        tags,
        installHint: `npx clawhub@latest install ${slug}`,
        priority: 1,
      }),
    );
  }

  return dedupSkills(parsed);
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "KHALIDAYAANY-CLI-Skills/1.0",
        accept: "text/plain,text/markdown;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadCliSkillsCatalog(): Promise<CliSkillsCatalog> {
  const state = await loadCliSkillsState();
  const [cache, custom, skillPacks] = await Promise.all([
    loadAwesomeSkillCache(),
    loadWorkspaceCustomSkills(),
    loadWorkspacePackSkills(),
  ]);

  const skills = dedupSkills([
    ...BUILTIN_SKILLS.map((skill) => normalizeSkill(skill)),
    ...skillPacks,
    ...(cache?.skills || []),
    ...custom,
  ]);

  return {
    skills,
    awesomeSyncedAt: cache?.syncedAt || state.awesomeCatalogLastSyncAt,
  };
}

export async function syncAwesomeOpenClawCatalog(): Promise<AwesomeCatalogSyncResult> {
  let lastError = "Unable to download awesome OpenClaw skills catalog.";
  let bestCandidate:
    | {
        sourceUrl: string;
        skills: CliSkillDefinition[];
      }
    | null = null;

  for (const sourceUrl of AWESOME_OPENCLAW_SOURCE_URLS) {
    try {
      const markdown = await fetchTextWithTimeout(sourceUrl, 15000);
      const parsed = parseAwesomeSkillsFromMarkdown(markdown);

      if (parsed.length < 50) {
        lastError = `Catalog from ${sourceUrl} looked incomplete (${parsed.length} entries).`;
        continue;
      }

      if (!bestCandidate || parsed.length > bestCandidate.skills.length) {
        bestCandidate = { sourceUrl, skills: parsed };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      lastError = `${sourceUrl}: ${message}`;
    }
  }

  if (bestCandidate) {
    const cache: AwesomeSkillCache = {
      syncedAt: new Date().toISOString(),
      sourceUrl: bestCandidate.sourceUrl,
      skills: bestCandidate.skills,
    };

    await saveAwesomeSkillCache(cache);
    await markAwesomeCatalogSync(bestCandidate.skills.length);

    const combinedCatalog = await loadCliSkillsCatalog();
    await writeJsonFile(WORKSPACE_ALL_SKILLS_FILE, {
      generatedAt: new Date().toISOString(),
      awesomeSourceUrl: bestCandidate.sourceUrl,
      awesomeImported: bestCandidate.skills.length,
      totalSkills: combinedCatalog.skills.length,
      skills: combinedCatalog.skills,
    });

    return {
      success: true,
      imported: bestCandidate.skills.length,
      sourceUrl: bestCandidate.sourceUrl,
      message: `Synced ${bestCandidate.skills.length} skills from awesome OpenClaw catalog.`,
    };
  }

  return {
    success: false,
    imported: 0,
    message: lastError,
  };
}

export async function searchCliSkills(query: string, max = 12): Promise<CliSkillDefinition[]> {
  const normalized = normalizeWhitespace(query.toLowerCase());
  const { skills } = await loadCliSkillsCatalog();

  if (!normalized) {
    return skills
      .slice()
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, Math.max(1, max));
  }

  const tokens = extractKeywords(normalized, 2, 16);

  const scored = skills
    .map((skill) => {
      let score = skill.priority || 0;
      const haystack = `${skill.id} ${skill.name} ${skill.description} ${skill.category}`.toLowerCase();

      if (haystack.includes(normalized)) {
        score += 9;
      }

      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 3;
        }
      }

      return { skill, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, max))
    .map((item) => item.skill);

  return scored;
}

export function getBuiltinCliSkillIds(): string[] {
  return BUILTIN_SKILLS.map((skill) => skill.id);
}
