#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

type EvalCase = {
  id: string;
  prompt: string;
  mustInclude?: string[];
  mustNotInclude?: string[];
  minLength?: number;
  notes?: string;
};

type EvalCaseResult = {
  id: string;
  passed: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  responseLength: number;
  reasons: string[];
};

type EvalRun = {
  id: string;
  at: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  threshold: number;
  regressionDelta: number;
  regressed: boolean;
  blocked: boolean;
  results: EvalCaseResult[];
};

type EvalGateState = {
  blocked: boolean;
  lastRunId?: string;
  passRate?: number;
  previousPassRate?: number;
  regressionDelta?: number;
  threshold: number;
  updatedAt: string;
};

type EvalModelLeaderboard = {
  provider: string;
  model: string;
  runs: number;
  passRate: number;
  avgLatencyMs: number;
};

const STORE_DIR = join(homedir(), ".hakathone", "store");
const EVAL_DIR = join(STORE_DIR, "eval-harness");
const EVAL_CASES_FILE = join(EVAL_DIR, "cases.json");
const EVAL_RUNS_FILE = join(EVAL_DIR, "runs.jsonl");
const EVAL_GATE_FILE = join(EVAL_DIR, "gate.json");

function nowIso(): string {
  return new Date().toISOString();
}

function defaultEvalCases(): EvalCase[] {
  return [
    {
      id: "router-budget-policy",
      prompt: "Explain a budget-aware AI routing policy in 5 bullets.",
      mustInclude: ["budget", "routing"],
      minLength: 120,
    },
    {
      id: "safe-shell-guidance",
      prompt: "Give safe shell command guidance and explicitly avoid destructive commands.",
      mustInclude: ["safe", "avoid"],
      mustNotInclude: ["rm -rf /"],
      minLength: 90,
    },
    {
      id: "incident-response",
      prompt: "Write a concise incident response checklist for rollback.",
      mustInclude: ["rollback", "incident"],
      minLength: 100,
    },
  ];
}

function defaultGateState(): EvalGateState {
  return {
    blocked: false,
    threshold: 0.08,
    updatedAt: nowIso(),
  };
}

async function ensureEvalDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(EVAL_DIR, { recursive: true });
}

export async function ensureEvalHarnessFiles(): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureEvalDir();
  try {
    await fs.access(EVAL_CASES_FILE);
  } catch {
    await fs.writeFile(EVAL_CASES_FILE, JSON.stringify(defaultEvalCases(), null, 2), "utf-8");
  }
  try {
    await fs.access(EVAL_GATE_FILE);
  } catch {
    await fs.writeFile(EVAL_GATE_FILE, JSON.stringify(defaultGateState(), null, 2), "utf-8");
  }
}

export async function loadEvalCases(): Promise<EvalCase[]> {
  const fs = await import("node:fs/promises");
  await ensureEvalHarnessFiles();
  try {
    const raw = await fs.readFile(EVAL_CASES_FILE, "utf-8");
    const parsed = JSON.parse(raw) as EvalCase[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.prompt === "string")
      : [];
  } catch {
    return [];
  }
}

export async function saveEvalCases(cases: EvalCase[]): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureEvalDir();
  await fs.writeFile(EVAL_CASES_FILE, JSON.stringify(cases, null, 2), "utf-8");
}

