import type { Logger } from "pino";
import { z } from "zod";
import { join } from "node:path";
import { MessageReceipts } from "./message-receipts/index.js";
import { disposeRemoteAgentPool } from "./agent/remote-agent-connection.js";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import { sendPromptToAgent, waitForAgentRunStartWithTimeout } from "./agent/agent-prompt.js";
import { RemoteAgents } from "./agent/remote-agents.js";
import { getOrCreateServerId } from "./server-id.js";
import { WorkspaceTeamService, teamTaskMarker } from "./workspace-team-service.js";

interface Dependencies {
  paseoHome: string;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}
const services = new WeakMap<AgentManager, WorkspaceTeamService>();
const Inspection = z.object({
  Id: z.string(),
  Provider: z.string(),
  Status: z.string(),
  Archived: z.boolean().optional(),
});
const Observation = z.object({
  agentId: z.string(),
  status: z.enum(["idle", "timeout", "permission", "error"]),
  message: z.string(),
});

export function getWorkspaceTeamService(deps: Dependencies): WorkspaceTeamService {
  const existing = services.get(deps.agentManager);
  if (existing) return existing;
  const { paseoHome, agentManager, agentStorage, logger } = deps;
  const serverId = getOrCreateServerId(paseoHome);
  const remote = new RemoteAgents(paseoHome);
  const notifications = new MessageReceipts(join(paseoHome, "workspace-team-notifications"));
  const service = new WorkspaceTeamService(paseoHome, serverId, {
    subscribe(listener) {
      const offRemote = remote.subscribe(listener);
      const offLocal = agentManager.subscribe(
        (event) => {
          if (event.type === "agent_state") listener({ serverId, agentId: event.agent.id });
          else if (
            event.type === "agent_stream" &&
            [
              "turn_completed",
              "turn_failed",
              "turn_canceled",
              "permission_requested",
              "permission_resolved",
            ].includes(event.event.type)
          )
            listener({ serverId, agentId: event.agentId });
        },
        { replayState: false },
      );
      return () => {
        offRemote();
        offLocal();
      };
    },
    dispose() {
      disposeRemoteAgentPool(paseoHome);
    },
    async inspect(member) {
      if (member.serverId !== serverId) {
        const result = Inspection.parse(
          await remote.inspect(member.serverId, member.agentId, member.workspaceId),
        );
        if (result.Id !== member.agentId || result.Archived)
          throw new Error("Remote agent is unavailable.");
        return { provider: result.Provider, busy: !["idle", "closed"].includes(result.Status) };
      }
      const record = await agentStorage.get(member.agentId);
      if (
        !record ||
        record.archivedAt ||
        record.internal ||
        record.workspaceId !== member.workspaceId
      )
        throw new Error("Agent does not belong to this workspace.");
      const snapshot = agentManager.getAgent(member.agentId);
      return {
        provider: record.provider,
        busy:
          agentManager.hasInFlightRun(member.agentId) ||
          Boolean(snapshot?.pendingPermissions?.size),
      };
    },
    async send(member, task) {
      const prompt = `${teamTaskMarker(task)}\n${task.prompt}`;
      if (member.serverId !== serverId) {
        const receipt = await remote.send({
          callerId: "workspace-team",
          hostId: member.serverId,
          agentId: member.agentId,
          requestId: task.id,
          prompt,
          workspaceId: member.workspaceId,
        });
        return receipt.state === "acknowledged" ? "acknowledged" : "uncertain";
      }
      const sent = await sendPromptToAgent({
        agentManager,
        agentStorage,
        agentId: member.agentId,
        prompt,
        messageId: task.id,
        logger,
      });
      if (sent.disposition === "turn_started")
        await waitForAgentRunStartWithTimeout(agentManager, member.agentId);
      return "acknowledged";
    },
    async observe(member, task) {
      if (member.serverId !== serverId) {
        const correlated = await remote.observeTask(member.serverId, member.agentId, task.id);
        if (correlated !== null)
          return z
            .object({
              status: z.enum(["running", "permission", "completed", "failed", "uncertain"]),
              result: z.string(),
            })
            .parse(correlated);
        const result = Observation.parse(await remote.wait(member.serverId, member.agentId, 1));
        if (result.agentId !== member.agentId)
          throw new Error("Remote host returned another agent.");
        if (
          result.status === "idle" &&
          !task.observedRunning &&
          !result.message.includes(teamTaskMarker(task))
        )
          return {
            status: "uncertain",
            result:
              "Agent is idle, but this task's completion could not be correlated. Inspect its conversation.",
          };
        return {
          status: (
            {
              idle: "completed",
              timeout: "running",
              error: "failed",
              permission: "permission",
            } as const
          )[result.status],
          result: result.message,
        };
      }
      const snapshot = agentManager.getAgent(member.agentId);
      if (!snapshot) throw new Error("Agent is not loaded.");
      if (snapshot.pendingPermissions.size)
        return { status: "permission", result: "Waiting for user permission." };
      if (agentManager.hasInFlightRun(member.agentId))
        return { status: "running", result: "Agent is working." };
      const timeline = agentManager.getTimeline(member.agentId);
      const start = timeline.findIndex(
        (item) =>
          item.type === "user_message" &&
          (item.clientMessageId === task.id ||
            item.messageId === task.id ||
            item.text.startsWith(teamTaskMarker(task))),
      );
      if (start < 0)
        return {
          status: "uncertain",
          result: "Could not correlate task completion with this conversation.",
        };
      const following = timeline.slice(start + 1);
      const nextUser = following.findIndex((item) => item.type === "user_message");
      if (nextUser >= 0)
        return {
          status: "uncertain",
          result:
            "Another message followed this task. Inspect the target conversation before confirming its outcome.",
        };
      const result = following
        .filter((item) => item.type === "assistant_message")
        .map((item) => item.text)
        .join("\n\n");
      return {
        status:
          snapshot.lifecycle === "error" || snapshot.lifecycle === "closed"
            ? "failed"
            : "completed",
        result: result || "Agent finished without a text response.",
      };
    },
    async notify(captain, task) {
      if (captain.serverId !== serverId) throw new Error("Captain must run on the team host.");
      const record = await agentStorage.get(captain.agentId);
      if (!record || record.archivedAt) throw new Error("Captain is unavailable.");
      const messageId = task.notificationId ?? `team-report-${task.id}`;
      if (
        agentManager
          .getTimeline(captain.agentId)
          .some(
            (item) =>
              item.type === "user_message" &&
              (item.clientMessageId === messageId || item.messageId === messageId),
          )
      )
        return;
      const prompt = `${task.groupId ? `[Team request result ${task.groupId}]\n` : ""}Team task ${task.id} ${task.status}. Summarize this result for the user; do not dispatch more work unless the user requested it.\nTask: ${task.prompt}\nResult:\n${task.result}`;
      await notifications.send({
        agentId: captain.agentId,
        messageId,
        request: { prompt },
        send: async () => {
          await sendPromptToAgent({
            agentManager,
            agentStorage,
            agentId: captain.agentId,
            prompt,
            messageId,
            activeTurnBehavior: "steer",
            unarchive: false,
            logger,
          });
        },
      });
    },
  });
  services.set(agentManager, service);
  void service.resume().catch((err) => logger.error({ err }, "Failed to restore workspace teams"));
  return service;
}
