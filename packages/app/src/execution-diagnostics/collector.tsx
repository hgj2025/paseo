import { useEffect } from "react";
import { getIsElectronMac } from "@/constants/platform";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import type { StreamItem } from "@/types/stream";
import { diagnosticCache, sessionKey } from "./cache";

const EMPTY: StreamItem[] = [];
/** Observe received stream state only. No agent or timeline demand is acquired here. */
export function ExecutionDiagnosticCollector() {
  useEffect(() => {
    if (!getIsElectronMac()) return;
    const runtime = getHostRuntimeStore();
    const seen = new Map<
      string,
      { tail: StreamItem[]; head: StreamItem[]; connected: boolean; records: StreamItem[] }
    >();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const flush = () => {
      if (stopped) return;
      const alive = new Set<string>();
      for (const [serverId, session] of Object.entries(useSessionStore.getState().sessions)) {
        const connected = isHostRuntimeConnected(runtime.getSnapshot(serverId)) && !document.hidden;
        if (!connected) diagnosticCache.invalidate(serverId);
        const ids = new Set([...session.agentStreamTail.keys(), ...session.agentStreamHead.keys()]);
        for (const agentId of ids) {
          const key = sessionKey(serverId, agentId);
          alive.add(key);
          const tail = session.agentStreamTail.get(agentId) ?? EMPTY;
          const head = session.agentStreamHead.get(agentId) ?? EMPTY;
          const old = seen.get(key);
          if (old?.tail === tail && old.head === head && old.connected === connected) continue;
          const records = [...tail, ...head]
            .filter(
              (item) =>
                item.kind === "tool_call" ||
                (item.kind === "notification" && item.sourceType === "error"),
            )
            .slice(-2000);
          seen.set(key, { tail, head, connected, records });
          if (
            !records.length ||
            (old?.connected === connected &&
              old.records.length === records.length &&
              records.every((record, index) => record === old.records[index]))
          )
            continue;
          diagnosticCache.ingest(serverId, agentId, tail, head, {
            live: true,
            connected,
            now: performance.now(),
          });
        }
      }
      for (const key of seen.keys()) if (!alive.has(key)) seen.delete(key);
    };
    const schedule = () => {
      if (timer === undefined)
        timer = setTimeout(() => {
          timer = undefined;
          try {
            flush();
          } catch {
            /* Diagnostics never interrupt session delivery. */
          }
        }, 500);
    };
    const connectionChanged = () => {
      for (const serverId of Object.keys(useSessionStore.getState().sessions))
        if (!isHostRuntimeConnected(runtime.getSnapshot(serverId)) || document.hidden)
          diagnosticCache.invalidate(serverId);
      schedule();
    };
    const releaseSession = useSessionStore.subscribe(schedule);
    const releaseRuntime = runtime.subscribeAll(connectionChanged);
    document.addEventListener("visibilitychange", connectionChanged);
    schedule();
    const clock = setInterval(() => {
      if (!document.hidden) diagnosticCache.tick(performance.now());
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(clock);
      if (timer !== undefined) clearTimeout(timer);
      releaseSession();
      releaseRuntime();
      document.removeEventListener("visibilitychange", connectionChanged);
    };
  }, []);
  return null;
}
