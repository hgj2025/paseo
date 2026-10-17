import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

let workerSource: Promise<string> | undefined;
function loadWorkerSource(): Promise<string> {
  return (workerSource ??= (async () => {
    const development = import.meta.url.endsWith(".ts");
    const source = await readFile(
      new URL(`./remote-agent-worker.${development ? "ts" : "js"}`, import.meta.url),
      "utf8",
    );
    // Dev runners inject closure helpers into functions. Ship a self-contained module
    // instead of serializing a function whose closure only exists on the lead host.
    const code = development
      ? (
          await (
            await import("esbuild")
          ).transform(source, { loader: "ts", target: "es2022", format: "esm" })
        ).code
      : source;
    return `${code}\nremoteAgentWorkerMain().catch(error => { console.error(String(error)); process.exit(1); });`;
  })());
}

export interface CollaborationHost {
  id: string;
  command: string[];
}
export interface RemoteChange {
  serverId: string;
  agentId?: string;
}
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** A multiplexed, bounded application channel. SSH remains administrator-configured;
 * it needs exec permission, not TCP forwarding or an externally exposed daemon port. */
export class RemoteAgentConnection {
  private process: ChildProcessWithoutNullStreams | null = null;
  private connecting: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private watched = new Set<string>();
  private heartbeat?: NodeJS.Timeout;
  private retry?: NodeJS.Timeout;
  private attempt = 0;
  private disposed = false;
  constructor(
    readonly host: CollaborationHost,
    private readonly changed: (change: RemoteChange) => void,
  ) {}

  private connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Collaboration connection is closed"));
    if (this.connecting) return this.connecting;
    if (this.process) return Promise.resolve();
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = undefined;
    }
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  private async open(): Promise<void> {
    const source = await loadWorkerSource();
    if (this.disposed) throw new Error("Collaboration connection is closed");
    const child = spawn(
      this.host.command[0]!,
      [...this.host.command.slice(1), "--rpc-worker", Buffer.from(source).toString("base64")],
      {
        stdio: "pipe",
        env: { ...process.env, PASEO_AGENT_ID: "" },
      },
    );
    this.process = child;
    let buffer = "",
      detail = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error("Collaboration connection timed out")), 10_000);
      let ready = false;
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
        this.disconnect(child, error);
      };
      child.stderr.on("data", (data) => {
        detail = (detail + String(data)).slice(-1000);
      });
      child.once("error", fail);
      child.once("exit", () =>
        fail(new Error(`Collaboration connection closed${detail ? ": " + detail : ""}`)),
      );
      child.stdin.on("error", fail);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        buffer += data;
        if (Buffer.byteLength(buffer) > 4 * 1024 * 1024)
          return fail(new Error("Collaboration response is too large"));
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const message = JSON.parse(line) as {
              event?: string;
              version?: number;
              serverId?: string;
              agentId?: string;
              id?: string;
              error?: string;
              result?: unknown;
            };
            if (!ready) {
              if (
                message.event !== "ready" ||
                message.version !== 1 ||
                message.serverId !== this.host.id
              )
                throw new Error("Collaboration host identity or protocol mismatch");
              ready = true;
              clearTimeout(timer);
              this.attempt = 0;
              resolve();
              continue;
            }
            if (message.event === "changed")
              this.changed({ serverId: this.host.id, agentId: message.agentId });
            if (message.id) {
              const pending = this.pending.get(message.id);
              if (!pending) continue;
              clearTimeout(pending.timer);
              this.pending.delete(message.id);
              if (message.error) pending.reject(new Error(message.error));
              else pending.resolve(message.result);
            }
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
            return;
          }
        }
      });
    }).then(
      () => {
        if (this.process !== child)
          throw new Error("Collaboration connection was closed during handshake");
        this.heartbeat = setInterval(() => {
          void this.request({ op: "ping" }, 5000).catch(() => {});
        }, 15_000).unref();
        for (const agentId of this.watched)
          void this.request({ op: "watch", agentId }).catch(() => {});
        this.changed({ serverId: this.host.id });
        return;
      },
      (error) => {
        throw error;
      },
    );
  }
  private disconnect(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.process !== child) return;
    this.process = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    child.kill();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    // Never replay a write. Reconnection restores observations; persisted task IDs
    // let the owner reconcile an unknown acknowledgement through authoritative reads.
    if (!this.disposed && this.watched.size) {
      const delay = Math.min(30_000, 500 * 2 ** Math.min(this.attempt++, 6));
      this.retry = setTimeout(() => {
        void this.connect().catch(() => {});
      }, delay).unref();
    }
  }
  async request(payload: Record<string, unknown>, timeout = 15_000): Promise<unknown> {
    if (this.pending.size >= 32) throw new Error("Too many pending collaboration requests");
    await this.connect();
    if (payload.op === "watch" && typeof payload.agentId === "string")
      this.watched.add(payload.agentId);
    if (this.pending.size >= 32) throw new Error("Too many pending collaboration requests");
    const child = this.process;
    if (!child) throw new Error("Collaboration host is disconnected");
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.disconnect(
            child,
            new Error("Collaboration request timed out; outcome may be unknown"),
          ),
        timeout,
      );
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ ...payload, id }) + "\n");
    });
  }
  dispose() {
    this.disposed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.process) this.disconnect(this.process, new Error("Collaboration connection closed"));
    this.watched.clear();
  }
}

class RemoteAgentPool {
  private connections = new Map<string, { key: string; connection: RemoteAgentConnection }>();
  private listeners = new Set<(event: RemoteChange) => void>();
  connection(host: CollaborationHost) {
    const key = JSON.stringify(host.command),
      previous = this.connections.get(host.id);
    if (previous?.key === key) return previous.connection;
    previous?.connection.dispose();
    const connection = new RemoteAgentConnection(host, (event) => {
      for (const listener of this.listeners) listener(event);
    });
    this.connections.set(host.id, { key, connection });
    return connection;
  }
  subscribe(listener: (event: RemoteChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose() {
    for (const entry of this.connections.values()) entry.connection.dispose();
    this.connections.clear();
    this.listeners.clear();
  }
}
const pools = new Map<string, RemoteAgentPool>();
export function getRemoteAgentPool(home: string) {
  let pool = pools.get(home);
  if (!pool) {
    pool = new RemoteAgentPool();
    pools.set(home, pool);
  }
  return pool;
}
export function disposeRemoteAgentPool(home: string) {
  pools.get(home)?.dispose();
  pools.delete(home);
}
