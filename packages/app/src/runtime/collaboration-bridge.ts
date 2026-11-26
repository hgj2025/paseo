import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CollaborationOperation } from "@getpaseo/protocol/collaboration-bridge";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

type Entry = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>["entries"][number];
type Snapshot = NonNullable<NonNullable<Awaited<ReturnType<DaemonClient["fetchAgent"]>>>["agent"]>;
interface Runtime {
  getHosts(): readonly { serverId: string }[];
  getClient(id: string): DaemonClient | null;
  getSnapshot(id: string): { connectionStatus: string } | null;
  subscribeAll(listener: () => void): () => void;
}
const matches = (entry: Entry, id: string) =>
  entry.item.type === "user_message" &&
  (entry.item.clientMessageId === id ||
    entry.item.messageId === id ||
    entry.item.text.startsWith(`[Team task ${id}]\n`));

function classifyTask(
  agent: Snapshot,
  entries: Entry[],
  taskId: string,
): { status: "completed" | "failed" | "running" | "permission" | "uncertain"; result: string } {
  const start = entries.findIndex((e) => matches(e, taskId));
  if (start < 0)
    return {
      status: "uncertain",
      result: "Task delivery has not been confirmed; it has not been resent.",
    };
  const following = entries.slice(start + 1);
  if (following.some((e) => e.item.type === "user_message"))
    return {
      status: "uncertain",
      result: "A later message followed this task; inspect its result.",
    };
  if (agent.pendingPermissions.length)
    return { status: "permission", result: "Waiting for user permission." };
  if (agent.activeTurn || agent.status === "running")
    return { status: "running", result: "Agent is working." };
  const failure = following.find((e) => e.item.type === "error");
  let outcome: { status: "completed" | "failed"; result: string };
  if (failure?.item.type === "error") outcome = { status: "failed", result: failure.item.message };
  else if (agent.status === "error" || agent.status === "closed")
    outcome = { status: "failed", result: agent.lastError ?? "Agent stopped with an error." };
  else {
    const result = following
      .flatMap((e) => (e.item.type === "assistant_message" ? [e.item.text] : []))
      .join("\n\n");
    if (!result || agent.attentionReason !== "finished")
      return { status: "uncertain", result: "Successful completion has not been confirmed." };
    outcome = { status: "completed", result: result.slice(0, 64000) };
  }
  return outcome;
}

async function listPairedAgents(client: DaemonClient) {
  const agents: Array<{
    Id: string;
    Provider: string;
    Model: string | null;
    Status: string;
    WorkspaceId: string | null;
    Title: string | null;
  }> = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
    const page = await client.fetchAgents({ page: { limit: 100, ...(cursor ? { cursor } : {}) } });
    agents.push(
      ...page.entries.map(({ agent }) => ({
        Id: agent.id,
        Provider: agent.provider,
        Model: agent.model,
        Status: agent.status,
        WorkspaceId: agent.workspaceId ?? null,
        Title: agent.title,
      })),
    );
    if (!page.pageInfo.hasMore) return agents;
    cursor = page.pageInfo.nextCursor ?? undefined;
    if (!cursor) throw new Error("Remote agent directory returned an incomplete page.");
  }
  throw new Error("Remote agent directory is too large; select a workspace in the target pane.");
}

