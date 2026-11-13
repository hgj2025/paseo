import { describe, expect, it } from "vitest";
import { conversationQuota, quotaTiming } from "./conversation-quota";
import type { UsageReportEntry, UsageWindow } from "./types";
const entry = (windows: UsageWindow[]): UsageReportEntry => ({
  id: "account",
  sourceId: "claude",
  sourceLabel: "Claude",
  account: {},
  fetchedAt: "2026-11-13T00:00:00Z",
  report: { status: "available", windows },
});
describe("conversation quota", () => {
  it("selects five-hour usage rather than weekly or token cost, including remaining-only reports", () => {
    const value = conversationQuota([
      entry([
        { id: "weekly", label: "Weekly", usedPct: 99 },
        { id: "five_hour", label: "Session", remainingPct: 28 },
      ]),
    ]);
    expect(value?.percent).toBe(72);
    expect(value?.window.id).toBe("five_hour");
  });
  it("shows the most restrictive quota and rejects missing/invalid readings", () => {
    expect(
      conversationQuota([
        entry([{ id: "five-hour", label: "Session", usedPct: 20 }]),
        entry([{ id: "five_hour", label: "Session", usedPct: 100 }]),
      ])?.percent,
    ).toBe(100);
    expect(
      conversationQuota([
        entry([
          { id: "five_hour", label: "Session" },
          { id: "five_hour", label: "Session", usedPct: NaN },
        ]),
      ]),
    ).toBeNull();
    expect(conversationQuota([])).toBeNull();
  });
  it("counts down without turning an expired window into a false zero reading", () => {
    const window = {
      id: "five_hour",
      label: "Session",
      usedPct: 100,
      resetsAt: "2026-11-13T00:05:00Z",
    };
    expect(quotaTiming("2026-11-13T00:00:00Z", window, Date.parse("2026-11-13T00:02:00Z"))).toEqual(
      { ageMinutes: 2, resetMinutes: 3, stale: false },
    );
    expect(
      quotaTiming("2026-11-13T00:00:00Z", window, Date.parse("2026-11-13T00:06:00Z")),
    ).toMatchObject({ resetMinutes: 0, stale: true });
    expect(quotaTiming("invalid", { id: "five_hour", label: "Session" }, Date.now())).toMatchObject(
      { resetMinutes: null, ageMinutes: null, stale: true },
    );
  });
});
