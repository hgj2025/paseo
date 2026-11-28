import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

export type DisplayToolStatus = "executing" | "running" | "completed" | "failed" | "canceled";
interface DisplayOutcomeInput {
  status: DisplayToolStatus;
  detail?: ToolCallDetail;
  error?: unknown;
}

interface QuotedWord {
  value: string;
  end: number;
}
function quotedWord(command: string, start: number): QuotedWord | null {
  const quote = command[start];
  let value = "";
  for (let index = start + 1; index < command.length; index++) {
    const char = command[index]!;
    if (char === quote) return { value, end: index };
    if (quote === '"' && char === "\\") {
      const next = command[++index];
      if (next === undefined) return null;
      if (!["$", "`", '"', "\\"].includes(next)) value += "\\";
      value += next;
    } else {
      if (quote === '"' && /[$`]/u.test(char)) return null;
      value += char;
    }
  }
  return null;
}

// Recognize a deliberately small shell grammar; uncertain syntax stays a failure.
function singleCommandWords(command: string): string[] | null {
  if (/[\r\n]/u.test(command)) return null;
  const words: string[] = [];
  let word = "";
  let started = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (char === "'" || char === '"') {
      const quoted = quotedWord(command, index);
      if (!quoted) return null;
      word += quoted.value;
      index = quoted.end;
      started = true;
    } else if (char === "\\") {
      const next = command[++index];
      if (next === undefined) return null;
      word += next;
      started = true;
    } else if (char === " " || char === "\t") {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      if (";&|<>(){}$`#*?[]~!".includes(char)) return null;
      word += char;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

function genericExitError(error: unknown): boolean {
  if (error === null || error === undefined) return true;
  if (typeof error === "object" && Object.keys(error).length === 1 && "message" in error)
    return error.message === "Command failed" || error.message === "Tool call failed";
  return false;
}

/** Display-only interpretation. Never mutate provider status, errors or exit codes. */
export function toolCallDisplayOutcome({ status, detail, error }: DisplayOutcomeInput): {
  status: DisplayToolStatus;
  noMatches: boolean;
} {
  if (status === "running" || status === "executing" || status === "canceled")
    return { status, noMatches: false };
  if (detail?.type !== "shell") return { status, noMatches: false };
  const failed = typeof detail.exitCode === "number" && detail.exitCode !== 0;
  const words = detail.exitCode === 1 ? singleCommandWords(detail.command) : null;
  const executable = words?.[0];
  const noMatches = Boolean(
    executable &&
    (executable === "rg" || /^\/(?:[^/]+\/)*rg$/u.test(executable)) &&
    typeof detail.output === "string" &&
    !detail.output.trim() &&
    genericExitError(error),
  );
  if (noMatches) return { status: "completed", noMatches: true };
  return { status: failed ? "failed" : status, noMatches: false };
}
