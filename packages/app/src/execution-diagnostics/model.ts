import type { StreamItem } from "@/types/stream";

export type Diagnosis = "tool" | "test" | "environment" | "auth" | "network" | "syntax" | "turn";
export interface ExecutionRow {
  id: string;
  turnId?: string;
  occurredAt?: number;
  command: string;
  evidence: string;
  status: "running" | "completed" | "failed" | "canceled";
  category: Diagnosis;
  durationMs?: number;
  timing: "reported" | "observed" | "unknown";
  slow: boolean;
  recoveredBy?: string;
}
export interface Observation {
  started: number;
  ended?: number;
  valid: boolean;
}
export const MAX_DIAGNOSTIC_ITEMS = 2000;

// Display copies only. Never alter provider results or persist command/output text.
export function redactEvidence(text: string): string {
  return text
    .replace(
      /("(?:password|passwd|token|api[_-]?key|secret|authorization|cookie)"\s*:\s*)"[^"\n]*"/gi,
      '$1"[redacted]"',
    )
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(
      /((?:password|passwd|token|api[_-]?key|secret|authorization|cookie)\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
      "$1[redacted]",
    )
    .replace(
      /(--(?:password|token|api-key|secret)\s+)(?:"[^"\n]*"|'[^'\n]*'|[^\s]+)/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/#(?:offer|connect)=[^\s]+/g, "#[redacted]");
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return "";
}
function category(text: string): Diagnosis {
  if (
    /command not found|no such file or directory|unexpected keyword argument|ModuleNotFoundError/i.test(
      text,
    )
  )
    return "environment";
  if (/oauth|unauthenticated|incorrect password|session expired|\b401\b|\b403\b/i.test(text))
    return "auth";
  if (/timed? ?out|ECONN|ENOTFOUND|fetch failed|network is unreachable/i.test(text))
    return "network";
  if (/syntax error|unknown option|no matches found|CLI_PARSE_ERROR/i.test(text)) return "syntax";
  if (/--- FAIL:|FAILURES|AssertionError|assertion failed|error TS\d+/i.test(text)) return "test";
  return "tool";
}

export function diagnosticIdentity(item: StreamItem): string {
  return `${item.timelineCursor?.epoch ?? "legacy"}:${item.id}`;
}

/** Bounded loaded history only; live-head copies replace historical copies of the same item. */
export function diagnosticItems(
  history: readonly StreamItem[],
  head: readonly StreamItem[],
): StreamItem[] {
  const map = new Map<string, StreamItem>();
  for (const item of [...history, ...head]) {
    if (item.kind !== "tool_call" && item.kind !== "notification") continue;
    map.set(diagnosticIdentity(item), item);
  }
  return Array.from(map.values())
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .slice(-MAX_DIAGNOSTIC_ITEMS);
}

export function observeExecutions(
  items: readonly StreamItem[],
  previous: ReadonlyMap<string, Observation>,
  now: number,
  continuous: boolean,
): Map<string, Observation> {
  const next = new Map<string, Observation>();
  for (const item of items) {
    if (item.kind !== "tool_call" || item.payload.source !== "agent") continue;
    const id = diagnosticIdentity(item);
    const old = previous.get(id);
    if (old)
      next.set(id, {
        ...old,
        valid: old.valid && (old.ended !== undefined || continuous),
        ended: old.ended ?? (item.payload.data.status !== "running" ? now : undefined),
      });
    else if (item.payload.data.status === "running")
      next.set(id, { started: now, valid: continuous });
  }
  return next;
}

export function analyzeExecutions(
  items: readonly StreamItem[],
  observations: ReadonlyMap<string, Observation> = new Map(),
  now = Date.now(),
): ExecutionRow[] {
  const rows: ExecutionRow[] = [];
  const pending = new Map<string, ExecutionRow[]>();
  for (const item of items) {
    const id = diagnosticIdentity(item);
    if (item.kind === "notification") {
      if (item.sourceType === "error")
        rows.push({
          id,
          turnId: item.turnId,
          occurredAt: item.timestamp.getTime(),
          command: "",
          evidence: redactEvidence(item.message).slice(0, 3000),
          status: "failed",
          category: "turn",
          timing: "unknown",
          slow: false,
        });
      continue;
    }
    if (item.kind !== "tool_call" || item.payload.source !== "agent") continue;
    const data = item.payload.data;
    const detail = data.detail;
    const command = detail.type === "shell" ? detail.command : data.name;
    const output =
      detail.type === "shell"
        ? (detail.output ?? "")
        : detail.type === "plain_text"
          ? (detail.text ?? "")
          : "";
    const exitCode = detail.type === "shell" ? detail.exitCode : undefined;
    const status =
      data.status === "completed" && typeof exitCode === "number" && exitCode !== 0
        ? "failed"
        : data.status;
    const text = `${errorText(data.error).slice(0, 8000)}\n${output.slice(
      0,
      8000,
    )}${output.length > 8000 ? "\n…\n" + output.slice(-8000) : ""}`.trim();
    const reported =
      detail.type === "search" || detail.type === "fetch"
        ? (detail.durationMs ??
          (detail.type === "search" && detail.durationSeconds !== undefined
            ? detail.durationSeconds * 1000
            : undefined))
        : undefined;
    const observed = observations.get(id);
    const durationMs =
      typeof reported === "number" && Number.isFinite(reported) && reported >= 0
        ? reported
        : observed?.valid
          ? Math.max(0, (observed.ended ?? now) - observed.started)
          : undefined;
    const row: ExecutionRow = {
      id,
      turnId: item.turnId,
      occurredAt: item.timestamp.getTime(),
      command: redactEvidence(command).slice(0, 1500),
      evidence: redactEvidence(
        `${typeof exitCode === "number" ? `exit ${exitCode}\n` : ""}${text}`,
      ).slice(-3000),
      status,
      category: category(text),
      durationMs,
      timing:
        durationMs === undefined ? "unknown" : reported !== undefined ? "reported" : "observed",
      slow: durationMs !== undefined && durationMs >= 30000,
    };
    rows.push(row);
    // Exact single shell commands only. Compound commands, missing turns and changed epochs
    // cannot establish a safe retry relationship. Success is not proof of a code fix.
    if (detail.type !== "shell" || !item.turnId || /[\n;&|<>]/.test(command) || !command.trim())
      continue;
    const signature = JSON.stringify([
      item.timelineCursor?.epoch ?? "legacy",
      item.turnId,
      detail.cwd ?? null,
      command,
    ]);
    if (status === "failed") pending.set(signature, [...(pending.get(signature) ?? []), row]);
    else if (status === "completed" && exitCode === 0) {
      for (const failure of pending.get(signature) ?? []) failure.recoveredBy = id;
      pending.delete(signature);
    }
  }
  return rows;
}
