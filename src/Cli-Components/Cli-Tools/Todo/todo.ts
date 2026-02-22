#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

export type TodoTaskStatus = "pending" | "in_progress" | "completed" | "failed";

export type TodoTask = {
  id: number;
  title: string;
  status: TodoTaskStatus;
  notes: string[];
  startedAt?: string;
  completedAt?: string;
};

export type TodoRunState = "active" | "completed" | "failed";

export type TodoRun = {
  runId: string;
  objective: string;
  createdAt: string;
  updatedAt: string;
  state: TodoRunState;
  tasks: TodoTask[];
  stateFile: string;
  logFile: string;
};

const TODO_STORE_DIR = join(homedir(), ".hakathone", "store", "todo-runs");

function nowIso(): string {
  return new Date().toISOString();
}

function trimLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "task";
}

function dedupeTasks(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const cleaned = trimLine(raw).replace(/^[\-\d.()\s]+/, "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function parseStructuredTasks(prompt: string): string[] {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const numbered = lines
    .filter((line) => /^(\d+\s*[-.)]|[-*•])\s+/.test(line))
    .map((line) => line.replace(/^(\d+\s*[-.)]|[-*•])\s+/, ""));

  if (numbered.length >= 2) {
    return numbered;
  }

  return [];
}

function fallbackTasks(prompt: string): string[] {
  const base = [
    "Read the request and keep only explicit user tasks",
    "Execute requested tasks in order without adding extra work",
    "Finish and return done",
  ];

  return base;
}

export function deriveTodoTasksFromPrompt(prompt: string): string[] {
  const structured = parseStructuredTasks(prompt);
  if (structured.length) {
    return dedupeTasks(structured).slice(0, 14);
  }

  const splitByConnectors = prompt
    .split(/(?:\bthen\b|\band then\b|\bafter that\b|\btar pore\b|\ber por\b|\bthen\s*,|\.)/gi)
    .map((part) => trimLine(part))
    .filter((part) => part.length >= 20);

  if (splitByConnectors.length >= 2) {
    return dedupeTasks(splitByConnectors).slice(0, 12);
  }

  return dedupeTasks(fallbackTasks(prompt));
}

export function isLargeTaskPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  const tokenCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  const actionKeywords = [
    "create",
    "build",
    "setup",
    "implement",
    "make",
    "fix",
    "refactor",
    "generate",
    "deploy",
    "project",
    "website",
    "application",
    "next.js",
    "full",
    "complete",
    "compelate",
    "task",
  ];

  const actionHits = actionKeywords.reduce((acc, keyword) => (lower.includes(keyword) ? acc + 1 : acc), 0);
  const hasStructuredList = /(^|\n)\s*\d+\s*[-.)]/.test(prompt);
  const hasMultiStepWords =
    /\b(and then|after that|step|steps|phase|phases|inside|within|tar pore|er por|modde)\b/i.test(prompt);

  return actionHits >= 3 && (tokenCount >= 25 || hasStructuredList || hasMultiStepWords);
}

function statusIcon(status: TodoTaskStatus): string {
  if (status === "completed") return "x";
  if (status === "in_progress") return ">";
  if (status === "failed") return "!";
  return " ";
}

function markdownChecklist(run: TodoRun): string {
  const rows = run.tasks.map((task) => `- [${statusIcon(task.status)}] ${task.id}. ${task.title}`);
  return rows.join("\n");
}

async function persistRun(run: TodoRun): Promise<void> {
  const fs = await import("node:fs/promises");
  run.updatedAt = nowIso();
  await fs.writeFile(run.stateFile, JSON.stringify(run, null, 2), "utf-8");
}

async function initializeRunLog(run: TodoRun): Promise<void> {
  const fs = await import("node:fs/promises");
  const header = [
    `# Todo Run ${run.runId}`,
    "",
    `- State: ${run.state}`,
    `- Created: ${run.createdAt}`,
    `- Updated: ${run.updatedAt}`,
    "",
    "## Objective",
    run.objective,
    "",
    "## Checklist",
    markdownChecklist(run),
    "",
  ].join("\n");

  await fs.writeFile(run.logFile, header, "utf-8");
}

export async function ensureTodoStore(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(TODO_STORE_DIR, { recursive: true });
}

