import { useEffect, useRef } from "react";
import { historyHealthStore } from "./model";
/** Covers workspace/project navigation as well as explicit agent navigation. */
export function useHistoryHealthObservation({
  serverId,
  agentId,
  active,
  ready,
  rows,
}: {
  serverId: string;
  agentId?: string;
  active: boolean;
  ready: boolean;
  rows?: number;
}) {
  const waiting = useRef<{ serverId: string; agentId: string; start: number } | null>(null);
  useEffect(() => {
    if (!active || !agentId) {
      waiting.current = null;
      return;
    }
    const previous = waiting.current;
    if (previous && (previous.serverId !== serverId || previous.agentId !== agentId))
      waiting.current = null;
    if (ready) {
      if (waiting.current) {
        historyHealthStore.observe(serverId, agentId, {
          loadMs: performance.now() - waiting.current.start,
          loadTimedOut: false,
        });
        waiting.current = null;
      }
      return;
    }
    waiting.current ??= { serverId, agentId, start: performance.now() };
    const start = waiting.current.start;
    // One deadline per visible loading episode, never a recurring poll.
    const timer = setTimeout(
      () =>
        historyHealthStore.observe(serverId, agentId, {
          loadMs: performance.now() - start,
          loadTimedOut: true,
        }),
      1500,
    );
    return () => clearTimeout(timer);
  }, [serverId, agentId, active, ready]);
  useEffect(() => {
    if (active && agentId && rows !== undefined)
      historyHealthStore.observe(serverId, agentId, { rows });
  }, [serverId, agentId, active, rows]);
}
