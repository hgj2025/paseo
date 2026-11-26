// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  NavigationDiagnosticCollector,
  beginNavigationTrace,
  navigationContentReady,
  navigationDispatched,
} from "./collector";
vi.mock("@/constants/platform", () => ({ getIsElectron: () => true }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("uses browser API receivers and writes real navigation stages through the log bridge", () => {
  const info = vi.fn();
  vi.stubGlobal("__electronLog", { info });
  vi.stubGlobal("setTimeout", function (this: unknown) {
    expect(this).toBe(globalThis);
    return 1;
  });
  vi.stubGlobal("clearTimeout", function (this: unknown) {
    expect(this).toBe(globalThis);
  });
  vi.stubGlobal("requestAnimationFrame", function (this: unknown) {
    expect(this).toBe(globalThis);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", function (this: unknown) {
    expect(this).toBe(globalThis);
  });
  render(createElement(NavigationDiagnosticCollector));
  const id = beginNavigationTrace({ serverId: "host", agentId: "agent" });
  expect(id).toBeTypeOf("number");
  navigationDispatched(id);
  const release = navigationContentReady("host", "agent", 20);
  const records = info.mock.calls.map((call) => JSON.parse(call[1]));
  expect(records.map((x) => x.stage)).toEqual([
    "enabled",
    "request",
    "dispatched",
    "content-ready",
  ]);
  release();
});
it("a failed diagnostic timer never throws into the navigation caller", () => {
  vi.stubGlobal("__electronLog", { info: vi.fn() });
  vi.stubGlobal("setTimeout", () => {
    throw new TypeError("Illegal invocation");
  });
  render(createElement(NavigationDiagnosticCollector));
  expect(() => beginNavigationTrace({ serverId: "host", agentId: "agent" })).not.toThrow();
});
