// @vitest-environment jsdom
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionArchiveCoordinator } from "./runtime";
import { DAY_MS, DEFAULT_ARCHIVE_RULE } from "./model";
import type { ArchiveReport } from "./store";
const fake = vi.hoisted(() => ({
  rules: {} as Record<string, typeof DEFAULT_ARCHIVE_RULE>,
  reports: {} as Record<string, ArchiveReport>,
  load: vi.fn(),
  archive: vi.fn(),
  invalidate: vi.fn(),
  connected: true,
}));
vi.mock("./store", () => ({
  useArchiveRules: Object.assign(
    (select: (s: unknown) => unknown) => select({ rules: fake.rules }),
    {
      getState: () => ({
        reports: fake.reports,
        report: (id: string, r: ArchiveReport) => {
          fake.reports[id] = r;
        },
      }),
      persist: { hasHydrated: () => true },
    },
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: fake.invalidate }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  isHostRuntimeConnected: () => fake.connected,
  getHostRuntimeStore: () => ({
    getClient: () => ({}),
    getSnapshot: () => ({}),
    subscribeHostList: () => () => {},
  }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: {} }) },
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  observeOpenWorkspaceAgentIds: () => () => {},
  useWorkspaceLayoutStore: { persist: { hasHydrated: () => true } },
}));
vi.mock("./service", () => ({
  loadHostHistory: (...args: unknown[]) => fake.load(...args),
  archiveCandidates: (...args: unknown[]) => fake.archive(...args),
}));
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-22T00:00:00Z"));
  fake.rules = {};
  fake.reports = {};
  fake.connected = true;
  fake.load.mockReset().mockResolvedValue([]);
  fake.archive.mockReset().mockResolvedValue({ archived: 0, skipped: 0, failed: 0 });
});
afterEach(() => vi.useRealTimers());
it("does no work when disabled", async () => {
  const view = renderHook(() => SessionArchiveCoordinator());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DAY_MS);
  });
  expect(fake.load).not.toHaveBeenCalled();
  view.unmount();
});
it("checks once a day and cleans up its timer", async () => {
  fake.rules = { home: { ...DEFAULT_ARCHIVE_RULE, enabled: true } };
  const view = renderHook(() => SessionArchiveCoordinator());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(fake.load).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
  });
  expect(fake.load).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fake.load).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
  });
  expect(fake.load).toHaveBeenCalledTimes(2);
});
it("retries offline hosts without marking them checked", async () => {
  fake.rules = { home: { ...DEFAULT_ARCHIVE_RULE, enabled: true } };
  fake.connected = false;
  const view = renderHook(() => SessionArchiveCoordinator());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(fake.load).not.toHaveBeenCalled();
  expect(fake.reports.home).toBeUndefined();
  fake.connected = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(fake.load).toHaveBeenCalledTimes(1);
  view.unmount();
});
