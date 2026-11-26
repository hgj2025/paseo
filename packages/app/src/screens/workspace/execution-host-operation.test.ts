import { describe, expect, it, vi } from "vitest";
import { runExecutionHostOperation } from "./execution-host-operation";

describe("execution host operations", () => {
  it("waits for reconnection before requesting the destination", async () => {
    let connected = false;
    const client = {
      ensureConnected: vi.fn(),
      connect: vi.fn(async () => {
        connected = true;
      }),
    };
    const operation = vi.fn(async () => {
      if (!connected) throw new Error("Transport not connected");
      return "ready";
    });
    await expect(
      runExecutionHostOperation("devbox", "verify executor", () => client, operation),
    ).resolves.toBe("ready");
    expect(client.ensureConnected).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("reports the host and stage without sending a request if reconnection fails", async () => {
    const operation = vi.fn();
    const client = {
      ensureConnected: vi.fn(),
      connect: vi.fn(async () => {
        throw new Error("Transport not connected (status: disconnected)");
      }),
    };
    await expect(
      runExecutionHostOperation("devbox", "verify executor", () => client, operation),
    ).rejects.toThrow("verify executor [devbox]: Transport not connected (status: disconnected)");
    expect(operation).not.toHaveBeenCalled();
  });
  it("does not retry an ambiguous binding write", async () => {
    const client = { ensureConnected: vi.fn(), connect: vi.fn(async () => {}) };
    const operation = vi.fn(async () => {
      throw new Error("Connection lost");
    });
    await expect(
      runExecutionHostOperation("owner", "commit binding", () => client, operation),
    ).rejects.toThrow("commit binding [owner]: Connection lost");
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("uses the replacement client after reconnecting", async () => {
    const replacement = { ensureConnected: vi.fn(), connect: vi.fn(async () => {}) };
    let current: typeof replacement;
    const original = {
      ensureConnected: vi.fn(),
      connect: vi.fn(async () => {
        current = replacement;
      }),
    };
    current = original;
    const operation = vi.fn(async (client: typeof replacement) => client === replacement);
    await expect(
      runExecutionHostOperation("devbox", "verify executor", () => current, operation),
    ).resolves.toBe(true);
    expect(replacement.connect).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith(replacement);
  });
  it("bounds reconnection waiting without invoking the operation", async () => {
    vi.useFakeTimers();
    try {
      const client = {
        ensureConnected: vi.fn(),
        connect: vi.fn(() => new Promise<void>(() => {})),
      };
      const operation = vi.fn();
      const result = runExecutionHostOperation(
        "devbox",
        "verify executor",
        () => client,
        operation,
      );
      const rejected = expect(result).rejects.toThrow(
        "verify executor [devbox]: Connection did not become ready within 10 seconds",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(operation).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
