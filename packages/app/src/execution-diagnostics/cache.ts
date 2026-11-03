import type { StreamItem } from "@/types/stream";
import {
  analyzeExecutions,
  diagnosticItems,
  observeExecutions,
  type ExecutionRow,
  type Observation,
} from "./model";

export interface SessionDiagnostic {
  serverId: string;
  agentId: string;
  rows: readonly ExecutionRow[];
  analyzedAt: number;
  source: "history" | "observed";
}
interface RecordState {
  value: SessionDiagnostic;
  observations: Map<string, Observation>;
  epoch: string | undefined;
  liveRows: Set<string>;
}
export const sessionKey = (serverId: string, agentId: string) =>
  JSON.stringify([serverId, agentId]);

/** Memory-only, bounded, redacted results. No raw history or commands are persisted. */
export class DiagnosticCache {
  private records = new Map<string, RecordState>();
  private listeners = new Set<() => void>();
  private revision = 0;
  constructor(
    private maxSessions = 40,
    private maxRows = 200,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.revision;
  get(serverId: string, agentId: string) {
    return this.records.get(sessionKey(serverId, agentId))?.value;
  }
  get size() {
    return this.records.size;
  }
  clear() {
    this.records.clear();
    this.notify();
  }
  invalidate(serverId: string) {
    for (const entry of this.records.values()) {
      if (entry.value.serverId !== serverId) continue;
      for (const [id, observation] of entry.observations) {
        if (observation.ended === undefined)
          entry.observations.set(id, { ...observation, valid: false });
      }
    }
  }
  ingest(
    serverId: string,
    agentId: string,
    history: readonly StreamItem[],
    head: readonly StreamItem[],
    options: { live: boolean; connected: boolean; now: number },
  ) {
    const key = sessionKey(serverId, agentId);
    const items = diagnosticItems(history, head);
    const epoch = items.find((item) => item.timelineCursor)?.timelineCursor?.epoch;
    const previous = this.records.get(key);
    const old = previous && previous.epoch === epoch ? previous : undefined;
    const observations = options.live
      ? observeExecutions(items, old?.observations ?? new Map(), options.now, options.connected)
      : (old?.observations ?? new Map<string, Observation>());
    const analyzed = analyzeExecutions(items, observations, options.now);
    const merged = new Map(old?.value.rows.map((row) => [row.id, row]));
    // A live window may evict old history. Retain bounded completed evidence, but never
    // leave vanished running rows looking continuously observed.
    if (options.live && old) {
      const ids = new Set(analyzed.map((row) => row.id));
      for (const row of old.value.rows)
        if (row.status === "running" && old.liveRows.has(row.id) && !ids.has(row.id))
          merged.delete(row.id);
    }
    for (const row of analyzed)
      merged.set(row.id, {
        ...row,
        command: row.command.slice(0, 500),
        evidence: row.evidence.slice(-1000),
      });
    const rows = Array.from(merged.values())
      .sort((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0))
      .slice(-this.maxRows);
    const value: SessionDiagnostic = {
      serverId,
      agentId,
      rows,
      source: options.live ? "observed" : "history",
      analyzedAt: Date.now(),
    };
    this.records.delete(key);
    this.records.set(key, {
      value,
      observations,
      epoch: epoch ?? old?.epoch,
      liveRows: options.live
        ? new Set(analyzed.map((row) => row.id))
        : (old?.liveRows ?? new Set()),
    });
    while (this.records.size > this.maxSessions)
      this.records.delete(this.records.keys().next().value!);
    this.notify();
  }
  tick(now: number) {
    let changed = false;
    for (const entry of this.records.values()) {
      const rows = entry.value.rows.map((row) => {
        const observation = entry.observations.get(row.id);
        if (row.status !== "running" || row.timing !== "observed" || !observation?.valid)
          return row;
        changed = true;
        const durationMs = Math.max(0, now - observation.started);
        return { ...row, durationMs, slow: durationMs >= 30000 };
      });
      if (rows.some((row, index) => row !== entry.value.rows[index]))
        entry.value = { ...entry.value, rows };
    }
    if (changed) this.notify();
  }
  private notify() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}
export const diagnosticCache = new DiagnosticCache();
