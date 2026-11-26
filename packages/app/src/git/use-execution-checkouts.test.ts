// @vitest-environment jsdom
import { createElement, type PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExecutionCheckouts } from "./use-execution-checkouts";
import { checkoutStatusQueryKey } from "./query-keys";
import type { CheckoutStatusPayload } from "./checkout-status-cache";

const visibility = vi.hoisted(() => ({ visible: true }));
vi.mock("@/hooks/use-app-visible", () => ({ useAppVisible: () => visibility.visible }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));
let queryClient: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T00:00:00Z"));
  visibility.visible = true;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
});
function fixture() {
  const payload = {
    cwd: "/repo",
    repoRoot: "/repo",
    isGit: true,
    isDirty: false,
  } as CheckoutStatusPayload;
  const client = { getCheckoutStatus: vi.fn().mockResolvedValue(payload) };
  const targets = [{ serverId: "host", cwd: "/repo", client, enabled: true }];
  function wrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return { payload, client, targets, wrapper };
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("event-driven execution checkout status", () => {
  it("shares composer/file/workspace cache and sends no periodic requests while idle", async () => {
    const { client, targets, wrapper } = fixture();
    const first = renderHook(({ revision }) => useExecutionCheckouts(targets, revision), {
      wrapper,
      initialProps: { revision: "initial" },
    });
    renderHook(() => useExecutionCheckouts(targets, "initial"), { wrapper });
    await advance(10);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(1);
    first.rerender({ revision: "initial" });
    await advance(60000);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(1);
    first.rerender({ revision: "completed-tool" });
    await advance(300);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(2);
    await advance(60000);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(2);
  });
  it("does not cancel/restart an in-flight read when two surfaces observe the same completion", async () => {
    const { client, targets, payload, wrapper } = fixture();
    const first = renderHook(({ revision }) => useExecutionCheckouts(targets, revision), {
      wrapper,
      initialProps: { revision: "initial" },
    });
    const second = renderHook(({ revision }) => useExecutionCheckouts(targets, revision), {
      wrapper,
      initialProps: { revision: "initial" },
    });
    await advance(10);
    let complete!: (value: CheckoutStatusPayload) => void;
    client.getCheckoutStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    first.rerender({ revision: "tool-done" });
    second.rerender({ revision: "tool-done" });
    await advance(300);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(2);
    await act(async () => {
      complete(payload);
    });
    await advance(10);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(2);
  });
  it("coalesces tool completions and avoids a duplicate read after a fresh daemon push", async () => {
    const { client, targets, payload, wrapper } = fixture();
    const hook = renderHook(({ revision }) => useExecutionCheckouts(targets, revision), {
      wrapper,
      initialProps: { revision: "initial" },
    });
    await advance(10);
    hook.rerender({ revision: "tool-1" });
    await advance(100);
    hook.rerender({ revision: "tool-2" });
    await advance(300);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(2);
    hook.rerender({ revision: "tool-3" });
    act(() => {
      queryClient.setQueryData(checkoutStatusQueryKey("host", "/repo"), {
        ...payload,
        isDirty: true,
      });
    });
    await advance(300);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(2);
  });
  it("does not fetch while hidden, refreshes on return and releases pending work on unmount", async () => {
    const { client, targets, wrapper } = fixture();
    visibility.visible = false;
    const hook = renderHook(({ revision }) => useExecutionCheckouts(targets, revision), {
      wrapper,
      initialProps: { revision: "initial" },
    });
    await advance(30000);
    expect(client.getCheckoutStatus).not.toHaveBeenCalled();
    hook.rerender({ revision: "completed" });
    await advance(300);
    expect(client.getCheckoutStatus).not.toHaveBeenCalled();
    visibility.visible = true;
    hook.rerender({ revision: "completed" });
    await advance(300);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(1);
    hook.rerender({ revision: "another-tool" });
    hook.unmount();
    await advance(30000);
    expect(client.getCheckoutStatus).toHaveBeenCalledTimes(1);
  });
});
