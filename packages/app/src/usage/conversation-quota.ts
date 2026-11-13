import { usedPercent } from "./model";
import { clampPct } from "./format";
import type { UsageReportEntry, UsageWindow } from "./types";

/** Agent-scoped reports only; never substitute a different host/account's report. */
export function conversationQuota(reports: readonly UsageReportEntry[]) {
  const candidates = reports.flatMap((entry) =>
    entry.report.status === "available"
      ? entry.report.windows
          .filter((window) => /^(five[_-]hour|5h)$/.test(window.id) || window.shortLabel === "5h")
          .flatMap((window) => {
            const percent = usedPercent(window);
            return percent !== null && Number.isFinite(percent)
              ? [{ entry, window, percent: clampPct(percent) }]
              : [];
          })
      : [],
  );
  // If an agent reports several quotas, show the most restrictive instead of hiding it.
  return candidates.sort((a, b) => b.percent - a.percent)[0] ?? null;
}
export function quotaTiming(fetchedAt: string, window: UsageWindow, now: number) {
  const fetched = Date.parse(fetchedAt);
  const reset = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
  return {
    ageMinutes: Number.isFinite(fetched) ? Math.max(0, Math.floor((now - fetched) / 60_000)) : null,
    resetMinutes: Number.isFinite(reset) ? Math.max(0, Math.ceil((reset - now) / 60_000)) : null,
    stale:
      !Number.isFinite(fetched) ||
      now - fetched > 6 * 60_000 ||
      (Number.isFinite(reset) && reset <= now),
  };
}
