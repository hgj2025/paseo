import { DEFAULT_ARCHIVE_RULE, type ArchiveRule } from "./model";
export function openArchiveRuleForm(rule: ArchiveRule = DEFAULT_ARCHIVE_RULE) {
  let state = {
    enabled: rule.enabled,
    days: String(rule.olderThanDays),
    provider: rule.provider,
    directory: rule.directory,
  };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set(patch: Partial<typeof state>) {
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn());
    },
    value(): ArchiveRule | null {
      const days = Number(state.days);
      const directory = state.directory.trim();
      if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > 3650 ||
        (directory && !directory.startsWith("/"))
      )
        return null;
      return {
        enabled: state.enabled,
        olderThanDays: days,
        provider: state.provider.trim(),
        directory,
      };
    },
  };
}
