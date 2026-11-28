import type { CollaborationHealthReport } from "@getpaseo/protocol/collaboration-bridge";
import { getCollaborationBridge } from "./collaboration-bridge.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { getRemoteAgentPool, type RemoteChange } from "./remote-agent-connection.js";

const executeFile = promisify(execFile);
const HostSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  // Administrator-owned argv, never supplied by the agent or workspace files.
  command: z.array(z.string().min(1)).min(1),
  transport: z.enum(["cli", "persistent"]).optional(),
});
const ConfigSchema = z.object({ version: z.literal(1), hosts: z.array(HostSchema) });
const ReceiptSchema = z.object({
  fingerprint: z.string(),
  state: z.enum(["dispatching", "acknowledged", "uncertain"]),
  result: z.unknown().optional(),
});
export type RemoteAgentHost = z.infer<typeof HostSchema>;
type Receipt = z.infer<typeof ReceiptSchema>;
export type RemoteAgentCommand = (
  host: RemoteAgentHost,
  args: string[],
  timeoutMs: number,
) => Promise<unknown>;

async function runCommand(
  host: RemoteAgentHost,
  args: string[],
  timeout: number,
): Promise<unknown> {
  const { stdout } = await executeFile(
    host.command[0]!,
    [...host.command.slice(1), ...args, "--json"],
    {
      timeout,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, PASEO_AGENT_ID: "" },
    },
  );
  return JSON.parse(stdout);
}

/** A named bridge to an already paired host; this never installs or restarts a remote daemon. */
export class RemoteAgents {
  constructor(
    private readonly home: string,
    private readonly run: RemoteAgentCommand = runCommand,
  ) {}

