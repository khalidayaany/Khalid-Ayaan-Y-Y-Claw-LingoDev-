import { loadCliSkillsCatalog } from "./catalog.js";
import { loadCliSkillsState } from "./state.js";
import type {
  CliSkillDefinition,
  CliSkillMatch,
  CliSkillPlan,
  CliSkillsState,
} from "./types.js";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toPromptTokens(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 40);
  return new Set(tokens);
}

function inferIntentTags(promptLower: string): Set<string> {
  const intents = new Set<string>();

  const checks: Array<{ regex: RegExp; tags: string[] }> = [
    { regex: /\breact|next\.?js|component|frontend|ui|ux|css\b/, tags: ["frontend", "react", "design"] },
    { regex: /\bdeploy|production|vercel|launch|host|shipping\b/, tags: ["deploy", "devops", "workflow"] },
    { regex: /\bdebug|bug|error|failing|fix|issue\b/, tags: ["debugging", "quality"] },
    { regex: /\bopenclaw|clawdbot|clawhub|gateway|plugin\b/, tags: ["openclaw", "skills", "ops"] },
    { regex: /\bbrowser|automation|captcha|scrape|playwright|selenium\b/, tags: ["browser", "automation", "testing"] },
    { regex: /\bfirecrawl|crawl|scrape|extract|map|web[-\s]?data|structured data\b/, tags: ["scraping", "crawler", "web-data", "firecrawl"] },
    { regex: /\bgemini|google gemini|gemini api\b/, tags: ["gemini", "google", "api"] },
    { regex: /\bclaude|anthropic|frontend design\b/, tags: ["claude", "frontend", "design"] },
    { regex: /\bstitch|google stitch|shadcn\b/, tags: ["stitch", "google", "ui", "components"] },
    { regex: /\bapi|backend|database|sql|supabase|schema\b/, tags: ["backend", "database"] },
    { regex: /\bplan|workflow|roadmap|todo|task|multi\b/, tags: ["planning", "workflow", "execution"] },
  ];

  for (const check of checks) {
    if (!check.regex.test(promptLower)) {
      continue;
    }

    for (const tag of check.tags) {
      intents.add(tag);
    }
  }

  return intents;
}

function scoreSkill(
  skill: CliSkillDefinition,
  promptLower: string,
  promptTokens: Set<string>,
  intentTags: Set<string>,
  state: CliSkillsState,
): CliSkillMatch | null {
  if (state.blockedSkillIds.includes(skill.id)) {
    return null;
  }

  let score = skill.priority || 0;
  const reasons: string[] = [];

  const promptCompact = normalizeWhitespace(promptLower);
  for (const trigger of skill.triggers) {
    const normalized = normalizeWhitespace(trigger.toLowerCase());
    if (!normalized) {
      continue;
    }

    if (normalized.includes(" ")) {
      if (promptCompact.includes(normalized)) {
        score += 7;
        reasons.push(`trigger:${normalized}`);
      }
      continue;
    }

    if (promptTokens.has(normalized)) {
      score += 5;
      reasons.push(`keyword:${normalized}`);
    }
  }

  for (const tag of skill.tags) {
    if (intentTags.has(tag)) {
      score += 3;
      reasons.push(`intent:${tag}`);
    }
  }

  if (promptCompact.includes("firecrawl")) {
    const firecrawlMatch =
      skill.id.toLowerCase().includes("firecrawl") || skill.name.toLowerCase().includes("firecrawl");
    if (firecrawlMatch) {
      score += 10;
      reasons.push("firecrawl-match");
    }
  }

  const scrapeSignals = ["scrape", "crawl", "extract", "structured data", "map", "search web"];
  if (scrapeSignals.some((signal) => promptCompact.includes(signal)) && skill.tags.includes("scraping")) {
    score += 4;
    reasons.push("scrape-priority");
  }

  if (state.pinnedSkillIds.includes(skill.id)) {
    score += 10;
    reasons.push("pinned");
  }

  if (state.preferShipFaster && skill.source === "ship-faster") {
    score += 3;
    reasons.push("ship-faster-priority");
  }

  if (state.preferChiferMemory && skill.id.includes("chifer")) {
    score += 2;
    reasons.push("chifer-priority");
  }

  if (score <= 0) {
    return null;
  }

  return { skill, score, reasons };
}