/** Reuses the paired client's permissions and credentials; no host receives another host's credentials. */
export class CollaborationExecutor {
  private terminal = new Map<string, { status: "completed" | "failed"; result: string }>();
  private sends = new Map<string, { fingerprint: string; pending: Promise<unknown> }>();
  constructor(private readonly clientFor: (id: string) => DaemonClient | null) {}
  private tails = new Map<string, Promise<unknown>>();
  execute(hostId: string, op: CollaborationOperation, signal?: AbortSignal): Promise<unknown> {
    const key = JSON.stringify([hostId, op.op === "list" || op.op === "ping" ? op.op : op.agentId]);
    if (this.tails.size >= 128 && !this.tails.has(key))
      return Promise.reject(new Error("Coordinator is busy."));
    const next = (this.tails.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        signal?.throwIfAborted();
        return this.executeSerial(hostId, op, signal);
      });
    this.tails.set(key, next);
    void next
      .finally(() => {
        if (this.tails.get(key) === next) this.tails.delete(key);
      })
      .catch(() => {});
    return next;
  }
  private async executeSerial(
    hostId: string,
    op: CollaborationOperation,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const client = this.clientFor(hostId);
    if (!client) throw new Error("Destination host is disconnected.");
    if (op.op === "ping") {
      await client.ping({ timeoutMs: 3000 });
      return { ok: true };
    }
    if (op.op === "list") return listPairedAgents(client);
    const agent = (await client.fetchAgent(op.agentId))?.agent;
    signal?.throwIfAborted();
    if (!agent || agent.id !== op.agentId) throw new Error("Destination agent is unavailable.");
    if ("workspaceId" in op && op.workspaceId && agent.workspaceId !== op.workspaceId)
      throw new Error("Destination workspace mismatch.");
    if (op.op === "wait") {
      const state = await client.waitForFinish(agent.id, op.timeoutSeconds * 1000);
      const page = await client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 20,
        projection: "projected",
      });
      return {
        agentId: agent.id,
        status: state.status,
        message: page.entries
          .flatMap((e) => ("text" in e.item ? [e.item.text] : []))
          .join("\n\n")
          .slice(0, 64000),
      };
    }
    if (op.op === "archive") {
      if (!agent.archivedAt) await client.archiveAgent(agent.id);
      return { ok: true };
    }
    if (agent.archivedAt) throw new Error("Destination agent is archived.");
    if (op.op === "inspect") {
      const page = await client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 1,
        projection: "projected",
      });
      return {
        Id: agent.id,
        Provider: agent.provider,
        Model: agent.model,
        Cwd: agent.cwd,
        Status: agent.activeTurn || agent.pendingPermissions.length ? "running" : agent.status,
        Archived: false,
        WorkspaceId: agent.workspaceId,
        HistoryEpoch: page.epoch,
        HistorySeq: page.window.maxSeq,
      };
    }
    if (!op.taskId) throw new Error("Task ID is required.");
    const key = JSON.stringify([hostId, op.agentId, op.taskId]);
    if (op.op === "send") return this.send(client, agent, op, key);
    return this.observe(client, agent, op, key);
  }
  private send(
    client: DaemonClient,
    agent: Snapshot,
    op: Extract<CollaborationOperation, { op: "send" }>,
    key: string,
  ) {
    if (!op.prompt) throw new Error("Task prompt is required.");
    const fingerprint = JSON.stringify([op.workspaceId, op.prompt]);
    const previous = this.sends.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error("Task ID belongs to another request.");
      return previous.pending;
    }
    if (this.sends.size >= 2048)
      throw new Error(
        "Coordinator task receipt capacity reached; reconnect before more dispatches.",
      );
    if (
      agent.activeTurn ||
      agent.pendingPermissions.length ||
      !["idle", "closed", "error"].includes(agent.status)
    )
      throw new Error("Destination agent is busy.");
    // Target daemon durably deduplicates the same message ID, including across Mac restarts.
    const pending = client
      .sendAgentMessage(agent.id, op.prompt, {
        messageId: op.taskId,
        activeTurnBehavior: "steer",
      })
      .then(() => ({ agentId: agent.id, status: "sent" }));
    this.sends.set(key, { fingerprint, pending });
    return pending;
  }
  private async observe(
    client: DaemonClient,
    agent: Snapshot,
    op: Extract<CollaborationOperation, { op: "observe" }>,
    key: string,
  ) {
    const completed = this.terminal.get(key);
    if (completed) return completed;
    let page = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 100,
      projection: "projected",
    });
    let entries = page.entries;
    const epoch = page.epoch;
    for (
      let i = 0;
      i < 50 && !entries.some((e) => matches(e, op.taskId!)) && page.hasOlder && page.startCursor;
      i++
    ) {
      page = await client.fetchAgentTimeline(agent.id, {
        direction: "before",
        cursor: page.startCursor,
        limit: 100,
        projection: "projected",
      });
      if (page.epoch !== epoch || page.staleCursor || page.gap)
        return { status: "uncertain", result: "History changed; task completion is unconfirmed." };
      entries.unshift(...page.entries);
    }
    const outcome = classifyTask(agent, entries, op.taskId!);
    if (outcome.status !== "completed" && outcome.status !== "failed") return outcome;
    if (this.terminal.size >= 2048) this.terminal.delete(this.terminal.keys().next().value!);
    this.terminal.set(key, { status: outcome.status, result: outcome.result });
    return outcome;
  }
}

