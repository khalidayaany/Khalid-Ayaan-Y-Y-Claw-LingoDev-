import { updateCliSkillsState } from "./state.js";
import { relocateInstalledSkillsIntoCliSkills } from "./installed.js";

type CommandRunner = (command: string) => Promise<{
  exitCode: number | null;
  output: string;
  durationMs: number;
}>;

export interface CorePackInstallReport {
  success: boolean;
  steps: Array<{
    label: string;
    command: string;
    exitCode: number | null;
    outputTail: string;
  }>;
}

function tailOutput(value: string, maxChars = 280): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return trimmed.slice(trimmed.length - maxChars);
}

export async function installCoreCliSkillPacks(run: CommandRunner): Promise<CorePackInstallReport> {
  const commands: Array<{ label: string; command: string }> = [
    {
      label: "Install Vercel Agent Skills",
      command: "npx -y skills add vercel-labs/agent-skills",
    },
    {
      label: "Install Firecrawl Skill",
      command: "npx -y skills add firecrawl/cli -y -a codex",
    },
    {
      label: "Validate ClawHub CLI",
      command: "npx -y clawhub@latest --help",
    },
  ];

  const steps: CorePackInstallReport["steps"] = [];
  let success = true;

  for (const item of commands) {
    const result = await run(item.command);
    steps.push({
      label: item.label,
      command: item.command,
      exitCode: result.exitCode,
      outputTail: tailOutput(result.output),
    });

    if (result.exitCode !== 0) {
      success = false;
      break;
    }
  }

  if (success) {
    const relocation = await relocateInstalledSkillsIntoCliSkills();
    steps.push({
      label: "Relocate installed skills into Cli-Skills",
      command: "internal: relocateInstalledSkillsIntoCliSkills()",
      exitCode: relocation.success ? 0 : 1,
      outputTail: relocation.message,
    });
    if (!relocation.success) {
      success = false;
    }
  }

  if (success) {
    await updateCliSkillsState((current) => ({
      ...current,
      enabled: true,
    }));
  }

  return { success, steps };
}
