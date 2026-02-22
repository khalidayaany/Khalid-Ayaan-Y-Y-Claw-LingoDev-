export type FileSystemIntent =
  | {
      kind: "create-folder";
      path: string;
    }
  | {
      kind: "create-file";
      path: string;
    }
  | {
      kind: "write-file";
      path: string;
      content: string;
      mode: "overwrite" | "append";
    };

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function cleanPathToken(token: string): string {
  return stripQuotes(token.trim()).replace(/[.,;:!?]+$/g, "");
}

function hasPathShape(token: string): boolean {
  return /^(~\/|\/|\.\/|\.\.\/|[A-Za-z]:\\)/.test(token) || /[\\/]/.test(token) || /\.[A-Za-z0-9]+$/.test(token);
}

function firstPathCandidate(input: string): string | null {
  const quoted = input.match(/["']([^"']+)["']/g);
  if (quoted) {
    for (const q of quoted) {
      const candidate = cleanPathToken(q.slice(1, -1));
      if (hasPathShape(candidate)) {
        return candidate;
      }
    }
  }

  const tokens = input
    .split(/\s+/)
    .map((token) => cleanPathToken(token))
    .filter(Boolean);

  for (const token of tokens) {
    if (hasPathShape(token)) {
      return token;
    }
  }
  return null;
}

function isLikelyComplexTask(input: string): boolean {
  const lower = input.toLowerCase();
  if (input.includes("\n")) return true;
  if (/(^|\s)\d+\s*[-.)]/.test(input)) return true;
  if (/[。]|[|]/.test(input)) return true;
  if ((input.match(/[.,;:!?]/g) || []).length >= 3) return true;

  const complexWords = [
    "task",
    "complete",
    "project",
    "website",
    "build",
    "premium",
    "animation",
    "advanced",
  ];
  return complexWords.some((word) => lower.includes(word));
}

function extractExplicitFsIntent(input: string): FileSystemIntent | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const writeMatch = trimmed.match(/^\/?(?:fs\s+)?(write|append)\s+(.+?)\s*::\s*([\s\S]+)$/i);
  if (writeMatch) {
    const mode = writeMatch[1].toLowerCase() === "append" ? "append" : "overwrite";
    const path = cleanPathToken(writeMatch[2]);
    const content = writeMatch[3].trim();
    if (path && content) {
      return {
        kind: "write-file",
        path,
        content,
        mode,
      };
    }
  }

  const mkdirMatch = trimmed.match(/^\/?(?:fs\s+)?(?:mkdir|mkfolder|folder-create)\s+(.+)$/i);
  if (mkdirMatch) {
    const path = cleanPathToken(mkdirMatch[1]);
    if (path) {
      return { kind: "create-folder", path };
    }
  }

  const touchMatch = trimmed.match(/^\/?(?:fs\s+)?(?:touch|mkfile|file-create)\s+(.+)$/i);
  if (touchMatch) {
    const path = cleanPathToken(touchMatch[1]);
    if (path) {
      return { kind: "create-file", path };
    }
  }

  return null;
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function extractNaturalWriteIntent(input: string): FileSystemIntent | null {
  if (isLikelyComplexTask(input)) {
    return null;
  }

  const lower = input.toLowerCase();

  const path = firstPathCandidate(input);
  if (!path) {
    return null;
  }

  const writeKeywords = ["write", "save", "likho", "append"];
  if (!includesAny(lower, writeKeywords)) {
    return null;
  }

  if (input.includes("::")) {
    const split = input.split("::");
    if (split.length >= 2) {
      const content = split.slice(1).join("::").trim();
      if (!content) return null;
      const mode = /\bappend\b/i.test(lower) ? "append" : "overwrite";
      return { kind: "write-file", path, content, mode };
    }
  }

  const toPathRegex = /(?:write|save|likho|append)\s+([\s\S]+?)\s+(?:to|in|e|te)\s+([^\s]+)$/i;
  const toPathMatch = input.trim().match(toPathRegex);
  if (toPathMatch) {
    const content = stripQuotes(toPathMatch[1]).trim();
    const detectedPath = cleanPathToken(toPathMatch[2]);
    if (content && detectedPath) {
      const mode = /\bappend\b/i.test(lower) ? "append" : "overwrite";
      return { kind: "write-file", path: detectedPath, content, mode };
    }
  }

  return null;
}

function extractNaturalCreateIntent(input: string): FileSystemIntent | null {
  if (isLikelyComplexTask(input)) {
    return null;
  }

  const lower = input.toLowerCase();
  const path = firstPathCandidate(input);
  if (!path) {
    return null;
  }

  const folderWords = ["folder", "foder", "fodler", "directory", "mkdir"];
  const fileWords = ["file", "touch", ".md", ".txt", ".json", ".ts", ".tsx", ".js", ".jsx"];
  const createWords = ["create", "make", "banaw", "koro", "kor", "banai"];

  // Natural mode only supports short single-operation requests.
  const tokenCount = input.trim().split(/\s+/).length;
  if (tokenCount > 14) {
    return null;
  }

  if (includesAny(lower, folderWords) && includesAny(lower, createWords)) {
    return { kind: "create-folder", path };
  }

  if (includesAny(lower, fileWords) && includesAny(lower, createWords)) {
    return { kind: "create-file", path };
  }

  return null;
}

export function extractFileSystemIntent(input: string): FileSystemIntent | null {
  const explicit = extractExplicitFsIntent(input);
  if (explicit) {
    return explicit;
  }

  if (isLikelyComplexTask(input)) {
    return null;
  }

  const naturalWrite = extractNaturalWriteIntent(input);
  if (naturalWrite) {
    return naturalWrite;
  }

  const naturalCreate = extractNaturalCreateIntent(input);
  if (naturalCreate) {
    return naturalCreate;
  }

  return null;
}