function evaluateCaseResult(caseDef: EvalCase, output: string): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const text = output || "";
  const lower = text.toLowerCase();

  if (caseDef.minLength && text.length < caseDef.minLength) {
    reasons.push(`too short (${text.length} < ${caseDef.minLength})`);
  }

  for (const needle of caseDef.mustInclude || []) {
    if (!lower.includes(needle.toLowerCase())) {
      reasons.push(`missing: ${needle}`);
    }
  }

  for (const blocked of caseDef.mustNotInclude || []) {
    if (lower.includes(blocked.toLowerCase())) {
      reasons.push(`forbidden: ${blocked}`);
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

async function loadRecentEvalRuns(limit = 60): Promise<EvalRun[]> {
  const fs = await import("node:fs/promises");
  try {
    const raw = await fs.readFile(EVAL_RUNS_FILE, "utf-8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit);
    const runs: EvalRun[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as EvalRun;
        if (parsed && typeof parsed.id === "string") {
          runs.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return runs;
  } catch {
    return [];
  }
}

async function appendEvalRun(run: EvalRun): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureEvalDir();
  await fs.appendFile(EVAL_RUNS_FILE, `${JSON.stringify(run)}\n`, "utf-8");
}

export async function loadEvalGateState(): Promise<EvalGateState> {
  const fs = await import("node:fs/promises");
  await ensureEvalHarnessFiles();
  try {
    const raw = await fs.readFile(EVAL_GATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<EvalGateState>;
    return {
      blocked: Boolean(parsed.blocked),
      lastRunId: parsed.lastRunId,
      passRate: Number.isFinite(parsed.passRate) ? Number(parsed.passRate) : undefined,
      previousPassRate: Number.isFinite(parsed.previousPassRate) ? Number(parsed.previousPassRate) : undefined,
      regressionDelta: Number.isFinite(parsed.regressionDelta) ? Number(parsed.regressionDelta) : undefined,
      threshold:
        Number.isFinite(parsed.threshold) && Number(parsed.threshold) > 0
          ? Number(parsed.threshold)
          : defaultGateState().threshold,
      updatedAt: parsed.updatedAt || nowIso(),
    };
  } catch {
    return defaultGateState();
  }
}

export async function saveEvalGateState(state: EvalGateState): Promise<void> {
  const fs = await import("node:fs/promises");
  await ensureEvalDir();
  await fs.writeFile(
    EVAL_GATE_FILE,
    JSON.stringify(
      {
        ...state,
        updatedAt: nowIso(),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

export async function clearEvalGateBlock(): Promise<EvalGateState> {
  const state = await loadEvalGateState();
  state.blocked = false;
  await saveEvalGateState(state);
  return state;
}

export async function runEvalHarness(params: {
  execute: (testCase: EvalCase) => Promise<{
    output: string;
    provider: string;
    model: string;
    latencyMs: number;
  }>;
  threshold?: number;
}): Promise<EvalRun> {
  const cases = await loadEvalCases();
  if (!cases.length) {
    throw new Error(`No eval cases found. Add cases in ${EVAL_CASES_FILE}`);
  }

  const previousRuns = await loadRecentEvalRuns(2);
  const previous = previousRuns[previousRuns.length - 1];
  const gate = await loadEvalGateState();
  const threshold = Number.isFinite(params.threshold) && Number(params.threshold) > 0
    ? Number(params.threshold)
    : gate.threshold;

  const results: EvalCaseResult[] = [];
  for (const testCase of cases) {
    const start = Date.now();
    const execution = await params.execute(testCase);
    const latencyMs = Math.max(0, execution.latencyMs || Date.now() - start);
    const evalResult = evaluateCaseResult(testCase, execution.output || "");
    results.push({
      id: testCase.id,
      passed: evalResult.passed,
      provider: execution.provider,
      model: execution.model,
      latencyMs,
      responseLength: (execution.output || "").length,
      reasons: evalResult.reasons,
    });
  }

  const total = results.length;
  const passed = results.filter((item) => item.passed).length;
  const failed = total - passed;
  const passRate = total ? passed / total : 0;
  const previousPassRate = previous?.passRate ?? passRate;
  const regressionDelta = previousPassRate - passRate;
  const regressed = Boolean(previous) && regressionDelta >= threshold;
  const blocked = regressed;

  const run: EvalRun = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: nowIso(),
    total,
    passed,
    failed,
    passRate,
    threshold,
    regressionDelta,
    regressed,
    blocked,
    results,
  };

  await appendEvalRun(run);
  await saveEvalGateState({
    blocked,
    lastRunId: run.id,
    passRate,
    previousPassRate,
    regressionDelta,
    threshold,
    updatedAt: nowIso(),
  });

  return run;
}

export async function loadEvalLeaderboard(limit = 8): Promise<EvalModelLeaderboard[]> {
  const runs = await loadRecentEvalRuns(120);
  const byModel = new Map<string, EvalModelLeaderboard>();

  for (const run of runs) {
    for (const result of run.results || []) {
      const key = `${result.provider}:${result.model}`;
      const existing = byModel.get(key);
      if (!existing) {
        byModel.set(key, {
          provider: result.provider,
          model: result.model,
          runs: 1,
          passRate: result.passed ? 1 : 0,
          avgLatencyMs: result.latencyMs,
        });
        continue;
      }

      const nextRuns = existing.runs + 1;
      existing.passRate = ((existing.passRate * existing.runs) + (result.passed ? 1 : 0)) / nextRuns;
      existing.avgLatencyMs = ((existing.avgLatencyMs * existing.runs) + result.latencyMs) / nextRuns;
      existing.runs = nextRuns;
    }
  }

  return Array.from(byModel.values())
    .sort((a, b) => b.passRate - a.passRate || a.avgLatencyMs - b.avgLatencyMs)
    .slice(0, limit);
}

export async function loadEvalTrend(limit = 6): Promise<EvalRun[]> {
  const runs = await loadRecentEvalRuns(limit);
  return runs;
}

export function formatEvalRunSummary(run: EvalRun): string[] {
  const passPct = `${(run.passRate * 100).toFixed(1)}%`;
  const deltaPct = `${(run.regressionDelta * 100).toFixed(1)}%`;
  return [
    `Eval run: ${run.id}`,
    `Total: ${run.total} | Passed: ${run.passed} | Failed: ${run.failed}`,
    `Pass rate: ${passPct}`,
    `Regression delta vs previous: ${deltaPct} (threshold ${(run.threshold * 100).toFixed(1)}%)`,
    `Regression gate: ${run.blocked ? "BLOCKED" : "clear"}`,
  ];
}

export function getEvalCasesFilePath(): string {
  return EVAL_CASES_FILE;
}

export type { EvalCase, EvalGateState, EvalModelLeaderboard, EvalRun };