function createDisabledPlan(catalogSize: number): CliSkillPlan {
  return {
    enabled: false,
    mode: "disabled",
    selected: [],
    traces: ["[SKILL] Auto skill routing is disabled."],
    catalogSize,
    syncedAt: undefined,
  };
}

function selectManualSkills(skills: CliSkillDefinition[], state: CliSkillsState): CliSkillMatch[] {
  const index = new Map(skills.map((skill) => [skill.id, skill]));
  const selected: CliSkillMatch[] = [];

  for (const skillId of state.pinnedSkillIds) {
    if (state.blockedSkillIds.includes(skillId)) {
      continue;
    }
    const skill = index.get(skillId);
    if (!skill) {
      continue;
    }

    selected.push({
      skill,
      score: (skill.priority || 0) + 12,
      reasons: ["manual-pin"],
    });
  }

  return selected;
}

function selectAutoSkills(skills: CliSkillDefinition[], prompt: string, state: CliSkillsState): CliSkillMatch[] {
  const promptLower = prompt.toLowerCase();
  const promptTokens = toPromptTokens(promptLower);
  const intentTags = inferIntentTags(promptLower);

  const matches = skills
    .map((skill) => scoreSkill(skill, promptLower, promptTokens, intentTags, state))
    .filter((item): item is CliSkillMatch => Boolean(item))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.skill.name.localeCompare(b.skill.name);
    });

  const selected = matches.slice(0, Math.max(1, state.maxAutoSkills));
  if (selected.length) {
    return selected;
  }

  if (state.preferShipFaster) {
    const fallback = skills.find((skill) => skill.id === "workflow-ship-faster");
    if (fallback) {
      return [
        {
          skill: fallback,
          score: (fallback.priority || 0) + 2,
          reasons: ["fallback:ship-faster"],
        },
      ];
    }
  }

  return [];
}

export async function resolveCliSkillPlan(prompt: string): Promise<CliSkillPlan> {
  const [state, catalog] = await Promise.all([loadCliSkillsState(), loadCliSkillsCatalog()]);
  const skills = catalog.skills;

  if (!state.enabled) {
    return createDisabledPlan(skills.length);
  }

  let selected: CliSkillMatch[] = [];
  if (state.selectionMode === "manual") {
    selected = selectManualSkills(skills, state);
    if (!selected.length) {
      selected = selectAutoSkills(skills, prompt, {
        ...state,
        selectionMode: "auto",
      });
    }
  } else {
    selected = selectAutoSkills(skills, prompt, state);
  }

  const traces: string[] = [];
  if (state.liveTraceEnabled) {
    traces.push(`[SKILL] mode=${state.selectionMode} catalog=${skills.length}`);
    if (!selected.length) {
      traces.push("[SKILL] no strong match, continuing without extra skill overlays");
    } else {
      const names = selected.map((item) => item.skill.id).join(", ");
      traces.push(`[SKILL] selected=${selected.length} -> ${names}`);
    }
  }

  return {
    enabled: true,
    mode: state.selectionMode,
    selected,
    traces,
    catalogSize: skills.length,
    syncedAt: catalog.awesomeSyncedAt,
  };
}

export function summarizeCliSkillPlan(plan: CliSkillPlan): string {
  if (!plan.enabled) {
    return "skills disabled";
  }

  if (!plan.selected.length) {
    return `skills active, no extra match (catalog ${plan.catalogSize})`;
  }

  return `skills ${plan.selected.map((item) => item.skill.id).join(", ")}`;
}
