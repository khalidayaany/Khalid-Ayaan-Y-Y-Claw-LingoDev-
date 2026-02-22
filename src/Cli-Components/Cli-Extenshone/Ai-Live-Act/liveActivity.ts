const gray = "\x1b[90m";
const cyan = "\x1b[38;2;34;211;238m";
const reset = "\x1b[0m";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class AiLiveActivity {
  private frameIndex = 0;
  private message = "Preparing request";
  private actor = "System";
  private lastTrace = "";
  private lastTraceAt = 0;
  private detail = "";
  private agentStatuses = new Map<string, string>();
  private running = false;
  private lastRenderAt = 0;
  private renderedLineCount = 0;
  private queuedRender?: ReturnType<typeof setTimeout>;

  start(initialMessage = "Preparing request", actor = "System"): void {
    this.running = true;
    this.message = initialMessage;
    this.actor = actor;
    this.detail = "";
    this.render(true);
  }

  setActor(actor: string): void {
    const normalized = actor || "System";
    if (normalized === this.actor) {
      return;
    }
    this.actor = normalized;
    this.render();
  }

  set(message: string): void {
    if (message === this.message) {
      return;
    }
    this.message = message;
    this.render();
  }

  trace(message: string): void {
    const normalized = (message || "").trim();
    if (!normalized) return;

    const now = Date.now();
    if (normalized === this.lastTrace && now - this.lastTraceAt < 400) {
      return;
    }

    this.lastTrace = normalized;
    this.lastTraceAt = now;
    this.detail = normalized;
    this.render();
  }

  setAgentStatus(agentName: string, status: string): void {
    const name = (agentName || "").trim();
    const text = (status || "").trim();
    if (!name) return;

    const existing = this.agentStatuses.get(name);
    if (existing === text) {
      return;
    }
    this.agentStatuses.set(name, text || "working");
    this.render();
  }

  clearAgentStatuses(): void {
    if (!this.agentStatuses.size) return;
    this.agentStatuses.clear();
    this.render();
  }

  stop(finalMessage?: string): void {
    this.running = false;
    if (this.queuedRender) {
      clearTimeout(this.queuedRender);
      this.queuedRender = undefined;
    }
    this.clearRenderedBlock();
    this.agentStatuses.clear();
    this.detail = "";
    if (finalMessage) {
      process.stdout.write(`${gray}${finalMessage}${reset}\n`);
    }
  }

  private render(force = false): void {
    if (!this.running && !force) {
      return;
    }

    const now = Date.now();
    const minRenderIntervalMs = 75;
    const elapsed = now - this.lastRenderAt;
    if (!force && elapsed < minRenderIntervalMs) {
      if (!this.queuedRender) {
        const waitMs = minRenderIntervalMs - elapsed;
        this.queuedRender = setTimeout(() => {
          this.queuedRender = undefined;
          this.render();
        }, waitMs);
      }
      return;
    }

    this.lastRenderAt = now;
    this.frameIndex = (this.frameIndex + 1) % frames.length;
    const frame = frames[this.frameIndex];
    const actorLabel = this.trim(this.actor, 24);
    let compactMessage = this.trim(this.message, 110);
    const compactDetail = this.trim(this.detail, 90);
    const statusSummary = this.buildStatusSummary();
    const segments = [statusSummary, compactDetail].filter(Boolean);
    const maxColumns = Math.max(40, (process.stdout.columns || 120) - 2);
    const buildPlainLine = (parts: string[]) => {
      const suffixPlain = parts.length ? ` | ${parts.join(" | ")}` : "";
      return `${frame} ${actorLabel} > ${compactMessage}${suffixPlain}`;
    };
    while (segments.length && buildPlainLine(segments).length > maxColumns) {
      segments.pop();
    }
    const lineWithoutTrim = buildPlainLine(segments);
    if (lineWithoutTrim.length > maxColumns) {
      const overflow = lineWithoutTrim.length - maxColumns;
      compactMessage = this.trim(compactMessage, Math.max(12, compactMessage.length - overflow - 1));
    }
    const suffix = segments.length ? ` ${gray}| ${segments.join(" | ")}${reset}` : "";
    this.paintLines([`${gray}${frame} ${cyan}${actorLabel}${reset} ${gray}> ${compactMessage}${reset}${suffix}`]);
  }

  private buildStatusSummary(): string {
    if (!this.agentStatuses.size) {
      return "";
    }

    const parts: string[] = [];
    for (const [name, status] of this.agentStatuses) {
      if (parts.length >= 4) break;
      const key = this.trim(name, 10);
      const value = this.trim(status || "", 42);
      if (!value) continue;
      parts.push(`${key}:${value}`);
    }

    return parts.join(" | ");
  }

  private trim(value: string, maxChars: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return `${normalized.slice(0, maxChars - 3)}...`;
  }

  private clearRenderedBlock(): void {
    if (this.renderedLineCount <= 0) {
      return;
    }

    process.stdout.write("\r");
    for (let i = 0; i < this.renderedLineCount; i += 1) {
      process.stdout.write("\x1b[2K");
      if (i < this.renderedLineCount - 1) {
        process.stdout.write("\x1b[1A");
      }
    }
    process.stdout.write("\r");
    this.renderedLineCount = 0;
  }

  private paintLines(lines: string[]): void {
    this.clearRenderedBlock();

    for (let i = 0; i < lines.length; i += 1) {
      process.stdout.write(`\x1b[2K${lines[i]}`);
      if (i < lines.length - 1) {
        process.stdout.write("\n");
      }
    }
    this.renderedLineCount = lines.length;
  }
}
