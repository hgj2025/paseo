import { toolCallDisplayOutcome } from "../outcome";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ThoughtItem, ToolCallItem } from "@/types/stream";

export interface ToolCallDescriptor {
  detail: ToolCallDetail;
  name: string;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  error: unknown;
  metadata?: Record<string, unknown>;
}

export type ToolCallRunEntry = ToolCallItem | ThoughtItem;

export interface ToolCallRun {
  id: string;
  calls: readonly ToolCallItem[];
  entries: readonly ToolCallRunEntry[];
  latest: ToolCallItem;
  isSealed: boolean;
}

export interface GroupedHistory<TGroup> {
  tail: StreamItem[];
  groupsByHostId: Map<string, TGroup>;
  pendingEntries: readonly ToolCallRunEntry[];
}

export interface GroupedToolCalls<TGroup> {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: ToolCallGroupLookup<TGroup>;
  historyGroupUpdatesByHostId: ToolCallGroupLookup<TGroup>;
}

export interface ToolCallGroupLookup<TGroup> {
  readonly size: number;
  get(id: string): TGroup | undefined;
  has(id: string): boolean;
}

const EMPTY_GROUPS = new Map<string, never>();

export function describeToolCall(item: ToolCallItem): ToolCallDescriptor {
  if (item.payload.source === "agent") {
    const { data } = item.payload;
    return {
      detail: data.detail,
      name: data.name,
      status: data.status,
      error: data.error,
      metadata: data.metadata,
    };
  }

  const { data } = item.payload;
  return {
    detail: {
      type: "unknown",
      input: data.arguments ?? null,
      output: data.result ?? null,
    },
    name: data.toolName,
    status: data.status,
    error: data.error,
  };
}

export function isGroupableToolCall(item: StreamItem): item is ToolCallItem {
  if (item.kind !== "tool_call") {
    return false;
  }
  const descriptor = describeToolCall(item);
  return (
    !toolCallDisplayOutcome(descriptor).noMatches &&
    descriptor.status !== "failed" &&
    descriptor.status !== "canceled" &&
    !descriptor.error &&
    descriptor.detail.type !== "plan" &&
    descriptor.name.trim().toLowerCase() !== "speak"
  );
}

function isFoldableThought(item: StreamItem, foldThoughts: boolean): item is ThoughtItem {
  return foldThoughts && item.kind === "thought";
}

function isBlankAssistantMessage(item: StreamItem): boolean {
  return item.kind === "assistant_message" && item.text.trim().length === 0;
}

function createRun(entries: readonly ToolCallRunEntry[], isSealed: boolean): ToolCallRun {
  const calls = entries.filter((entry): entry is ToolCallItem => entry.kind === "tool_call");
  const first = calls[0];
  const latest = calls.at(-1);
  if (!first || !latest) {
    throw new Error("Cannot group an empty tool call run");
  }
  return { id: first.id, calls, entries, latest, isSealed };
}

function createHost(run: ToolCallRun): ToolCallItem {
  if (run.calls.length === 1) {
    return run.latest;
  }
  return { ...run.latest, id: run.id };
}

function isEntryActive(entry: ToolCallRunEntry): boolean {
  if (entry.kind === "thought") {
    return entry.status === "loading";
  }
  const status = describeToolCall(entry).status;
  return status === "running" || status === "executing";
}

function flushHistoryPending<TGroup>(input: {
  entries: readonly ToolCallRunEntry[];
  hasCall: boolean;
  isSealed: boolean;
  output: StreamItem[];
  groups: Map<string, TGroup>;
  buildGroup: (run: ToolCallRun) => TGroup;
}): boolean {
  if (input.entries.length === 0) {
    return false;
  }
  if (!input.hasCall) {
    input.output.push(...input.entries);
    return false;
  }
  const run = createRun(input.entries, input.isSealed);
  const host = createHost(run);
  input.output.push(host);
  input.groups.set(host.id, input.buildGroup(run));
  return true;
}

