import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { TeamMember } from "@getpaseo/protocol/workspace-team";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  cachedExecutionHistory,
  invalidateExecutionHistory,
  executionKey,
  peekExecutionHistory,
  type ConversationEntry,
} from "./conversation-execution";
import { hydrateStreamState, type StreamItem } from "@/types/stream";
import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";
const EMPTY: StreamItem[] = [];
const Context = createContext<{
  items: StreamItem[];
  error: string | null;
  loading: boolean;
  retry(): void;
}>({
  items: EMPTY,
  error: null,
  loading: false,
  retry: () => {},
});
export const useConversationHistory = () => useContext(Context);
export function ConversationHistoryProvider({
  member,
  children,
}: {
  member?: TeamMember;
  children: ReactNode;
}) {
  const refs = useMemo(() => member?.executionHistory ?? [], [member?.executionHistory]);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    for (const ref of refs) invalidateExecutionHistory(ref);
    setLoaded(null);
    setAttempt((n) => n + 1);
  }, [refs]);
  const key = refs.map(executionKey).join("|");
  const [loaded, setLoaded] = useState<{
    key: string;
    entries: ConversationEntry[];
    error: string | null;
  } | null>(null);
  const entries = useMemo(() => {
    if (loaded?.key === key) return loaded.entries;
    const snapshots = refs.map(peekExecutionHistory);
    if (snapshots.every(Boolean)) return snapshots.flatMap((v) => v ?? []);
    return null;
  }, [key, loaded, refs]);
  const value = useMemo(
    () => ({
      items: entries ? historyStreamItems(entries) : EMPTY,
      error: loaded?.key === key ? loaded.error : null,
      loading: entries === null,
      retry,
    }),
    [entries, key, loaded, retry],
  );
  useEffect(() => {
    if (entries !== null) return;
    let cancelled = false;
    Promise.all(
      refs.map(async (ref) => {
        const client = getHostRuntimeStore().getClient(ref.serverId);
        if (!client) throw new Error("Conversation history host is disconnected.");
        return cachedExecutionHistory(ref, client);
      }),
    ).then(
      (parts) => {
        if (!cancelled) setLoaded({ key, entries: parts.flat(), error: null });
        return undefined;
      },
      (error) => {
        if (!cancelled) setLoaded({ key, entries: [], error: String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, entries, attempt, refs]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function historyStreamItems(entries: ConversationEntry[]): StreamItem[] {
  return hydrateStreamState(
    entries.map((entry) => ({
      event: {
        type: "timeline",
        provider: entry.provider,
        item: entry.item,
        ...(entry.turnId ? { turnId: entry.turnId } : {}),
      } as AgentStreamEventPayload,
      timestamp: new Date(entry.timestamp),
    })),
    { source: "canonical" },
  );
}
