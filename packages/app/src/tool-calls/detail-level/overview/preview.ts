import { stripCwdPrefix } from "@getpaseo/protocol/path-utils";
import { buildToolCallDisplayModel } from "@/utils/tool-call-display";
import { extractToolCallFilePath } from "@/utils/extract-tool-call-file-path";
import type { ToolCallItem } from "@/types/stream";
import { describeToolCall, type ToolCallRun } from "../grouping";

export interface OverviewPreview {
  secondaryLabel?: string;
  openFilePath?: string;
}

const TWO_ITEM_SEGMENT_MAX_LENGTH = 44;
const MANY_ITEM_SEGMENT_MAX_LENGTH = 36;

function collapseInlineText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : undefined;
}

function truncateSegment(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function appendUnique(target: string[], value: string | undefined): void {
  if (!value || target.includes(value)) {
    return;
  }
  target.push(value);
}

function formatFilePreview(filePaths: readonly string[], cwd?: string): string | undefined {
  if (filePaths.length === 0) {
    return undefined;
  }
  if (filePaths.length === 1) {
    return collapseInlineText(stripCwdPrefix(filePaths[0]!, cwd));
  }
  const firstPath = filePaths[0]!;
  const secondPath = filePaths[1]!;
  const firstBase = extractBasename(firstPath);
  const secondBase = extractBasename(secondPath);
  const useRelative = firstBase === secondBase;
  const firstLabel = useRelative ? stripCwdPrefix(firstPath, cwd) : firstBase;
  const secondLabel = useRelative ? stripCwdPrefix(secondPath, cwd) : secondBase;
  const suffix = filePaths.length > 2 ? ` +${filePaths.length - 2}` : "";
  return collapseInlineText(`${firstLabel}, ${secondLabel}${suffix}`);
}

function describeCallPreview(call: ToolCallItem, cwd?: string): string | undefined {
  const descriptor = describeToolCall(call);
  const displayStatus = descriptor.status === "executing" ? "running" : descriptor.status;
  const display = buildToolCallDisplayModel({
    name: descriptor.name,
    agentMessage: call.payload.source === "agent" ? call.payload.data.agentMessage : undefined,
    status: displayStatus,
    error: descriptor.error ?? null,
    detail: descriptor.detail,
    metadata: descriptor.metadata,
    cwd,
  });
  if (display.summary) {
    return collapseInlineText(display.summary);
  }
  if (descriptor.detail.type === "unknown") {
    return collapseInlineText(display.displayName);
  }
  return undefined;
}

function findActiveCall(calls: readonly ToolCallItem[]): ToolCallItem | undefined {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]!;
    const status = describeToolCall(call).status;
    if (status === "running" || status === "executing") {
      return call;
    }
  }
  return undefined;
}

function formatDistinctCallPreviews(
  calls: readonly ToolCallItem[],
  cwd?: string,
): string | undefined {
  const previews: string[] = [];
  for (const call of calls) {
    appendUnique(previews, describeCallPreview(call, cwd));
  }
  if (previews.length === 0) {
    return undefined;
  }
  if (previews.length === 1) {
    return previews[0];
  }
  if (previews.length === 2) {
    return `${truncateSegment(previews[0]!, TWO_ITEM_SEGMENT_MAX_LENGTH)} · ${truncateSegment(previews[1]!, TWO_ITEM_SEGMENT_MAX_LENGTH)}`;
  }
  return `${truncateSegment(previews[0]!, MANY_ITEM_SEGMENT_MAX_LENGTH)} · ${truncateSegment(previews[1]!, MANY_ITEM_SEGMENT_MAX_LENGTH)} +${previews.length - 2}`;
}

export function buildOverviewPreview(run: ToolCallRun, cwd?: string): OverviewPreview {
  const toolCalls = run.calls.filter((item): item is ToolCallItem => item.kind === "tool_call");
  if (toolCalls.length === 0) {
    return {};
  }
  if (toolCalls.length === 1) {
    const call = toolCalls[0]!;
    const descriptor = describeToolCall(call);
    const openFilePath = extractToolCallFilePath(descriptor.detail) ?? undefined;
    return {
      secondaryLabel: describeCallPreview(call, cwd),
      ...(openFilePath ? { openFilePath } : {}),
    };
  }

  if (!run.isSealed) {
    const activeCall = findActiveCall(toolCalls);
    if (activeCall) {
      const activeLabel = describeCallPreview(activeCall, cwd);
      if (activeLabel) {
        return { secondaryLabel: activeLabel };
      }
    }
  }

  const editedFiles: string[] = [];
  const readFiles: string[] = [];
  const allFiles: string[] = [];
  for (const call of toolCalls) {
    const { detail } = describeToolCall(call);
    if (detail.type === "edit" || detail.type === "write") {
      appendUnique(editedFiles, detail.filePath);
      appendUnique(allFiles, detail.filePath);
    } else if (detail.type === "read") {
      appendUnique(readFiles, detail.filePath);
      appendUnique(allFiles, detail.filePath);
    }
  }

  const openFilePath = allFiles.length === 1 ? allFiles[0] : undefined;
  if (editedFiles.length > 0) {
    return {
      secondaryLabel: formatFilePreview(editedFiles, cwd),
      ...(openFilePath ? { openFilePath } : {}),
    };
  }
  if (readFiles.length > 0) {
    return {
      secondaryLabel: formatFilePreview(readFiles, cwd),
      ...(openFilePath ? { openFilePath } : {}),
    };
  }

  return {
    secondaryLabel: formatDistinctCallPreviews(toolCalls, cwd),
  };
}
