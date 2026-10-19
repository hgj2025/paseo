import { useMemo, useState, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  buildSelectableProviderSelectorProviders,
  resolveSelectedModelLabel,
} from "@/provider-selection/provider-selection";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspaceScopeOptions } from "@/stores/session-store-hooks";
import { useModelHostContext } from "./model-host-context";
import { prepareConversationExecutor } from "./conversation-execution";
function supportsExecution(context: ReturnType<typeof useModelHostContext>) {
  return Boolean(context?.member && context.teamContext?.supportsExecution);
}

function useExecutionScope(serverId: string | null) {
  const context = useModelHostContext();
  const current = context?.member?.execution;
  const host = context?.previewHost ?? current?.serverId ?? serverId;
  const workspaceId =
    context?.candidate?.workspaceId ?? current?.workspaceId ?? context?.member?.workspaceId;
  const scopes = useWorkspaceScopeOptions(host ? [host] : []);
  const scope =
    context?.candidate ?? scopes.find((s) => s.serverId === host && s.workspaceId === workspaceId);
  const enabled = supportsExecution(context);
  const snapshot = useProvidersSnapshot(host, { enabled, cwd: scope?.directory });
  return { context, current, host, scope, enabled, snapshot };
}

function resolveExecutionModel(
  providers: ProviderSelectorProvider[],
  input: { provider: string; model: string },
  host: string | null | undefined,
  activeHost: string | undefined,
) {
  const selected = providers.find((p) => p.id === input.provider) ?? providers[0];
  const rows = selected?.modelSelection.kind === "models" ? selected.modelSelection.rows : [];

  const selectedModel =
    host === activeHost && selected?.id === input.provider
      ? input.model
      : ((rows.find((r) => r.isDefault) ?? rows[0])?.modelId ?? "");
  return { selected, selectedModel };
}

export function useExecutionModelSelection(input: {
  providers: ProviderSelectorProvider[];
  provider: string;
  model: string;
  serverId: string | null;
  loading: boolean;
}) {
  const { context, current, host, scope, enabled, snapshot } = useExecutionScope(input.serverId);
  const providers = useMemo(
    () =>
      enabled ? buildSelectableProviderSelectorProviders(snapshot.entries ?? []) : input.providers,
    [enabled, snapshot.entries, input.providers],
  );
  const { selected, selectedModel } = resolveExecutionModel(
    providers,
    input,
    host,
    current?.serverId ?? context?.serverId,
  );
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const select = enabled
    ? async (provider: string, model: string) => {
        if (!context?.member || !context.teamContext)
          throw new Error("Execution workspace is unavailable.");
        const destinationScope = scope ?? (await context.requestScope());
        if (!destinationScope) return;
        if (pendingRef.current) throw new Error("An execution change is already in progress.");
        if (
          context.member.id === context.teamContext.team?.captainId &&
          destinationScope.serverId !== context.teamContext.ownerServerId
        )
          throw new Error(
            "Captain execution must remain on the team host until remote team tools are supported.",
          );
        pendingRef.current = true;
        context.setSwitching(true);
        setPending(true);
        try {
          await prepareConversationExecutor({
            member: context.member,
            scope: destinationScope,
            provider,
            model,
            operationId: uuid(),
            clientFor: (id) => getHostRuntimeStore().getClient(id),
            commit: async (execution, sourceCursor) => {
              const page = await getHostRuntimeStore().fetchAgentTimeline(
                execution.serverId,
                execution.agentId,
                { direction: "tail", limit: 500, projection: "projected" },
              );
              if (page.error || !page.agent)
                throw new Error(
                  "The destination executor could not be prepared; the conversation has not changed.",
                );
              try {
                return await context.teamContext!.execute({
                  kind: "configure_execution",
                  memberId: context.member!.id,
                  revision: context.teamContext!.team!.revision,
                  execution,
                  sourceCursor,
                });
              } catch (error) {
                const latest = await context
                  .teamContext!.execute({ kind: "read" })
                  .catch(() => null);
                if (
                  latest?.members.find((m) => m.id === context.member!.id)?.execution
                    ?.operationId === execution.operationId
                )
                  return latest;
                throw error;
              }
            },
          });
          context.selectCandidate(null);
        } finally {
          pendingRef.current = false;
          context.setSwitching(false);
          setPending(false);
        }
      }
    : null;
  return {
    context,
    currentModelLabel: resolveSelectedModelLabel({
      providers: input.providers,
      selectedProvider: input.provider,
      selectedModel: input.model,
      isLoading: input.loading,
    }),
    providers,
    provider: selected?.id ?? input.provider,
    model: selectedModel,
    serverId: host,
    loading: enabled ? snapshot.isLoading : input.loading,
    pending,
    isPreviewing: Boolean(context?.previewHost),
    select,
  };
}
