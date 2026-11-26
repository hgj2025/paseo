// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStreamContentWidth } from "./use-stream-content-width";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("retains valid width through hiding, ignores zero geometry, and remeasures on return", () => {
  let width = 640;
  const read = vi.fn(() => ({ width }) as DOMRect);
  const disconnect = vi.fn();
  let notify = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const element = document.createElement("div");
  element.getBoundingClientRect = read;
  const ref = { current: element };
  const { result, rerender } = renderHook(({ active }) => useStreamContentWidth(ref, active), {
    initialProps: { active: true },
  });
  expect(result.current).toBe(640);
  width = 0;
  act(() => notify());
  expect(result.current).toBe(640);
  rerender({ active: false });
  expect(disconnect).toHaveBeenCalledOnce();
  read.mockClear();
  rerender({ active: false });
  expect(read).not.toHaveBeenCalled();
  expect(result.current).toBe(640);
  width = 800;
  rerender({ active: true });
  expect(result.current).toBe(800);
  width = 960;
  act(() => notify());
  expect(result.current).toBe(960);
});
it("does not force a DOM measurement during render", () => {
  const element = document.createElement("div");
  let rendering = false;
  element.getBoundingClientRect = () => {
    expect(rendering).toBe(false);
    return { width: 640 } as DOMRect;
  };
  const ref = { current: element };
  const { result } = renderHook(() => {
    rendering = true;
    const width = useStreamContentWidth(ref, true);
    rendering = false;
    return width;
  });
  expect(result.current).toBe(640);
});
