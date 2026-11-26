import {
  beginNavigationTrace,
  navigationDispatched,
  navigationFailed,
} from "@/navigation/diagnostics/collector";
import { router, type Href } from "expo-router";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { resolveNavigateToAgent, type NavigateToAgentInput } from "./resolve";

export type { NavigateToAgentInput } from "./resolve";

export function navigateToAgent(input: NavigateToAgentInput): string {
  const session = useSessionStore.getState().sessions[input.serverId];
  const agent = session?.agents.get(input.agentId) ?? session?.agentDetails.get(input.agentId);
  const traceId = beginNavigationTrace({
    serverId: input.serverId,
    agentId: input.agentId,
    workspaceId: input.workspaceId ?? agent?.workspaceId,
  });
  try {
    const route = resolveNavigateToAgent(input, {
      readAgentNavTarget: ({ serverId, agentId }) => {
        const session = useSessionStore.getState().sessions[serverId];
        const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
        return {
          agentWorkspaceId: agent?.workspaceId,
        };
      },
      navigateToHostAgent: (route) => {
        router.navigate(route as Href);
      },
      navigateToWorkspace,
    });
    navigationDispatched(traceId);
    return route;
  } catch (error) {
    navigationFailed(traceId);
    throw error;
  }
}
