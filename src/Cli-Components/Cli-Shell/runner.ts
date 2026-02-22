import { spawn } from "node:child_process";

export type CommandRunResult = {
  exitCode: number | null;
  output: string;
  durationMs: number;
};

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export async function runShellCommand(command: string, options: RunOptions = {}): Promise<CommandRunResult> {
  const start = Date.now();
  let output = "";

  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      options.onStdout?.(chunk);
    });

    child.stderr?.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      options.onStderr?.(chunk);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code,
        output,
        durationMs: Date.now() - start,
      });
    });
  });
}

