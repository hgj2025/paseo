import { toolCallDisplayOutcome } from "@/tool-calls/outcome";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
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
  noMatches?: boolean;
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

function extractDetailOutput(detail: ToolCallDetail): string {
  if (detail.type === "shell") return detail.output ?? "";
  if (detail.type === "plain_text") return detail.text ?? "";
  return "";
}

function extractReportedDuration(detail: ToolCallDetail): number | undefined {
  if (detail.type !== "search" && detail.type !== "fetch") {
    return undefined;
  }
  if (detail.durationMs !== undefined) {
    return detail.durationMs;
  }
  if (detail.type === "search" && detail.durationSeconds !== undefined) {
    return detail.durationSeconds * 1000;
  }
  return undefined;
}

function resolveDurationAndTiming(
  reported: number | undefined,
  observed: Observation | undefined,
  now: number,
): { durationMs?: number; timing: ExecutionRow["timing"] } {
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return { durationMs: reported, timing: "reported" };
  }
  if (observed?.valid) {
    return {
      durationMs: Math.max(0, (observed.ended ?? now) - observed.started),
      timing: "observed",
    };
  }
  return { durationMs: undefined, timing: "unknown" };
}

function formatEvidenceText(error: unknown, output: string): string {
  const truncatedOutput =
    output.length > 8000 ? `${output.slice(0, 8000)}\n…\n${output.slice(-8000)}` : output;
  return `${errorText(error).slice(0, 8000)}\n${truncatedOutput}`.trim();
}

function recordShellRetry(
  item: Extract<StreamItem, { kind: "tool_call" }>,
  row: ExecutionRow,
  pending: Map<string, ExecutionRow[]>,
): void {
  if (item.payload.source !== "agent") return;
  const { detail } = item.payload.data;
  if (detail.type !== "shell" || !item.turnId) return;
  const command = detail.command;
  if (/[\n;&|<>]/.test(command) || !command.trim()) return;
  const signature = JSON.stringify([
    item.timelineCursor?.epoch ?? "legacy",
    item.turnId,
    detail.cwd ?? null,
    command,
  ]);
  if (row.status === "failed") {
    pending.set(signature, [...(pending.get(signature) ?? []), row]);
    return;
  }
  if (row.status === "completed" && detail.exitCode === 0) {
    for (const failure of pending.get(signature) ?? []) failure.recoveredBy = row.id;
    pending.delete(signature);
  }
}

function buildAgentToolCallRow(
  item: Extract<StreamItem, { kind: "tool_call" }>,
  id: string,
  observed: Observation | undefined,
  now: number,
): ExecutionRow | null {
  if (item.payload.source !== "agent") return null;
  const data = item.payload.data;
  const detail = data.detail;
  const command = detail.type === "shell" ? detail.command : data.name;
  const output = extractDetailOutput(detail);
  const exitCode = detail.type === "shell" ? detail.exitCode : undefined;
  const outcome = toolCallDisplayOutcome({ status: data.status, detail, error: data.error });
  const status = outcome.status === "executing" ? "running" : outcome.status;
  const text = formatEvidenceText(data.error, output);
  const { durationMs, timing } = resolveDurationAndTiming(
    extractReportedDuration(detail),
    observed,
    now,
  );
  const exitPrefix = typeof exitCode === "number" ? `exit ${exitCode}\n` : "";
  return {
    id,
    turnId: item.turnId,
    occurredAt: item.timestamp.getTime(),
    command: redactEvidence(command).slice(0, 1500),
    evidence: redactEvidence(`${exitPrefix}${text}`).slice(-3000),
    status,
    category: category(text),
    ...(outcome.noMatches ? { noMatches: true } : {}),
    durationMs,
    timing,
    slow: durationMs !== undefined && durationMs >= 30000,
  };
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
      if (item.sourceType === "error") {
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
      }
      continue;
    }
    if (item.kind !== "tool_call") continue;
    const row = buildAgentToolCallRow(item, id, observations.get(id), now);
    if (!row) continue;
    rows.push(row);
    // Exact single shell commands only. Compound commands, missing turns and changed epochs
    // cannot establish a safe retry relationship. Success is not proof of a code fix.
    recordShellRetry(item, row, pending);
  }
  return rows;
}
