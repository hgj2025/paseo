import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

interface DirectoryRuntime {
  getHosts(): readonly { serverId: string }[];
  getClient(id: string): DaemonClient | null;
  getSnapshot(id: string): { connectionStatus: string } | null;
  subscribeAll(listener: () => void): () => void;
}
/** Only an explicitly configured owner's file is distributed; paired hosts never become members automatically. */
export function mountTeamDirectory(
  source: DaemonClient,
  sourceId: string,
  runtime: DirectoryRuntime,
) {
  let disposed = false;
  let running = false;
  let again = false;
  const delivered = new Map<string, { client: DaemonClient; fingerprint: string }>();
  async function sync() {
    if (disposed || source.getLastServerInfoMessage()?.features?.teamDirectory !== true) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const snapshot = await source.teamDirectory();
      if (disposed || !snapshot || snapshot.ownerHostId !== sourceId) return;
      const fingerprint = JSON.stringify(snapshot);
      const targets = runtime
        .getHosts()
        .filter(
          (host) =>
            host.serverId !== sourceId &&
            runtime.getSnapshot(host.serverId)?.connectionStatus === "online",
        );
      // Bound simultaneous writes. Retrying the same revision is idempotent; no messages are sent.
      for (let index = 0; index < targets.length; index += 4) {
        if (disposed) break;
        await Promise.allSettled(
          targets.slice(index, index + 4).map(async (host) => {
            const client = runtime.getClient(host.serverId);
            if (client?.getLastServerInfoMessage()?.features?.teamDirectory !== true) return;
            const prior = delivered.get(host.serverId);
            if (prior?.client === client && prior.fingerprint === fingerprint) return;
            await client.teamDirectory(snapshot);
            if (!disposed) delivered.set(host.serverId, { client, fingerprint });
          }),
        );
      }
    } catch {
      // Invalid/offline owners never clear replicas. File changes and reconnects retry.
    } finally {
      running = false;
      if (again && !disposed) {
        again = false;
        void sync();
      }
    }
  }
  let connections: Array<{ id: string; client: DaemonClient | null; status: string | undefined }> =
    [];
  const off = runtime.subscribeAll(() => {
    const next = runtime.getHosts().map((host) => ({
      id: host.serverId,
      client: runtime.getClient(host.serverId),
      status: runtime.getSnapshot(host.serverId)?.connectionStatus,
    }));
    if (
      next.length === connections.length &&
      next.every(
        (entry, index) =>
          entry.id === connections[index]?.id &&
          entry.client === connections[index]?.client &&
          entry.status === connections[index]?.status,
      )
    )
      return;
    for (const [id, prior] of delivered) {
      const connection = next.find((entry) => entry.id === id);
      if (!connection || connection.status !== "online" || connection.client !== prior.client)
        delivered.delete(id);
    }
    connections = next;
    void sync();
  });
  const unlisten = source.subscribeTeamDirectoryChanged(() => {
    void sync();
  });
  void sync();
  return () => {
    disposed = true;
    unlisten();
    delivered.clear();
    off();
  };
}