/** Mounted once per authenticated daemon connection, outside conversation/component lifetimes. */
export function mountCollaborationBridge(source: DaemonClient, sourceId: string, runtime: Runtime) {
  const executor = new CollaborationExecutor((id) => runtime.getClient(id));
  const watches = new Map<
    string,
    { hostId: string; client: DaemonClient; release(): Promise<void> }
  >();
  function watch(hostId: string, agentId: string) {
    const key = JSON.stringify([hostId, agentId]);
    const client = runtime.getClient(hostId);
    if (!client) return;
    const existing = watches.get(key);
    if (existing?.client === client) return;
    if (existing) {
      watches.delete(key);
      void existing.release().catch(() => {});
    }
    if (watches.size >= 128) return;
    const observation = client.subscribeAgentTimeline(agentId, (message) => {
      if (disposed || message.type !== "agent_stream") return;
      const event = message.payload.event;
      if (
        [
          "turn_completed",
          "turn_failed",
          "turn_canceled",
          "permission_requested",
          "permission_resolved",
        ].includes(event.type)
      ) {
        try {
          source.sendCollaborationBridgeChanged(hostId, agentId);
        } catch {
          /* Reconnect revalidates route ownership. */
        }
      }
    });
    watches.set(key, { hostId, client, release: () => observation.release() });
    void observation.ready.catch(() => {
      watches.delete(key);
      void observation.release().catch(() => {});
    });
  }
  const authorities = new Map<string, AbortController>();
  let signature = "",
    disposed = false;
  let registration: ReturnType<DaemonClient["registerCollaborationBridge"]> | undefined;
  let unlisten: (() => void) | undefined;
  function sync() {
    if (disposed || source.getLastServerInfoMessage()?.features?.collaborationBridge !== true)
      return;
    const hostIds = runtime
      .getHosts()
      .map((h) => h.serverId)
      .filter((id) => id !== sourceId && runtime.getSnapshot(id)?.connectionStatus === "online")
      .sort();
    for (const [key, observation] of watches)
      if (
        !hostIds.includes(observation.hostId) ||
        runtime.getClient(observation.hostId) !== observation.client
      ) {
        watches.delete(key);
        void observation.release().catch(() => {});
      }
    const next = JSON.stringify(hostIds);
    if (next === signature) return;
    for (const [id, authority] of authorities)
      if (!hostIds.includes(id)) {
        authority.abort(new Error("Destination host disconnected."));
        authorities.delete(id);
      }
    signature = next;
    if (registration) {
      void registration.ready
        .then(() => {
          if (!disposed) source.updateCollaborationBridgeRoutes(JSON.parse(signature) as string[]);
          return undefined;
        })
        .catch(() => {});
      return;
    }
    registration = source.registerCollaborationBridge(hostIds);
    void registration.ready.catch(() => {
      signature = "";
      unlisten?.();
      registration = undefined;
    });
    unlisten = registration.subscribe({
      snapshot: () => {
        if (!disposed)
          try {
            source.updateCollaborationBridgeRoutes(JSON.parse(signature || "[]") as string[]);
          } catch {
            /* Restore updates again after reconnect. */
          }
      },
      update: (message) => {
        if (message.type === "collaboration.bridge.execute.request") void handle(message);
      },
    });
  }
  function authorityFor(hostId: string) {
    let authority = authorities.get(hostId);
    if (!authority) {
      authority = new AbortController();
      authorities.set(hostId, authority);
    }
    return authority;
  }
  async function handle(
    message: Extract<SessionOutboundMessage, { type: "collaboration.bridge.execute.request" }>,
  ) {
    if (disposed) return;
    let response: Parameters<DaemonClient["sendCollaborationBridgeResponse"]>[0];
    try {
      if (
        !runtime.getHosts().some((h) => h.serverId === message.hostId) ||
        runtime.getSnapshot(message.hostId)?.connectionStatus !== "online"
      )
        throw new Error("Destination host is no longer paired and connected.");
      response = {
        type: "collaboration.bridge.execute.response",
        requestId: message.requestId,
        result: await executor.execute(
          message.hostId,
          message.operation,
          authorityFor(message.hostId).signal,
        ),
      };
      if ("agentId" in message.operation)
        try {
          watch(message.hostId, message.operation.agentId);
        } catch {
          /* Polling remains available if a timeline subscription cannot be established. */
        }
    } catch (error) {
      response = {
        type: "collaboration.bridge.execute.response",
        requestId: message.requestId,
        error: (error instanceof Error ? error.message : "Collaboration operation failed").slice(
          0,
          2000,
        ),
      };
    }
    if (!disposed)
      try {
        source.sendCollaborationBridgeResponse(response);
      } catch {
        /* Owner observes an unconfirmed outcome, never implicit resend. */
      }
  }
  const off = runtime.subscribeAll(sync);
  sync();
  return () => {
    disposed = true;
    for (const authority of authorities.values())
      authority.abort(new Error("Collaboration route closed."));
    authorities.clear();
    for (const observation of watches.values()) void observation.release().catch(() => {});
    watches.clear();
    off();
    unlisten?.();
    void registration?.release().catch(() => {});
  };
}
