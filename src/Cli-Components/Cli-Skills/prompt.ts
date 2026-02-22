import type { CliSkillPlan } from "./types.js";

function trimLine(value: string, max = 140): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

export function buildCliSkillsExecutionPrompt(
  basePrompt: string,
  plan: CliSkillPlan,
  options: { chiferEnabled: boolean; shipFasterCarryoverEnabled: boolean },
): string {
  if (!plan.enabled || !plan.selected.length) {
    return basePrompt;
  }

  const lines: string[] = [];
  lines.push("[KHALIDAYAAN Y CLI-SKILLS RUNTIME]");
  lines.push("Apply selected skills as concrete execution guidance for this task.");
  lines.push(`Selection mode: ${plan.mode}`);
  lines.push(`Catalog size: ${plan.catalogSize}`);

  lines.push("Active skills:");
  for (const match of plan.selected.slice(0, 6)) {
    const entry = `${match.skill.id} (${match.skill.source}) :: ${trimLine(match.skill.description, 110)}`;
    lines.push(`- ${entry}`);
  }

  lines.push("Execution policy:");
  lines.push("- Keep output grounded to selected skill guidance and current user intent.");
  lines.push("- If workflow/ship-faster skills are selected, execute plan -> implement -> verify.");
  lines.push("- Workspace safety policy: treat workspace as read-only except AI-AI/ folder.");
  lines.push("- Never create/move/delete files outside AI-AI/ inside workspace.");
  lines.push("- Never run download/install actions unless user explicitly says allow download.");
  if (options.shipFasterCarryoverEnabled) {
    lines.push("- Ship-Faster carryover is enabled: continue unfinished tasks from recent session context.");
  }
  if (options.chiferEnabled) {
    lines.push("- Chifer MCP memory is enabled: use prior memory context when relevant.");
  }
  lines.push("- Do not claim tools/actions that were not actually executed.");

  return `${basePrompt}\n\n${lines.join("\n")}`;
}
