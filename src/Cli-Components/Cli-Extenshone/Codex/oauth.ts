import { spawn } from "node:child_process";
import { loadCodexToken, type CodexToken } from "./codex.js";

export type CodexOAuthResult = {
  token: CodexToken;
};

function runCodexCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex ${args.join(" ")} failed with exit code ${code}`));
      }
    });
  });
}

export async function loginCodexOAuth(params: {
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (message: string) => void; stop: (message?: string) => void };
}): Promise<CodexOAuthResult> {
  await params.note(
    [
      "Real Codex authentication uses your installed `codex` CLI login.",
      "A browser login prompt may open. Complete it, then return to terminal.",
    ].join("\n"),
    "Codex OAuth",
  );

  params.progress.update("Starting Codex login...");
  await runCodexCommand(["login"]);

  params.progress.update("Verifying Codex auth...");
  const token = await loadCodexToken();
  if (!token) {
    throw new Error("Codex login finished but no authenticated session found in ~/.codex/auth.json");
  }

  params.progress.stop("Codex OAuth complete");
  return { token };
}

export async function logoutCodexOAuth(): Promise<void> {
  await runCodexCommand(["logout"]);
}
