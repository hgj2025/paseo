import { historyHealthStore } from "@/history-health/model";
import { useEffect } from "react";
import { getIsElectron } from "@/constants/platform";
import { createNavigationRecorder, type NavigationTarget } from "./recorder";

function writeNavigationLog(record: Record<string, unknown>) {
  if (typeof record.serverId === "string" && typeof record.agentId === "string") {
    if (record.stage === "request")
      historyHealthStore.observe(record.serverId, record.agentId, {
        loadMs: undefined,
        loadTimedOut: undefined,
        processMs: undefined,
      });
    if (record.stage === "content-ready" && typeof record.elapsedMs === "number")
      historyHealthStore.observe(record.serverId, record.agentId, {
        loadMs: record.elapsedMs,
        loadTimedOut: false,
      });
    if (
      record.stage === "finish" &&
      record.outcome === "timeout" &&
      typeof record.elapsedMs === "number"
    )
      historyHealthStore.observe(record.serverId, record.agentId, {
        loadMs: record.elapsedMs,
        loadTimedOut: true,
      });
    if (record.stage === "stream-work" && typeof record.durationMs === "number") {
      const host = record.serverId,
        agent = record.agentId,
        duration = record.durationMs;
      // Presentation is measured during React render. Publish to badge subscribers
      // after the render stack, never synchronously update a different component.
      queueMicrotask(() =>
        historyHealthStore.observe(host, agent, {
          processMs: Math.max(duration, historyHealthStore.get(host, agent)?.processMs ?? 0),
        }),
      );
    }
  }
  const line = JSON.stringify(record);
  const bridge = Reflect.get(globalThis, "__electronLog") as
    | { info?: (...args: string[]) => void }
    | undefined;
  if (typeof bridge?.info === "function") bridge.info("[navigation-perf]", line);
  else console.info("[navigation-perf]", line);
}

let recorder: ReturnType<typeof createNavigationRecorder> | undefined;
let input: { at: number; delay: number } | undefined;
const readyViews = new Map<string, Map<symbol, number>>();
export function beginNavigationTrace(target: NavigationTarget) {
  if (!recorder) return undefined;
  try {
    const id = recorder.begin(
      target,
      input && performance.now() - input.at < 1000 ? input.delay : undefined,
    );
    const rows = readyViews.get(`${target.serverId}:${target.agentId}`)?.values().next().value;
    if (rows !== undefined) recorder.mark("content-ready", target, { rows });
    return id;
  } catch {
    return undefined;
  }
}
export function navigationDispatched(id: number | undefined) {
  if (id !== undefined) recorder?.dispatched(id);
}
export function navigationFailed(id: number | undefined) {
  if (id !== undefined) recorder?.failed(id);
}
export function navigationWorkspaceCommitted(serverId: string, workspaceId: string) {
  recorder?.mark("workspace-commit", { serverId, workspaceId });
}
export function navigationContentReady(serverId: string, agentId: string, rows: number) {
  historyHealthStore.observe(serverId, agentId, { rows });
  const key = `${serverId}:${agentId}`;
  const token = Symbol();
  const views = readyViews.get(key) ?? new Map<symbol, number>();
  views.set(token, rows);
  readyViews.set(key, views);
  recorder?.mark("content-ready", { serverId, agentId }, { rows });
  return () => {
    views.delete(token);
    if (!views.size) readyViews.delete(key);
  };
}
export function measureNavigationWork<T>(
  target: NavigationTarget,
  phase: string,
  rows: number,
  work: () => T,
): T {
  if (!recorder) return work();
  const start = performance.now();
  try {
    return work();
  } finally {
    recorder.work(target, phase, performance.now() - start, rows);
  }
}
/** Bounded per-navigation diagnostics; no idle polling or chat content is collected. */
export function NavigationDiagnosticCollector() {
  useEffect(() => {
    if (!getIsElectron()) return;
    const current = createNavigationRecorder({
      now: () => performance.now(),
      write: writeNavigationLog,
      frame: (callback) => globalThis.requestAnimationFrame(callback),
      cancelFrame: (id) => globalThis.cancelAnimationFrame(id),
      timer: (callback, ms) => globalThis.setTimeout(callback, ms),
      cancelTimer: (id) => globalThis.clearTimeout(id),
    });
    recorder = current;
    writeNavigationLog({ stage: "enabled", version: 2 });
    const onInput = (event: Event) => {
      const now = performance.now();
      const stamp =
        event.timeStamp > performance.timeOrigin
          ? event.timeStamp - performance.timeOrigin
          : event.timeStamp;
      input = { at: now, delay: Math.max(0, now - stamp) };
    };
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    let observer: PerformanceObserver | undefined;
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) current.longTask(entry.startTime, entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
      current.stop();
      if (recorder === current) recorder = undefined;
      input = undefined;
    };
  }, []);
  return null;
}
