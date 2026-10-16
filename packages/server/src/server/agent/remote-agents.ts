import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const executeFile = promisify(execFile);
const HostSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  // Administrator-owned argv, never supplied by the agent or workspace files.
  command: z.array(z.string().min(1)).min(1),
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
    const host = (await this.hosts()).find((entry) => entry.id === hostId);
    if (!host) throw new Error(`Collaboration host is not configured: ${hostId}`);
    return host;
  }

  async list(hostId?: string): Promise<unknown> {
    if (!hostId) return { hosts: (await this.hosts()).map(({ id, label }) => ({ id, label })) };
    return {
      hostId,
      agents: await this.run(await this.host(hostId), ["agent", "ls", "--global"], 20_000),
    };
  }

  async send(input: {
    callerId: string;
    hostId: string;
    agentId: string;
    requestId: string;
    prompt: string;
  }): Promise<Receipt> {
    // Exact IDs prevent a CLI prefix match from dispatching to an unintended agent.
    z.string().uuid().parse(input.agentId);
    z.string().uuid().parse(input.requestId);
    const host = await this.host(input.hostId);
    const key = createHash("sha256")
      .update(JSON.stringify([input.callerId, input.hostId, input.requestId]))
      .digest("hex");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([input.agentId, input.prompt]))
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
      receipt.result = await this.run(
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
    return this.run(
      await this.host(hostId),
      ["agent", "wait", agentId, "--timeout", String(timeoutSeconds)],
      (timeoutSeconds + 10) * 1000,
    );
  }
}
