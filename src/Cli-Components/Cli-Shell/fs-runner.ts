import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import type { FileSystemIntent } from "./fs-intent.js";

export type FileSystemResult = {
  intent: FileSystemIntent["kind"];
  absolutePath: string;
  message: string;
};

function resolvePath(pathInput: string): string {
  const trimmed = pathInput.trim();
  if (!trimmed) {
    throw new Error("Path is empty.");
  }

  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return resolve(homedir(), trimmed.slice(2));
  }
  if (isAbsolute(trimmed)) {
    return resolve(trimmed);
  }
  return resolve(process.cwd(), trimmed);
}

export async function runFileSystemIntent(intent: FileSystemIntent): Promise<FileSystemResult> {
  const fs = await import("node:fs/promises");
  const absolutePath = resolvePath(intent.path);

  if (intent.kind === "create-folder") {
    await fs.mkdir(absolutePath, { recursive: true });
    return {
      intent: intent.kind,
      absolutePath,
      message: "Folder created",
    };
  }

  if (intent.kind === "create-file") {
    await fs.mkdir(dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "", { flag: "a" });
    return {
      intent: intent.kind,
      absolutePath,
      message: "File created",
    };
  }

  await fs.mkdir(dirname(absolutePath), { recursive: true });
  if (intent.mode === "append") {
    await fs.appendFile(absolutePath, intent.content, "utf-8");
  } else {
    await fs.writeFile(absolutePath, intent.content, "utf-8");
  }

  return {
    intent: intent.kind,
    absolutePath,
    message: intent.mode === "append" ? "File appended and saved" : "File written and saved",
  };
}

