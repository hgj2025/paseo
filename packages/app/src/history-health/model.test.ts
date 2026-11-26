import { expect, it, vi } from "vitest";
import { createHistoryHealthStore, historyWarning } from "./model";
it("separates unknown, large histories and observed slow work", () => {
  expect(historyWarning(undefined)).toBe(false);
  expect(historyWarning({ rows: 9999, loadMs: 100, processMs: 10 })).toBe(false);
  expect(historyWarning({ rows: 15772 })).toBe(true);
  expect(historyWarning({ rows: 40, loadMs: 5000 })).toBe(true);
  expect(historyWarning({ rows: 40, processMs: 250 })).toBe(true);
});
it("keeps host identities separate and notifies only changed session snapshots", () => {
  const store = createHistoryHealthStore(),
    a = vi.fn(),
    b = vi.fn();
  const off = store.subscribe("sg", "same", a);
  store.subscribe("mac", "same", b);
  store.observe("sg", "same", { rows: 15772 });
  const snapshot = store.get("sg", "same");
  store.observe("sg", "same", { rows: 15772 });
  expect(store.get("sg", "same")).toBe(snapshot);
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).not.toHaveBeenCalled();
  expect(store.get("mac", "same")).toBeUndefined();
  off();
  store.observe("sg", "same", { loadMs: 5000 });
  expect(a).toHaveBeenCalledTimes(1);
});
it("bounds retained sessions and notifies evicted subscribers", () => {
  const store = createHistoryHealthStore(2),
    evicted = vi.fn();
  store.observe("sg", "a", { rows: 10000 });
  store.subscribe("sg", "a", evicted);
  store.observe("sg", "b", { rows: 1 });
  store.observe("sg", "c", { rows: 2 });
  expect(store.get("sg", "a")).toBeUndefined();
  expect(evicted).toHaveBeenCalledOnce();
});
