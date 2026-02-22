const explicitPrefixes = ["/run ", "/cmd ", "/command ", "/shell ", "/sh "];

export type CommandIntent = {
  command: string;
  explicit: boolean;
};

function extractExplicitCommand(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("!")) {
    const command = trimmed.slice(1).trim();
    return command || null;
  }

  const lower = trimmed.toLowerCase();
  for (const prefix of explicitPrefixes) {
    if (lower.startsWith(prefix)) {
      const command = trimmed.slice(prefix.length).trim();
      return command || null;
    }
  }

  return null;
}

const implicitCommandStarters = new Set([
  "ls",
  "cd",
  "pwd",
  "cat",
  "echo",
  "grep",
  "rg",
  "find",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "rm",
  "chmod",
  "chown",
  "stat",
  "du",
  "df",
  "ps",
  "kill",
  "top",
  "htop",
  "git",
  "npm",
  "npx",
  "bun",
  "pnpm",
  "yarn",
  "node",
  "python",
  "python3",
  "pip",
  "pip3",
  "curl",
  "wget",
  "ssh",
  "scp",
  "docker",
  "docker-compose",
  "kubectl",
  "systemctl",
  "service",
  "journalctl",
  "make",
]);

function looksLikeImplicitCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("./")) return false;
  if (trimmed.includes("\n")) return false;

  const lowered = trimmed.toLowerCase();

  if (trimmed.startsWith("$ ")) return true;
  if (/[|&><]/.test(trimmed) && trimmed.split(/\s+/).length <= 24) return true;

  const first = lowered.split(/\s+/)[0];
  if (implicitCommandStarters.has(first)) return true;

  const hasShellShape =
    /^(\.\.?\/|~\/|\/)/.test(trimmed) ||
    /\b(--?[a-z0-9-]+)\b/.test(lowered);
  if (hasShellShape && implicitCommandStarters.has(first.replace(/^sudo\s+/, ""))) {
    return true;
  }

  if (first === "sudo") {
    const next = lowered.split(/\s+/)[1];
    if (next && implicitCommandStarters.has(next)) return true;
  }

  return false;
}

export function extractCommandIntent(input: string): CommandIntent | null {
  const explicit = extractExplicitCommand(input);
  if (explicit) {
    return { command: explicit, explicit: true };
  }

  if (looksLikeImplicitCommand(input)) {
    const command = input.trim().replace(/^\$\s*/, "");
    return { command, explicit: false };
  }

  return null;
}