export function prepareGroupedHistory<TGroup>(input: {
  tail: StreamItem[];
  buildGroup: (run: ToolCallRun) => TGroup;
  foldThoughts?: boolean;
}): GroupedHistory<TGroup> {
  const foldThoughts = input.foldThoughts ?? true;
  const output: StreamItem[] = [];
  const groups = new Map<string, TGroup>();
  let pending: ToolCallRunEntry[] = [];
  let pendingHasCall = false;

  for (const item of input.tail) {
    if (isGroupableToolCall(item)) {
      pending.push(item);
      pendingHasCall = true;
      continue;
    }
    if (isFoldableThought(item, foldThoughts)) {
      pending.push(item);
      continue;
    }
    if (pending.length > 0 && isBlankAssistantMessage(item)) {
      continue;
    }
    flushHistoryPending({
      entries: pending,
      hasCall: pendingHasCall,
      isSealed: true,
      output,
      groups,
      buildGroup: input.buildGroup,
    });
    pending = [];
    pendingHasCall = false;
    output.push(item);
  }

  const trailingWasGrouped = flushHistoryPending({
    entries: pending,
    hasCall: pendingHasCall,
    isSealed: true,
    output,
    groups,
    buildGroup: input.buildGroup,
  });

  return {
    tail: groups.size > 0 ? output : input.tail,
    groupsByHostId: groups,
    pendingEntries: trailingWasGrouped ? pending : [],
  };
}

export function groupLiveToolCalls<TGroup>(input: {
  history: GroupedHistory<TGroup>;
  head: StreamItem[];
  isTurnActive: boolean;
  buildGroup: (run: ToolCallRun) => TGroup;
  foldThoughts?: boolean;
}): GroupedToolCalls<TGroup> {
  const foldThoughts = input.foldThoughts ?? true;
  const head: StreamItem[] = [];
  const liveGroups = new Map<string, TGroup>();
  let pending: ToolCallRunEntry[] = [...input.history.pendingEntries];
  let pendingHasCall = pending.length > 0;
  let hostPlacement: "history" | "head" | null = pendingHasCall ? "history" : null;
  let pendingIncludesHead = false;

  const flush = (isSealed: boolean) => {
    if (pending.length === 0) {
      return;
    }
    if (!pendingHasCall) {
      head.push(...pending);
      pending = [];
      hostPlacement = null;
      pendingIncludesHead = false;
      return;
    }
    const run = createRun(pending, isSealed);
    if (hostPlacement === "head") {
      head.push(createHost(run));
    }
    if (hostPlacement === "head" || pendingIncludesHead || !isSealed) {
      liveGroups.set(run.id, input.buildGroup(run));
    }
    pending = [];
    pendingHasCall = false;
    hostPlacement = null;
    pendingIncludesHead = false;
  };

  let skippedBlankHeadItem = false;

  for (const item of input.head) {
    if (isGroupableToolCall(item)) {
      if (pending.length === 0) {
        hostPlacement = "head";
      }
      pending.push(item);
      pendingHasCall = true;
      pendingIncludesHead = true;
      continue;
    }
    if (isFoldableThought(item, foldThoughts)) {
      if (pending.length === 0) {
        hostPlacement = "head";
      }
      pending.push(item);
      pendingIncludesHead = true;
      continue;
    }
    if (pending.length > 0 && isBlankAssistantMessage(item)) {
      skippedBlankHeadItem = true;
      continue;
    }
    flush(true);
    head.push(item);
  }
  // Tool calls live in retained tail rather than the streaming head. The agent
  // lifecycle snapshot can still be idle while a newly received tool call is
  // already running, so its direct timeline status is the authoritative start
  // signal. The lifecycle state continues to keep completed calls live between
  // sequential tool updates.
  const trailingRunIsActive = input.isTurnActive || pending.some(isEntryActive);
  flush(!trailingRunIsActive);

  if (liveGroups.size === 0) {
    return {
      tail: input.history.tail,
      head: skippedBlankHeadItem ? head : input.head,
      groupsByHostId: input.history.groupsByHostId,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  if (input.history.groupsByHostId.size === 0) {
    return {
      tail: input.history.tail,
      head,
      groupsByHostId: liveGroups,
      historyGroupUpdatesByHostId: EMPTY_GROUPS,
    };
  }
  const groupsByHostId = new Map(input.history.groupsByHostId);
  let historyGroupUpdatesByHostId: Map<string, TGroup> | null = null;
  for (const [id, group] of liveGroups) {
    groupsByHostId.set(id, group);
    if (input.history.groupsByHostId.has(id)) {
      historyGroupUpdatesByHostId ??= new Map();
      historyGroupUpdatesByHostId.set(id, group);
    }
  }
  return {
    tail: input.history.tail,
    head,
    groupsByHostId,
    historyGroupUpdatesByHostId: historyGroupUpdatesByHostId ?? EMPTY_GROUPS,
  };
}
