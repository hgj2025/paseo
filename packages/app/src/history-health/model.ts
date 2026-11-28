export interface HistoryHealth {
  rows?: number;
  loadMs?: number;
  loadTimedOut?: boolean;
  processMs?: number;
}
// These are advisory budgets, not model-context limits. A large loaded history can
// warn on its own; smaller histories warn only with observed slow work/load.
export function historyWarning(value: HistoryHealth | undefined) {
  if (!value) return false;
  return (value.rows ?? 0) >= 10000 || (value.loadMs ?? 0) >= 1500 || (value.processMs ?? 0) >= 200;
}
export function createHistoryHealthStore(capacity = 200) {
  const values = new Map<string, HistoryHealth>();
  const listeners = new Map<string, Set<() => void>>();
  const key = (host: string, agent: string) => JSON.stringify([host, agent]);
  const notify = (id: string) => listeners.get(id)?.forEach((fn) => fn());
  return {
    get(host: string, agent: string) {
      return values.get(key(host, agent));
    },
    observe(host: string, agent: string, patch: HistoryHealth) {
      const id = key(host, agent),
        old = values.get(id),
        next = { ...old, ...patch };
      if (
        old &&
        old.rows === next.rows &&
        old.loadMs === next.loadMs &&
        old.loadTimedOut === next.loadTimedOut &&
        old.processMs === next.processMs
      )
        return;
      values.delete(id);
      values.set(id, next);
      if (values.size > capacity) {
        const oldest = values.keys().next().value!;
        values.delete(oldest);
        notify(oldest);
      }
      notify(id);
    },
    subscribe(host: string, agent: string, fn: () => void) {
      const id = key(host, agent),
        group = listeners.get(id) ?? new Set();
      group.add(fn);
      listeners.set(id, group);
      return () => {
        group.delete(fn);
        if (!group.size) listeners.delete(id);
      };
    },
  };
}
export const historyHealthStore = createHistoryHealthStore();