  private async hosts(): Promise<RemoteAgentHost[]> {
    try {
      const data = await readFile(join(this.home, "collaboration-hosts.json"), "utf8");
      const config = ConfigSchema.parse(JSON.parse(data));
      if (new Set(config.hosts.map((host) => host.id)).size !== config.hosts.length) {
        throw new Error("Duplicate collaboration host IDs");
      }
      return config.hosts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async host(hostId: string): Promise<RemoteAgentHost> {
    if (getCollaborationBridge(this.home).has(hostId))
      return { id: hostId, label: hostId, command: [], transport: "persistent" as const };
    const host = (await this.hosts()).find((entry) => entry.id === hostId);
    if (!host)
      throw new Error(
        `No connected Mac collaboration route or configured direct connection for ${hostId}. Open Paseo on the coordinator Mac and connect this host.`,
      );
    return host;
  }

  private request(host: RemoteAgentHost, operation: Record<string, unknown>, timeout: number) {
    const bridge = getCollaborationBridge(this.home);
    if (host.command.length === 0) return bridge.execute(host.id, operation);
    return getRemoteAgentPool(this.home).connection(host).request(operation, timeout);
  }
  async health(): Promise<Omit<CollaborationHealthReport, "requestId">> {
    const bridge = getCollaborationBridge(this.home);
    let configured: RemoteAgentHost[];
    try {
      configured = await this.hosts();
    } catch {
      return { checkedAt: new Date().toISOString(), error: "invalid_configuration", routes: [] };
    }
    const hosts = new Map(configured.map((host) => [host.id, host]));
    for (const id of bridge.hostIds())
      if (!hosts.has(id)) hosts.set(id, { id, label: id, command: [] });
    const routes: CollaborationHealthReport["routes"] = [...hosts.values()].map((host) => {
      let transport: "mac" | "ssh" | "cli" = host.transport === "persistent" ? "ssh" : "cli";
      if (bridge.has(host.id)) transport = "mac";
      return {
        hostId: host.id,
        label: host.label,
        transport,
        status: "unchecked",
        latencyMs: null,
        error: null,
      };
    });
    // Bound fan-out and total work. Large registries show untested routes honestly.
    let cursor = 0;
    const deadline = Date.now() + 5000;
    await Promise.all(
      Array.from({ length: Math.min(4, routes.length) }, async () => {
        while (cursor < routes.length && Date.now() < deadline) {
          const route = routes[cursor++]!;
          if (route.transport === "cli") continue;
          const start = performance.now();
          try {
            const host = hosts.get(route.hostId)!;
            if (route.transport === "mac") await bridge.execute(route.hostId, { op: "ping" });
            else await this.request(host, { op: "ping" }, 5000);
            route.status = "ok";
            route.latencyMs = Math.round(performance.now() - start);
          } catch (error) {
            route.status = "error";
            const message = String(error).toLowerCase();
            // Never expose administrator command argv, stderr, URLs or credentials.
            route.error = "unavailable";
            if (message.includes("timeout") || message.includes("timed out"))
              route.error = "timeout";
            else if (message.includes("not connected") || message.includes("disconnected"))
              route.error = "disconnected";
          }
        }
      }),
    );
    return { checkedAt: new Date().toISOString(), error: null, routes };
  }
  async list(hostId?: string): Promise<unknown> {
    const bridge = getCollaborationBridge(this.home);
    if (!hostId) {
      const hosts = new Map((await this.hosts()).map(({ id, label }) => [id, { id, label }]));
      for (const id of bridge.hostIds()) if (!hosts.has(id)) hosts.set(id, { id, label: id });
      return { hosts: [...hosts.values()] };
    }
    const host = await this.host(hostId);
    return {
      hostId,
      agents:
        host.command.length === 0
          ? await bridge.execute(hostId, { op: "list" })
          : await this.run(host, ["agent", "ls", "--global"], 20000),
    };
  }

  subscribe(listener: (event: RemoteChange) => void) {
    const offDirect = getRemoteAgentPool(this.home).subscribe(listener);
    const offBridge = getCollaborationBridge(this.home).subscribe(listener);
    return () => {
      offDirect();
      offBridge();
    };
  }

  async observeTask(
    hostId: string,
    agentId: string,
    taskId: string,
    workspaceId?: string,
  ): Promise<unknown | null> {
    z.string().uuid().parse(agentId);
    z.string().uuid().parse(taskId);
    const host = await this.host(hostId);
    if (host.command.length === 0)
      return this.request(
        host,
        { op: "observe", agentId, taskId, workspaceId: workspaceId ?? "" },
        30000,
      );
    if (host.transport !== "persistent") return null;
    const connection = getRemoteAgentPool(this.home).connection(host);
    await connection.request({ op: "watch", agentId });
    return connection.request({ op: "observe", agentId, taskId }, 30_000);
  }

  async inspect(hostId: string, agentId: string, workspaceId?: string): Promise<unknown> {
    z.string().uuid().parse(agentId);
    const host = await this.host(hostId);
    if (host.transport === "persistent")
      return this.request(
        host,
        { op: "inspect", agentId, ...(workspaceId ? { workspaceId } : {}) },
        30000,
      );
    return this.run(host, ["agent", "inspect", agentId], 20_000);
  }

  async archive(hostId: string, agentId: string, workspaceId: string): Promise<void> {
    z.string().uuid().parse(agentId);
    const host = await this.host(hostId);
    if (host.transport !== "persistent")
      throw new Error("Conversation archival requires a persistent host connection.");
    await this.request(host, { op: "archive", agentId, workspaceId }, 30000);
  }
  async send(input: {
    callerId: string;
    hostId: string;
    agentId: string;
    requestId: string;
    prompt: string;
    workspaceId?: string;
  }): Promise<Receipt> {
    // Exact IDs prevent a CLI prefix match from dispatching to an unintended agent.
    z.string().uuid().parse(input.agentId);
    z.string().uuid().parse(input.requestId);
    const host = await this.host(input.hostId);
    const key = createHash("sha256")
      .update(JSON.stringify([input.callerId, input.hostId, input.requestId]))
      .digest("hex");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          input.workspaceId
            ? [input.agentId, input.prompt, input.workspaceId]
            : [input.agentId, input.prompt],
        ),
      )
      .digest("hex");
    const directory = join(this.home, "remote-agent-dispatches");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${key}.json`);
    const receipt: Receipt = { fingerprint, state: "dispatching" };
    try {
      await writeFile(path, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let previous: Receipt;
      try {
        previous = ReceiptSchema.parse(JSON.parse(await readFile(path, "utf8")));
      } catch {
        // A concurrent caller may observe the initial exclusive file before its write completes.
        return { fingerprint, state: "uncertain" };
      }
      if (previous.fingerprint !== fingerprint)
        throw new Error("Request ID was already used for a different task", { cause: error });
      // An interrupted or concurrent send has an unknown outcome. Never retry it implicitly.
      return previous.state === "dispatching" ? { ...previous, state: "uncertain" } : previous;
    }
    try {
      const workspaceId =
        input.workspaceId ??
        (host.command.length === 0
          ? z
              .object({ WorkspaceId: z.string().min(1) })
              .parse(await this.inspect(input.hostId, input.agentId)).WorkspaceId
          : undefined);
      receipt.result =
        host.transport === "persistent"
          ? await this.request(
              host,
              {
                op: "send",
                agentId: input.agentId,
                taskId: input.requestId,
                prompt: input.prompt,
                workspaceId,
              },
              25_000,
            )
          : await this.run(
              host,
              ["agent", "send", input.agentId, "--no-wait", "--prompt", input.prompt],
              25_000,
            );
      const result = z
        .object({ agentId: z.string(), status: z.literal("sent") })
        .parse(receipt.result);
      if (result.agentId !== input.agentId)
        throw new Error("Bridge acknowledged a different agent");
      receipt.state = "acknowledged";
    } catch {
      receipt.state = "uncertain";
      receipt.result = {
        message:
          "Dispatch outcome is unknown. Inspect the target before creating a new request; this request will not be resent.",
      };
    }
    await writeFile(`${path}.tmp`, JSON.stringify(receipt), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    return receipt;
  }

  async wait(hostId: string, agentId: string, timeoutSeconds = 15): Promise<unknown> {
    z.string().uuid().parse(agentId);
    z.number().int().min(1).max(30).parse(timeoutSeconds);
    const host = await this.host(hostId);
    if (host.command.length === 0)
      return getCollaborationBridge(this.home).execute(hostId, {
        op: "wait",
        agentId,
        timeoutSeconds,
      });
    if (host.transport === "persistent")
      return getRemoteAgentPool(this.home)
        .connection(host)
        .request({ op: "wait", agentId, timeoutSeconds }, (timeoutSeconds + 10) * 1000);
    return this.run(
      host,
      ["agent", "wait", agentId, "--timeout", String(timeoutSeconds)],
      (timeoutSeconds + 10) * 1000,
    );
  }
}
