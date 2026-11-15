import { afterEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { mountTeamDirectory } from "./team-directory";
const directory = { ownerHostId: "owner", revision: 1, members: [] };
function client(snapshot: unknown = null, supported = true) {
  let changed = () => {};
  return {
    notifyChanged: () => changed(),
    subscribeTeamDirectoryChanged: vi.fn((listener: () => void) => {
      changed = listener;
      return vi.fn();
    }),
    teamDirectory: vi.fn().mockResolvedValue(snapshot),
    getLastServerInfoMessage: () => ({ features: { teamDirectory: supported } }),
  };
}
const asClient = (value: ReturnType<typeof client>) => value as unknown as DaemonClient;
afterEach(() => {
  vi.useRealTimers();
});
describe("desktop directory distribution", () => {
  it("copies only the owner's explicit directory, skips offline/old daemons, and retries after reconnect", async () => {
    vi.useFakeTimers();
    const source = client(directory),
      target = client(),
      old = client(null, false);
    let online = false;
    let changed = () => {};
    const off = vi.fn();
    const runtime = {
      getHosts: () => [{ serverId: "owner" }, { serverId: "target" }, { serverId: "old" }],
      getClient: (id: string) => asClient(id === "old" ? old : target),
      getSnapshot: (id: string) => ({
        connectionStatus: id === "target" && !online ? "offline" : "online",
      }),
      subscribeAll: (listener: () => void) => {
        changed = listener;
        return off;
      },
    };
    const dispose = mountTeamDirectory(asClient(source), "owner", runtime);
    await vi.waitFor(() => expect(source.teamDirectory).toHaveBeenCalled());
    expect(target.teamDirectory).not.toHaveBeenCalled();
    online = true;
    changed();
    await vi.waitFor(() => expect(target.teamDirectory).toHaveBeenCalledWith(directory));
    expect(old.teamDirectory).not.toHaveBeenCalled();
    const callsBefore = target.teamDirectory.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    source.notifyChanged();
    await vi.waitFor(() => expect(source.teamDirectory.mock.calls.length).toBeGreaterThan(1));
    expect(target.teamDirectory).toHaveBeenCalledTimes(callsBefore);
    const updated = { ...directory, revision: 2 };
    source.teamDirectory.mockResolvedValue(updated);
    source.notifyChanged();
    await vi.waitFor(() => expect(target.teamDirectory).toHaveBeenCalledWith(updated));
    online = false;
    changed();
    online = true;
    changed();
    await vi.waitFor(() =>
      expect(target.teamDirectory.mock.calls.length).toBeGreaterThan(callsBefore + 1),
    );
    dispose();
    const calls = source.teamDirectory.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(source.teamDirectory).toHaveBeenCalledTimes(calls);
    expect(off).toHaveBeenCalledOnce();
  });
  it("does not redistribute replicas or invent a roster from paired hosts", async () => {
    const target = client();
    for (const snapshot of [null, directory]) {
      const source = client(snapshot);
      const dispose = mountTeamDirectory(asClient(source), "replica", {
        getHosts: () => [{ serverId: "target" }],
        getClient: () => asClient(target),
        getSnapshot: () => ({ connectionStatus: "online" }),
        subscribeAll: () => () => {},
      });
      await vi.waitFor(() => expect(source.teamDirectory).toHaveBeenCalled());
      dispose();
    }
    expect(target.teamDirectory).not.toHaveBeenCalled();
  });
});
