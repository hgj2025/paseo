import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";
import {
  prepareConversationExecutor,
  readExecutionHistory,
} from "../../../app/src/screens/workspace/conversation-execution.js";
const daemons: TestPaseoDaemon[] = [];
const clients: DaemonClient[] = [];
let root: string | undefined;
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const d of daemons.splice(0)) await d.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function connect(d: TestPaseoDaemon) {
  const c = new DaemonClient({ url: `ws://127.0.0.1:${d.port}/ws`, appVersion: "0.11.2" });
  clients.push(c);
  await c.connect();
  await c.fetchAgents({ subscribe: {} });
  return c;
}
test("real daemon RPC preserves the conversation and context across execution changes", async () => {
  root = await mkdtemp(join(tmpdir(), "paseo-conversation-rpc-"));
  const inputs: { prompt: unknown; systemPrompt?: string }[] = [];
  const owner = await createTestPaseoDaemon({ agentClients: createTestAgentClients() });
  daemons.push(owner);
  const runner = await createTestPaseoDaemon({
    agentClients: createTestAgentClients({
      onStartTurn: (prompt, config) => inputs.push({ prompt, systemPrompt: config.systemPrompt }),
    }),
  });
  daemons.push(runner);
  const source = await connect(owner),
    target = await connect(runner);
  const ownerId = source.getLastServerInfoMessage()!.serverId,
    targetId = target.getLastServerInfoMessage()!.serverId;
  expect(source.getLastServerInfoMessage()!.features?.conversationExecution).toBe(true);
  const srcDir = join(root, "source"),
    dstDir = join(root, "target");
  await mkdir(srcDir);
  await mkdir(dstDir);
  const srcWork = (await source.createWorkspace({ source: { kind: "directory", path: srcDir } }))
    .workspace!.id;
  const dstWork = (await target.createWorkspace({ source: { kind: "directory", path: dstDir } }))
    .workspace!.id;
  const wrapper = join(root, "inspect-peer.mjs"),
    sdk = fileURLToPath(new URL("../../../client/dist/daemon-client.js", import.meta.url));
  await writeFile(
    wrapper,
    `import {DaemonClient} from ${JSON.stringify(sdk)};const c=new DaemonClient({url:${JSON.stringify(`ws://127.0.0.1:${runner.port}/ws`)},appVersion:"0.11.2",clientId:"clid_execution_peer"});await c.connect();await c.fetchAgents({subscribe:{}});try{const a=(await c.fetchAgent(process.argv[4])).agent;const p=await c.fetchAgentTimeline(a.id,{direction:"tail",limit:1,projection:"projected"});process.stdout.write(JSON.stringify({Id:a.id,Provider:a.provider,Status:a.status,Archived:Boolean(a.archivedAt),WorkspaceId:a.workspaceId,HistoryEpoch:p.epoch,HistorySeq:p.window.maxSeq}));}finally{await c.close();}`,
  );
  await writeFile(
    join(owner.paseoHome, "collaboration-hosts.json"),
    JSON.stringify({
      version: 1,
      hosts: [
        {
          id: targetId,
          label: "isolated runner",
          command: [process.execPath, wrapper],
          transport: "cli",
        },
      ],
    }),
  );
  const original = await source.createAgent({
    config: { provider: "claude", cwd: srcDir, title: "Stable conversation" },
    workspaceId: srcWork,
  });
  await source.sendAgentMessage(original.id, "Remember CONTINUITY_MARKER_917. Read-only test.");
  await source.waitForFinish(original.id, 5000);
  const session = randomUUID();
  await source.workspaceTeam(
    srcWork,
    {
      kind: "join",
      serverId: ownerId,
      workspaceId: srcWork,
      agentId: original.id,
      paneId: "main",
      owned: true,
    },
    session,
  );
  const child = await source.createAgent({
    config: { provider: "claude", cwd: srcDir, title: "Stable child" },
    workspaceId: srcWork,
  });
  await source.sendAgentMessage(child.id, "Remember CONTINUITY_MARKER_917. Read-only test.");
  await source.waitForFinish(child.id, 5000);
  const before = await source.workspaceTeam(
    srcWork,
    {
      kind: "join",
      serverId: ownerId,
      workspaceId: srcWork,
      agentId: child.id,
      paneId: "child",
      owned: true,
    },
    session,
  );
  const member = before.members.find((m) => m.agentId === child.id)!;
  await prepareConversationExecutor({
    member,
    scope: { serverId: targetId, workspaceId: dstWork, directory: dstDir },
    provider: "codex",
    model: "gpt-test",
    operationId: randomUUID(),
    clientFor: (id) => (id === ownerId ? source : target),
    commit: (execution, sourceCursor) =>
      source.workspaceTeam(
        srcWork,
        {
          kind: "configure_execution",
          memberId: member.id,
          revision: before.revision,
          execution,
          sourceCursor,
        },
        session,
      ),
  });
  const after = await source.workspaceTeam(srcWork, { kind: "read" }, session);
  const execution = after.members.find((m) => m.id === member.id)!.execution!;
  expect(after.sessionId).toBe(session);
  expect(after.members.find((m) => m.id === member.id)!.id).toBe(member.id);
  expect(after.members.find((m) => m.id === member.id)!.agentId).toBe(child.id);
  expect(after.members.find((m) => m.id === member.id)!.paneId).toBe("child");
  expect(after.retiredMembers).toBeUndefined();
  expect(execution.serverId).toBe(targetId);
  expect((await source.fetchAgent(child.id)).agent!.archivedAt).toBeFalsy();
  await target.sendAgentMessage(execution.agentId, "Continue the same task; keep files unchanged.");
  await target.waitForFinish(execution.agentId, 5000);
  expect(inputs.at(-1)?.systemPrompt).toContain("CONTINUITY_MARKER_917");
  const past = await readExecutionHistory(source, {
      serverId: ownerId,
      workspaceId: srcWork,
      agentId: child.id,
      provider: "claude",
    }),
    present = await readExecutionHistory(target, execution);
  expect(
    past.some(
      (e) => e.item.type === "user_message" && e.item.text.includes("CONTINUITY_MARKER_917"),
    ),
  ).toBe(true);
  expect(
    present.some(
      (e) => e.item.type === "user_message" && e.item.text.includes("Continue the same task"),
    ),
  ).toBe(true);
  const same = await source.workspaceTeam(srcWork, { kind: "read" }, session);
  await prepareConversationExecutor({
    member: same.members.find((m) => m.id === member.id)!,
    scope: { serverId: targetId, workspaceId: dstWork, directory: dstDir },
    provider: "codex",
    model: "gpt-test-switched",
    operationId: randomUUID(),
    clientFor: (id) => (id === ownerId ? source : target),
    commit: async () => {
      throw new Error("In-place model update must not rebind");
    },
  });
  expect((await target.fetchAgent(execution.agentId)).agent!.model).toBe("gpt-test-switched");
  expect(
    (await source.workspaceTeam(srcWork, { kind: "read" }, session)).members.find(
      (m) => m.id === member.id,
    )!.execution!.agentId,
  ).toBe(execution.agentId);
}, 45000);
