// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useHistoryHealthObservation } from "./use-observation";
import { historyHealthStore } from "./model";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("measures project-list entry without a navigation trace and cancels the deadline on readiness", () => {
  vi.useFakeTimers();
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const props = {
    serverId: "project-host",
    agentId: "project-agent",
    active: true,
    ready: false,
    rows: 75,
  };
  const view = renderHook(useHistoryHealthObservation, { initialProps: props });
  act(() => {
    now = 1700;
    vi.advanceTimersByTime(1600);
  });
  expect(historyHealthStore.get(props.serverId, props.agentId)).toMatchObject({
    rows: 75,
    loadMs: 1600,
    loadTimedOut: true,
  });
  now = 2500;
  view.rerender({ ...props, ready: true, rows: 15772 });
  expect(historyHealthStore.get(props.serverId, props.agentId)).toMatchObject({
    rows: 15772,
    loadMs: 2400,
    loadTimedOut: false,
  });
  expect(vi.getTimerCount()).toBe(0);
});
it("does no work for hidden panels and cancels pending loading observations on hide", () => {
  vi.useFakeTimers();
  const props = {
    serverId: "hidden-host",
    agentId: "hidden-agent",
    active: false,
    ready: false,
    rows: 12345,
  };
  const view = renderHook(useHistoryHealthObservation, { initialProps: props });
  expect(historyHealthStore.get(props.serverId, props.agentId)).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  view.rerender({ ...props, active: true });
  expect(vi.getTimerCount()).toBe(1);
  view.rerender(props);
  expect(vi.getTimerCount()).toBe(0);
});
