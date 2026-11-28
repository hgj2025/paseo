import { randomUUID } from "node:crypto";
import {
  CollaborationOperationSchema,
  type CollaborationOperation,
} from "@getpaseo/protocol/collaboration-bridge";
interface Client {
  id: string;
  hostIds: readonly string[];
  send(message: {
    type: "collaboration.bridge.execute.request";
    requestId: string;
    hostId: string;
    operation: CollaborationOperation;
  }): void;
}
interface Pending {
  hostId: string;
  clientId: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
/** Only authenticated, subscription-owned desktop channels may register; no routing credentials persist. */
export class CollaborationBridge {
  private listeners = new Set<(event: { serverId: string; agentId: string }) => void>();
  subscribe(listener: (event: { serverId: string; agentId: string }) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  changed(clientIds: readonly string[], hostId: string, agentId: string) {
    if (!clientIds.some((id) => this.clients.get(id)?.hostIds.includes(hostId))) return;
    for (const listener of this.listeners) listener({ serverId: hostId, agentId });
  }
  private clients = new Map<string, Client>();
  private pending = new Map<string, Pending>();
  register(client: Client) {
    this.clients.set(client.id, client);
    return () => {
      if (this.clients.get(client.id) !== client) return;
      this.clients.delete(client.id);
      for (const [id, p] of this.pending)
        if (p.clientId === client.id) {
          clearTimeout(p.timer);
          this.pending.delete(id);
          p.reject(
            new Error("Mac collaboration coordinator disconnected; outcome may be unconfirmed."),
          );
        }
    };
  }
  update(clientIds: readonly string[], hostIds: readonly string[]) {
    for (const id of clientIds) {
      const client = this.clients.get(id);
      if (client) client.hostIds = [...new Set(hostIds)];
    }
    for (const [id, pending] of this.pending)
      if (clientIds.includes(pending.clientId) && !hostIds.includes(pending.hostId)) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new Error("Destination host disconnected; outcome may be unconfirmed."));
      }
  }
  hostIds() {
    return [...new Set([...this.clients.values()].flatMap((client) => client.hostIds))];
  }
  has(hostId: string) {
    return [...this.clients.values()].some((c) => c.hostIds.includes(hostId));
  }
  async execute(hostId: string, input: unknown): Promise<unknown> {
    const operation = CollaborationOperationSchema.parse(input);
    const client = [...this.clients.values()].find((c) => c.hostIds.includes(hostId));
    if (!client) throw new Error("No connected Mac collaboration route to this host.");
    if (this.pending.size >= 128) throw new Error("Collaboration coordinator is busy.");
    const requestId = randomUUID();
    let timeoutMs = 30000;
    if (operation.op === "ping") timeoutMs = 5000;
    if (operation.op === "wait") timeoutMs = (operation.timeoutSeconds + 10) * 1000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Mac collaboration request timed out; outcome may be unconfirmed."));
      }, timeoutMs);
      timer.unref();
      this.pending.set(requestId, { hostId, clientId: client.id, resolve, reject, timer });
      try {
        client.send({ type: "collaboration.bridge.execute.request", requestId, hostId, operation });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }
  receive(
    clientIds: readonly string[],
    message: { requestId: string; result?: unknown; error?: string },
  ) {
    const p = this.pending.get(message.requestId);
    if (!p || !clientIds.includes(p.clientId)) return;
    clearTimeout(p.timer);
    this.pending.delete(message.requestId);
    if (message.error) p.reject(new Error(message.error));
    else p.resolve(message.result);
  }
}
const bridges = new Map<string, CollaborationBridge>();
export function getCollaborationBridge(home: string) {
  let bridge = bridges.get(home);
  if (!bridge) {
    bridge = new CollaborationBridge();
    bridges.set(home, bridge);
  }
  return bridge;
}
