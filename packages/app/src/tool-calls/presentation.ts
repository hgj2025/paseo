import { toolCallDisplayOutcome, type DisplayToolStatus } from "./outcome";
import type { AgentMessage } from "@getpaseo/protocol/agent-message";
import { buildAgentMessageDisplay } from "@getpaseo/protocol/paseo-tool-presentation/index";
import type { PlanOutcome } from "@/components/plan-card";
import type { ComponentType } from "react";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { ToolCallDisplayInput } from "@/utils/tool-call-display";
import { buildToolCallDisplayModel } from "@/utils/tool-call-display";
import { extractToolCallFilePath } from "@/utils/extract-tool-call-file-path";
import {
  hasMeaningfulToolCallDetail,
  isPendingToolCallDetail,
} from "@/utils/tool-call-detail-state";

type ToolCallStatus = "executing" | "running" | "completed" | "failed" | "canceled";
export type ToolCallPresentationIcon = ComponentType<{ size?: number; color?: string }>;

interface BuildToolCallPresentationInput {
  agentMessage?: AgentMessage;
  toolName: string;
  status: ToolCallStatus;
  error: unknown;
  detail?: ToolCallDetail;
  cwd?: string;
  metadata?: Record<string, unknown>;
  targetAgentTitle?: string;
  resolveIcon: ToolCallIconResolver;
}

export interface ToolCallPresentation {
  status: DisplayToolStatus;
  noMatches: boolean;
  detail: ToolCallDetail | undefined;
  displayName: string;
  summary?: string;
  errorText?: string;
  icon: ToolCallPresentationIcon;
  isLoadingDetails: boolean;
  hasDetails: boolean;
  canOpenDetails: boolean;
  openFilePath: string | null;
  isPlan: boolean;
  planOutcome?: PlanOutcome;
}

export type ToolCallIconResolver = (
  toolName: string,
  detail: ToolCallDetail | undefined,
  agentMessage: AgentMessage | undefined,
) => ToolCallPresentationIcon;

function displayStatus(status: ToolCallStatus): ToolCallDisplayInput["status"] {
  return status === "executing" ? "running" : status;
}

function displayDetail(detail: ToolCallDetail | undefined): ToolCallDetail {
  return detail ?? { type: "unknown", input: null, output: null };
}

const THINKING_PREVIEW_MAX_LENGTH = 160;

function extractThinkingPreview(
  toolName: string,
  detail: ToolCallDetail | undefined,
): string | undefined {
  if (toolName.trim().toLowerCase() !== "thinking") {
    return undefined;
  }
  if (detail?.type !== "unknown" || typeof detail.input !== "string") {
    return undefined;
  }
  const parts: string[] = [];
  let length = 0;
  for (const rawLine of detail.input.split(/\r?\n/)) {
    const cleaned = rawLine
      .trim()
      .replace(/^(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) {
      continue;
    }
    parts.push(cleaned);
    length += cleaned.length + 1;
    if (length >= THINKING_PREVIEW_MAX_LENGTH) {
      break;
    }
  }
  if (parts.length === 0) {
    return undefined;
  }
  const joined = parts.join(" ");
  if (joined.length <= THINKING_PREVIEW_MAX_LENGTH) {
    return joined;
  }
  return `${joined.slice(0, THINKING_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
}

export function buildToolCallPresentation(
  input: BuildToolCallPresentationInput,
): ToolCallPresentation {
  const detail = input.agentMessage
    ? buildAgentMessageDisplay(input.agentMessage).detail
    : input.detail;
  const detailForDisplay = displayDetail(detail);
  const outcome = toolCallDisplayOutcome({ status: input.status, detail, error: input.error });
  const displayModel = buildToolCallDisplayModel({
    name: input.toolName,
    agentMessage: input.agentMessage,
    status: displayStatus(outcome.status),
    error: outcome.noMatches ? null : (input.error ?? null),
    detail: detailForDisplay,
    metadata: input.metadata,
    cwd: input.cwd,
    targetAgentTitle: input.targetAgentTitle,
  });
  const isLoadingDetails = isPendingToolCallDetail({
    detail,
    status: input.status,
    error: input.error,
  });
  const hasDetails = Boolean(input.error) || hasMeaningfulToolCallDetail(detail);
  const summary = displayModel.summary ?? extractThinkingPreview(input.toolName, detail);

  return {
    ...outcome,
    detail,
    displayName: displayModel.displayName,
    summary,
    errorText: displayModel.errorText,
    icon: input.resolveIcon(input.toolName, detail, input.agentMessage),
    isLoadingDetails,
    hasDetails,
    canOpenDetails: hasDetails || isLoadingDetails,
    openFilePath: extractToolCallFilePath(detail),
    isPlan: input.detail?.type === "plan",
    planOutcome: input.detail?.type === "plan" ? resolvePlanOutcome(input) : undefined,
  };
}

function resolvePlanOutcome(input: BuildToolCallPresentationInput): PlanOutcome | undefined {
  if (input.status === "canceled") return "canceled";
  if (input.metadata?.approved === false) return "rejected";
  if (input.metadata?.approved === true) return "approved";
  if (input.status === "running" || input.status === "executing") return "pending";
  return undefined;
}
