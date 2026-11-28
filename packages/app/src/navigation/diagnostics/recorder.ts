export interface NavigationTarget {
  serverId: string;
  agentId: string;
  workspaceId?: string | null;
}
interface Trace extends NavigationTarget {
  id: number;
  start: number;
  stages: Record<string, number>;
  longTasks: { startMs: number; durationMs: number }[];
}
export function createNavigationRecorder(deps: {
  now: () => number;
  write: (record: Record<string, unknown>) => void;
  frame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  timer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancelTimer: (id: ReturnType<typeof setTimeout>) => void;
}) {
  let sequence = 0;
  let pending: Trace | null = null;
  let recent: { trace: Trace; until: number } | null = null;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const round = (value: number) => Math.round(value * 10) / 10;
  const write = (stage: string, extra: Record<string, unknown> = {}) => {
    if (!pending) return;
    try {
      deps.write({ ...pending, stage, elapsedMs: round(deps.now() - pending.start), ...extra });
    } catch {
      /* Diagnostics must not interrupt navigation. */
    }
  };
  const finish = (outcome: string) => {
    if (!pending) return;
    write("finish", { outcome });
    if (frame !== undefined) deps.cancelFrame(frame);
    if (timer !== undefined) deps.cancelTimer(timer);
    if (outcome === "frame-opportunity") recent = { trace: pending, until: deps.now() + 5000 };
    pending = null;
    frame = timer = undefined;
  };
  return {
    begin(target: NavigationTarget, inputDelayMs?: number) {
      finish("superseded");
      recent = null;
      pending = { ...target, id: ++sequence, start: deps.now(), stages: {}, longTasks: [] };
      write("request", { inputDelayMs });
      timer = deps.timer(() => finish("timeout"), 5000);
      return pending.id;
    },
    dispatched(id: number) {
      if (pending?.id === id) write("dispatched");
    },
    failed(id: number) {
      if (pending?.id === id) finish("failed");
    },
    mark(
      stage: "workspace-commit" | "content-ready",
      target: Partial<NavigationTarget>,
      counts?: Record<string, number>,
    ) {
      if (!pending || target.serverId !== pending.serverId) return;
      if (stage === "workspace-commit" && target.workspaceId !== pending.workspaceId) return;
      if (stage === "content-ready" && target.agentId !== pending.agentId) return;
      if (pending.stages[stage] !== undefined) return;
      pending.stages[stage] = round(deps.now() - pending.start);
      write(stage, counts);
      if (stage === "content-ready") {
        const id = pending.id;
        frame = deps.frame(() => {
          frame = deps.frame(() => {
            if (pending?.id === id) finish("frame-opportunity");
          });
        });
      }
    },
    longTask(start: number, duration: number) {
      const trace = pending ?? (recent && start <= recent.until ? recent.trace : null);
      if (!trace || start + duration < trace.start || trace.longTasks.length >= 12) return;
      const task = { startMs: round(start - trace.start), durationMs: round(duration) };
      trace.longTasks.push(task);
      if (!pending) {
        try {
          deps.write({ ...trace, stage: "post-frame-long-task", ...task });
        } catch {
          /* Diagnostics must not interrupt navigation. */
        }
      }
    },
    work(target: NavigationTarget, phase: string, durationMs: number, rows: number) {
      const trace = pending ?? (recent && deps.now() <= recent.until ? recent.trace : null);
      if (!trace || trace.serverId !== target.serverId || trace.agentId !== target.agentId) return;
      if (durationMs < 16) return;
      try {
        deps.write({ ...trace, stage: "stream-work", phase, durationMs: round(durationMs), rows });
      } catch {
        /* Diagnostics must not interrupt navigation. */
      }
    },
    stop() {
      recent = null;
      finish("collector-stopped");
    },
  };
}