export async function createTodoRun(objective: string, tasksInput: string[]): Promise<TodoRun> {
  await ensureTodoStore();
  const tasks = dedupeTasks(tasksInput).slice(0, 16);
  const finalTasks = tasks.length ? tasks : fallbackTasks(objective);

  const createdAt = nowIso();
  const runId = `${Date.now()}-${slugify(finalTasks[0] || objective)}`;
  const stateFile = join(TODO_STORE_DIR, `${runId}.json`);
  const logFile = join(TODO_STORE_DIR, `${runId}.md`);

  const run: TodoRun = {
    runId,
    objective: trimLine(objective),
    createdAt,
    updatedAt: createdAt,
    state: "active",
    stateFile,
    logFile,
    tasks: finalTasks.map((title, index) => ({
      id: index + 1,
      title,
      status: "pending",
      notes: [],
    })),
  };

  await persistRun(run);
  await initializeRunLog(run);
  return run;
}

export async function loadTodoRun(runId: string): Promise<TodoRun | null> {
  const fs = await import("node:fs/promises");
  await ensureTodoStore();
  const path = join(TODO_STORE_DIR, `${runId}.json`);
  try {
    const raw = await fs.readFile(path, "utf-8");
    return JSON.parse(raw) as TodoRun;
  } catch {
    return null;
  }
}

export async function appendTodoRunLog(runId: string, text: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const run = await loadTodoRun(runId);
  if (!run) return;
  const body = [`## ${nowIso()}`, trimLine(text), ""].join("\n");
  await fs.appendFile(run.logFile, body, "utf-8");
}

export async function setTodoTaskStatus(
  runId: string,
  taskId: number,
  status: TodoTaskStatus,
  note?: string,
): Promise<TodoRun | null> {
  const run = await loadTodoRun(runId);
  if (!run) return null;

  const task = run.tasks.find((item) => item.id === taskId);
  if (!task) return run;

  task.status = status;
  if (status === "in_progress") {
    task.startedAt = nowIso();
  }
  if (status === "completed" || status === "failed") {
    task.completedAt = nowIso();
  }
  if (note) {
    const trimmed = trimLine(note).slice(0, 320);
    if (trimmed) {
      task.notes.push(trimmed);
    }
  }

  const failed = run.tasks.some((item) => item.status === "failed");
  const allDone = run.tasks.every((item) => item.status === "completed");
  run.state = failed ? "failed" : allDone ? "completed" : "active";

  await persistRun(run);

  const stateText = `${status.toUpperCase()} | Step ${task.id}: ${task.title}`;
  await appendTodoRunLog(runId, note ? `${stateText}\n${note}` : stateText);
  return run;
}

export function buildTodoPlannerPrompt(objective: string): string {
  return [
    "You are preparing an execution todo plan for a coding task.",
    "Break the objective into small actionable steps that can be completed one by one.",
    "Do not execute yet. Planning only.",
    "",
    "Output format requirement:",
    "Return ONLY strict JSON with this shape:",
    '{"tasks":["step 1", "step 2", "step 3"]}',
    "",
    "Rules:",
    "- 2 to 8 steps only",
    "- Include only tasks explicitly asked by user",
    "- Do not add verification/testing/docs unless explicitly requested",
    "- No extra enhancements",
    "",
    "Objective:",
    objective,
  ].join("\n");
}

export function buildTodoExecutionPrompt(run: TodoRun, task: TodoTask): string {
  const completed = run.tasks.filter((item) => item.status === "completed");
  const failed = run.tasks.filter((item) => item.status === "failed");

  const completedText =
    completed.length > 0
      ? completed.map((item) => `- ${item.id}. ${item.title}`).join("\n")
      : "- none";

  const failedText =
    failed.length > 0
      ? failed.map((item) => `- ${item.id}. ${item.title}`).join("\n")
      : "- none";

  return [
    "You are executing a single todo step for a larger coding objective.",
    "Perform real filesystem changes and commands when required.",
    "Do only the current step in this run.",
    "",
    "Objective:",
    run.objective,
    "",
    "Already completed steps:",
    completedText,
    "",
    "Failed steps so far:",
    failedText,
    "",
    `Current step (${task.id}/${run.tasks.length}):`,
    task.title,
    "",
    "Execution rules:",
    "- Execute concrete actions, do not just describe",
    "- Do not repeat already completed steps",
    "- Do not add extra tasks outside user request",
    "- If blocked, return exact blocker and exact retry command",
    "- If success and user did not ask details: final response must be exactly done",
    "",
    "Return plain terminal text only with:",
    "1) What was executed",
    "2) Key evidence/output",
    "3) Next immediate step",
  ].join("\n");
}

export function formatTodoProgress(run: TodoRun): string {
  const total = run.tasks.length;
  const completed = run.tasks.filter((task) => task.status === "completed").length;
  const failed = run.tasks.filter((task) => task.status === "failed").length;
  const inProgress = run.tasks.filter((task) => task.status === "in_progress").length;
  return `Todo ${completed}/${total} completed | in_progress ${inProgress} | failed ${failed}`;
}

export function getTodoStorePath(): string {
  return TODO_STORE_DIR;
}
