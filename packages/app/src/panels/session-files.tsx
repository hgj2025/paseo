import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQueries } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { activeConversation } from "@/stores/conversation-layout";
import { buildWorkspaceTabPersistenceKey, type WorkspaceScope } from "@/workspace-tabs/model";
import { scopeWorkspaceTabTarget } from "@/workspace-tabs/scope";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import { fetchCheckoutStatus } from "@/git/checkout-status-cache";
import { useWorkspaceTeamState } from "@/screens/workspace/use-workspace-team";
import { usePaneContext, usePaneFocus } from "./pane-context";
import {
  conversationFileSources,
  fetchSessionFileHistory,
  parentDirectory,
  sessionPaths,
} from "./session-files-model";
import { SessionFilesView, type SessionRepository } from "./session-files-view";

export function SessionFiles({
  onBrowse,
}: {
  onBrowse: (scope: WorkspaceScope, path: string) => void;
}) {
  const queryClient = useQueryClient();
  const pane = usePaneContext();
  const focus = usePaneFocus();
  const owner = pane.layoutOwner ?? pane;
  const key = buildWorkspaceTabPersistenceKey(owner);
  const conversation = useWorkspaceLayoutStore((state) =>
    key ? activeConversation(state, key) : undefined,
  );
  const liveLayout = useWorkspaceLayoutStore((state) =>
    key ? state.layoutByWorkspace[key] : undefined,
  );
  const layout = liveLayout ?? conversation?.layout;
  const teamState = useWorkspaceTeamState(
    owner.serverId,
    owner.workspaceId,
    focus.isWorkspaceFocused,
  );
  const teamContext = teamState.context;
  const sources = useMemo(
    () =>
      conversationFileSources(layout ? collectAllTabs(layout.root) : [], owner, teamContext?.team),
    [layout, owner, teamContext?.team],
  );
  const statuses = useHostRuntimeConnectionStatuses(sources.map((source) => source.serverId));
  const hosts = useHosts();
  const cwdSnapshot = useSessionStore((state) =>
    JSON.stringify(
      sources.map(
        (source) => state.sessions[source.serverId]?.agents.get(source.agentId)?.cwd ?? "",
      ),
    ),
  );
  const workingDirectories: string[] = useMemo(() => JSON.parse(cwdSnapshot), [cwdSnapshot]);
  const histories = useFetchQueries(
    sources.map((source) => ({
      queryKey: ["sessionFileHistory", source.serverId, source.agentId],
      queryFn: () => {
        const client = getHostRuntimeStore().getClient(source.serverId);
        if (!client) throw new Error("Host unavailable");
        return fetchSessionFileHistory(client, source.agentId, (items) =>
          queryClient.setQueryData(["sessionFileHistory", source.serverId, source.agentId], items),
        );
      },
      enabled: focus.isWorkspaceFocused && statuses.get(source.serverId) === "online",
      refetchInterval: 10_000,
      staleTimeMs: 5_000,
      dataShape: "value" as const,
    })),
  );
  const paths = sources.flatMap((source, index) =>
    sessionPaths(histories[index]?.data ?? [], workingDirectories[index] ?? "").map((path) => ({
      path: path.path,
      edited: path.edited,
      scope: source,
    })),
  );
  const [resolvedRoots, setResolvedRoots] = useState<Record<string, string>>({});
  const directories = Array.from(
    new Map(
      paths.map((path) => {
        const original = path.edited ? parentDirectory(path.path) : path.path;
        const directory = resolvedRoots[`${path.scope.serverId}:${original}`] ?? original;
        return [`${path.scope.serverId}:${directory}`, { scope: path.scope, path: directory }];
      }),
    ).values(),
  );
  const checkouts = useFetchQueries(
    directories.map((directory) => ({
      queryKey: ["sessionFilesCheckout", directory.scope.serverId, directory.path],
      queryFn: () => {
        const client = getHostRuntimeStore().getClient(directory.scope.serverId);
        if (!client) throw new Error("Host unavailable");
        return fetchCheckoutStatus({
          client,
          serverId: directory.scope.serverId,
          cwd: directory.path,
        });
      },
      enabled: focus.isWorkspaceFocused && statuses.get(directory.scope.serverId) === "online",
      refetchInterval: 10_000,
      staleTimeMs: 5_000,
      dataShape: "value" as const,
    })),
  );
  useEffect(() => {
    const discovered: Record<string, string> = {};
    for (let index = 0; index < directories.length; index++) {
      const directory = directories[index]!;
      const status = checkouts[index]?.data;
      const id = `${directory.scope.serverId}:${directory.path}`;
      if (
        status?.isGit &&
        !status.error &&
        directory.path !== status.repoRoot &&
        resolvedRoots[id] !== status.repoRoot
      )
        discovered[id] = status.repoRoot;
    }
    if (Object.keys(discovered).length)
      setResolvedRoots((previous) => ({ ...previous, ...discovered }));
  }, [directories, checkouts, resolvedRoots]);
  const repositories = new Map<string, SessionRepository>();
  directories.forEach((directory, index) => {
    const status = checkouts[index]?.data;
    const git = !!status?.isGit && !status.error;
    const root = git ? status.repoRoot : directory.path;
    const id = `${directory.scope.serverId}:${root}`;
    let repository = repositories.get(id);
    if (!repository) {
      repository = {
        key: id,
        root,
        host:
          hosts.find((host) => host.serverId === directory.scope.serverId)?.label ??
          directory.scope.serverId,
        git,
        branch: git ? status.currentBranch : null,
        pending: !status || !!status.error || checkouts[index]!.isError,
        files: [],
        directories: [],
        browse: () => onBrowse(directory.scope, root),
      };
      repositories.set(id, repository);
    }
    for (const path of paths) {
      if (
        path.scope.serverId !== directory.scope.serverId ||
        (resolvedRoots[
          `${path.scope.serverId}:${path.edited ? parentDirectory(path.path) : path.path}`
        ] ?? (path.edited ? parentDirectory(path.path) : path.path)) !== directory.path
      )
        continue;
      if (path.edited) {
        if (!repository.files.some((file) => file.path === path.path))
          repository.files.push({
            path: path.path,
            open: () =>
              pane.openPreferredTarget(
                scopeWorkspaceTabTarget({ kind: "file", path: path.path }, path.scope),
                "explorerFiles",
              ),
          });
      } else if (!repository.directories.includes(path.path))
        repository.directories.push(path.path);
    }
  });
  const queries = useMemo(() => [...histories, ...checkouts], [histories, checkouts]);
  const onRetry = useCallback(() => {
    if (teamState.supported && teamState.connected) teamState.retry();
    for (const query of queries) void query.refetch();
  }, [queries, teamState]);
  return (
    <SessionFilesView
      repositories={Array.from(repositories.values()).sort(
        (a, b) =>
          Number(b.files.length > 0) - Number(a.files.length > 0) || a.root.localeCompare(b.root),
      )}
      loading={
        histories.some((query) => query.isFetching) ||
        checkouts.some((query) => query.isLoading) ||
        Boolean(
          conversation &&
          teamState.supported &&
          teamState.connected &&
          !teamContext?.team &&
          !teamContext?.error,
        )
      }
      failed={
        queries.some((query) => query.isError) ||
        checkouts.some((query) => !!query.data?.error) ||
        !!teamContext?.error
      }
      offline={sources.some((source) => statuses.get(source.serverId) !== "online")}
      onRetry={onRetry}
    />
  );
}
