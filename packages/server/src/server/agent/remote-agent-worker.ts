/** This function is shipped over an administrator-owned SSH exec channel. Keep runtime
 * dependencies inside it: the remote machine only needs its existing Paseo CLI/SDK. */
export async function remoteAgentWorkerMain(): Promise<void> {
  const { createHash, randomUUID } = await import("node:crypto");
  const { mkdir, readFile, writeFile, rename } = await import("node:fs/promises");
  const { join } = await import("node:path");
  type Client = import("@getpaseo/client/internal/daemon-client").DaemonClient;
  type Entry = Awaited<ReturnType<Client["fetchAgentTimeline"]>>["entries"][number];
  interface Outcome {
    status: "running" | "permission" | "completed" | "failed" | "uncertain";
    result: string;
  }
  interface Receipt {
    agentId: string;
    taskId: string;
    fingerprint: string;
    outcome?: Outcome;
  }
  const home = process.argv[2]!;
  const { connectToDaemon } = (await import(process.argv[1]!)) as {
    connectToDaemon(options: { target: { kind: "instance"; home: string } }): Promise<Client>;
  };
  const client = await connectToDaemon({ target: { kind: "instance", home } });
  const directory = join(home, "collaboration-task-receipts");
  const watches = new Map<string, ReturnType<Client["subscribeAgentTimeline"]>>();
  const changed = new Map<string, ReturnType<typeof setTimeout>>();
  const failures = new Map<string, { turnId?: string; message: string }>();
  const tracked = new Map<string, Set<string>>();
  const tails = new Map<string, Promise<unknown>>();
  const pending = new Set<Promise<void>>();
  let closing = false;
  function emit(value: unknown) {
    process.stdout.write(JSON.stringify(value) + "\n");
  }
  function identity(value: unknown): string {
    if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
      throw new Error("A full UUID is required");
    return value;
  }
  function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    tails.set(key, next);
    void next
      .finally(() => {
        if (tails.get(key) === next) tails.delete(key);
      })
      .catch(() => {});
    return next;
  }
  function file(agentId: string, taskId: string) {
    return join(
      directory,
      createHash("sha256")
        .update(JSON.stringify([agentId, taskId]))
        .digest("hex") + ".json",
    );
  }
  async function read(agentId: string, taskId: string): Promise<Receipt | null> {
    try {
      return JSON.parse(await readFile(file(agentId, taskId), "utf8")) as Receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async function save(receipt: Receipt) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = file(receipt.agentId, receipt.taskId),
      temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  }
  async function watch(agentId: string) {
    const existing = watches.get(agentId);
    if (existing) return existing.ready;
    const subscription = client.subscribeAgentTimeline(agentId, (message) => {
      if (message.type === "agent_stream") {
        const event = message.payload.event;
        if (event.type === "turn_failed" || event.type === "turn_canceled")
          failures.set(agentId, {
            turnId: event.turnId,
            message: event.type === "turn_failed" ? event.error : event.reason,
          });
        // Token chunks do not need a full history refresh. Terminal/permission events do.
        if (
          ![
            "turn_completed",
            "turn_failed",
            "turn_canceled",
            "permission_requested",
            "permission_resolved",
          ].includes(event.type)
        )
          return;
      }
      if (!changed.has(agentId))
        changed.set(
          agentId,
          setTimeout(() => {
            changed.delete(agentId);
            // Save terminal outcomes while this worker is connected, even if the
            // lead has not queried yet. A later user message must not erase a result.
            void serial(agentId, async () => {
              for (const taskId of tracked.get(agentId) ?? []) {
                const outcome = await observe(agentId, taskId);
                if (outcome.status === "completed" || outcome.status === "failed")
                  tracked.get(agentId)?.delete(taskId);
              }
            })
              .catch(() => {})
              .finally(() => {
                if (!closing) emit({ event: "changed", agentId });
              });
          }, 40),
        );
    });
    watches.set(agentId, subscription);
    try {
      await subscription.ready;
    } catch (error) {
      watches.delete(agentId);
      throw error;
    }
  }
  async function inspect(agentId: string, workspaceId?: unknown) {
    const response = await client.fetchAgent(agentId);
    const agent = response?.agent;
    if (!agent || agent.id !== agentId || agent.archivedAt)
      throw new Error("Remote agent is unavailable");
    if (typeof workspaceId === "string" && agent.workspaceId !== workspaceId)
      throw new Error("Remote agent does not belong to the selected workspace");
    return agent;
  }
  const matchesTask = (entry: Entry, taskId: string) =>
    entry.item.type === "user_message" &&
    (entry.item.clientMessageId === taskId ||
      entry.item.messageId === taskId ||
      entry.item.text.startsWith(`[Team task ${taskId}]\n`));
  async function taskEntries(agentId: string, taskId: string): Promise<Entry[] | null> {
    let page = await client.fetchAgentTimeline(agentId, {
      direction: "tail",
      limit: 100,
      projection: "projected",
    });
    let entries: Entry[] = page.entries;
    for (
      let n = 0;
      !entries.some((entry) => matchesTask(entry, taskId)) &&
      page.hasOlder &&
      page.startCursor &&
      n < 50;
      n++
    ) {
      const older = await client.fetchAgentTimeline(agentId, {
        direction: "before",
        cursor: page.startCursor,
        limit: 100,
        projection: "projected",
      });
      if (older.epoch !== page.epoch || older.staleCursor || older.gap) return null;
      entries.unshift(...older.entries);
      page = older;
    }
    return entries;
  }
  async function classify(agentId: string, first: Entry, following: Entry[]): Promise<Outcome> {
    const agent = await inspect(agentId);
    const turnId = first.turnId ?? following.find((entry) => entry.turnId)?.turnId;
    const failure = failures.get(agentId);
    const error = following.find((entry) => entry.item.type === "error");
    let outcome: Outcome;
    if (failure?.turnId && failure.turnId === turnId)
      outcome = { status: "failed", result: failure.message };
    else if (agent.pendingPermissions.length)
      return { status: "permission", result: "Waiting for user permission." };
    else if (agent.status === "running") return { status: "running", result: "Agent is working." };
    else if (agent.status === "error" || agent.status === "closed" || error)
      outcome = {
        status: "failed",
        result:
          error?.item.type === "error"
            ? error.item.message
            : (agent.lastError ?? "Agent stopped with an error."),
      };
    else {
      const result = following
        .flatMap((entry) => (entry.item.type === "assistant_message" ? [entry.item.text] : []))
        .join("\n\n");
      // Idle alone is not a completion receipt (e.g. delivery/start or manual-stop races).
      if (!result || agent.attentionReason !== "finished")
        return {
          status: "uncertain",
          result: "The task is present, but successful completion has not been confirmed.",
        };
      outcome = { status: "completed", result };
    }
    return outcome;
  }
  async function observe(agentId: string, taskId: string): Promise<Outcome> {
    const receipt = await read(agentId, taskId);
    if (receipt?.outcome) return receipt.outcome;
    if (receipt) {
      if (!tracked.has(agentId)) tracked.set(agentId, new Set());
      tracked.get(agentId)!.add(taskId);
    }
    await watch(agentId);
    const entries = await taskEntries(agentId, taskId);
    if (!entries)
      return {
        status: "uncertain",
        result: "Conversation history changed; waiting to reconcile this task.",
      };
    const start = entries.findIndex((entry) => matchesTask(entry, taskId));
    if (start < 0)
      return {
        status: "uncertain",
        result:
          "Task delivery has not been confirmed in the remote conversation. It has not been resent.",
      };
    const following = entries.slice(start + 1);
    if (following.some((entry) => entry.item.type === "user_message"))
      return {
        status: "uncertain",
        result:
          "Another message followed this task before its completion was recorded. Inspect the conversation.",
      };
    const outcome = await classify(agentId, entries[start]!, following);
    if (receipt && (outcome.status === "completed" || outcome.status === "failed"))
      await save({ ...receipt, outcome });
    return outcome;
  }
  async function handle(request: Record<string, unknown>): Promise<unknown> {
    if (request.op === "ping") {
      await client.ping({ timeoutMs: 3000 });
      return { ok: true };
    }
    const agentId = identity(request.agentId);
    if (request.op === "watch") {
      await watch(agentId);
      return { ok: true };
    }
    if (request.op === "inspect") {
      const a = await inspect(agentId, request.workspaceId);
      return {
        Id: a.id,
        Provider: a.provider,
        Status: a.status,
        Archived: Boolean(a.archivedAt),
        WorkspaceId: a.workspaceId,
      };
    }
    if (request.op === "observe")
      return serial(agentId, async () => {
        const outcome = await observe(agentId, identity(request.taskId));
        return outcome.result.length > 64000
          ? {
              ...outcome,
              result:
                outcome.result.slice(0, 64000) +
                "\n[Result truncated; the complete result is retained on the worker.]",
            }
          : outcome;
      });
    if (request.op === "send")
      return serial(agentId, async () => {
        const taskId = identity(request.taskId);
        if (
          typeof request.prompt !== "string" ||
          !request.prompt.trim() ||
          request.prompt.length > 41000
        )
          throw new Error("Invalid task prompt");
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([request.prompt, request.workspaceId ?? null]))
          .digest("hex");
        const previous = await read(agentId, taskId);
        if (previous && previous.fingerprint !== fingerprint)
          throw new Error("Task ID belongs to another request");
        const a = await inspect(agentId, request.workspaceId);
        if (!previous && (a.status !== "idle" || a.pendingPermissions.length))
          throw new Error("Remote agent is busy");
        await watch(agentId);
        if (!previous) await save({ agentId, taskId, fingerprint });
        if (!tracked.has(agentId)) tracked.set(agentId, new Set());
        tracked.get(agentId)!.add(taskId);
        // The daemon's durable receipt deduplicates this same message across worker restarts.
        await client.sendAgentMessage(agentId, request.prompt, {
          messageId: taskId,
          activeTurnBehavior: "steer",
        });
        return { agentId, status: "sent" };
      });
    if (request.op === "wait") {
      const seconds = Number(request.timeoutSeconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30)
        throw new Error("Invalid wait timeout");
      const state = await client.waitForFinish(agentId, seconds * 1000);
      const page = await client.fetchAgentTimeline(agentId, {
        direction: "tail",
        limit: 20,
        projection: "projected",
      });
      return {
        agentId,
        status: state.status,
        message: page.entries
          .flatMap((e) => ("text" in e.item ? [e.item.text] : []))
          .join("\n\n")
          .slice(-64000),
      };
    }
    throw new Error("Unknown collaboration operation");
  }
  function dispatch(request: Record<string, unknown>) {
    if (pending.size >= 32) {
      emit({ id: request.id, error: "Remote collaboration is busy; retry later" });
      return;
    }
    const operation = handle(request).then(
      (result) => emit({ id: request.id, result }),
      (error) => emit({ id: request.id, error: String(error) }),
    );
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  }
  emit({ event: "ready", version: 1, serverId: client.getLastServerInfoMessage()?.serverId });
  try {
    let buffer = "";
    for await (const chunk of process.stdin) {
      buffer += String(chunk);
      if (Buffer.byteLength(buffer) > 1024 * 1024)
        throw new Error("Collaboration input is too large");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line) dispatch(JSON.parse(line) as Record<string, unknown>);
      }
    }
  } finally {
    closing = true;
    for (const timer of changed.values()) clearTimeout(timer);
    for (const subscription of watches.values()) subscription();
    await client.close();
    await Promise.allSettled(pending);
  }
}
