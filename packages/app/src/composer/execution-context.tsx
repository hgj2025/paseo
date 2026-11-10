import { useIsCompactFormFactor } from "@/constants/layout";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFetchQueries } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { fetchCheckoutStatus } from "@/git/checkout-status-cache";
import { executionDirectories } from "./execution-context-model";
import { ExecutionContextView, type ExecutionRepository } from "./execution-context-view";

export function ComposerExecutionContext({
  serverId,
  agentId,
  cwd,
  trailing,
}: {
  serverId: string;
  agentId: string;
  cwd: string;
  trailing?: ReactNode;
}) {
  const compact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const head = useSessionStore((state) => state.sessions[serverId]?.agentStreamHead.get(agentId));
  const tail = useSessionStore((state) => state.sessions[serverId]?.agentStreamTail.get(agentId));
  const directories = useMemo(
    () => executionDirectories(cwd, [...(tail ?? []), ...(head ?? [])]),
    [cwd, head, tail],
  );
  const [roots, setRoots] = useState<Record<string, string>>({});
  const targets = new Map<string, boolean>();
  for (const directory of directories) {
    const path = roots[directory.path] ?? directory.path;
    targets.set(path, directory.edited || targets.get(path) === true);
  }
  const resolvedDirectories = Array.from(targets, ([path, edited]) => ({ path, edited }));
  // Additional repositories may have no workspace subscription. Poll while this bar is mounted.
  const queries = useFetchQueries(
    resolvedDirectories.map((directory) => ({
      queryKey: ["composerExecutionCheckout", serverId, directory.path],
      queryFn: () => {
        if (!client) throw new Error("Host unavailable");
        return fetchCheckoutStatus({ client, serverId, cwd: directory.path });
      },
      enabled: connected && !!client,
      refetchInterval: 5_000,
      refetchOnWindowFocus: true,
      staleTimeMs: 0,
      dataShape: "value" as const,
    })),
  );
  useEffect(() => {
    const discovered: Record<string, string> = {};
    queries.forEach((query, index) => {
      if (query.data?.isGit && !query.data.error) {
        const path = resolvedDirectories[index]!.path;
        if (roots[path] !== query.data.repoRoot && path !== query.data.repoRoot)
          discovered[path] = query.data.repoRoot;
      }
    });
    if (Object.keys(discovered).length) setRoots((previous) => ({ ...previous, ...discovered }));
  }, [queries, resolvedDirectories, roots]);
  const history = useRef(new Map<string, { branch: string | null; previousBranch?: string }>());
  const repositories = new Map<string, ExecutionRepository>();
  queries.forEach((query, index) => {
    const status = query.data;
    if (!status?.isGit || status.error || query.isError) return;
    const key = `${serverId}:${agentId}:${status.repoRoot}`;
    const previous = history.current.get(key);
    const branchChanged = previous && previous.branch !== status.currentBranch;
    const previousBranch = branchChanged ? (previous.branch ?? "HEAD") : previous?.previousBranch;
    const existing = repositories.get(status.repoRoot);
    repositories.set(status.repoRoot, {
      root: status.repoRoot,
      branch: status.currentBranch,
      dirty: status.isDirty,
      edited: resolvedDirectories[index]!.edited || existing?.edited === true,
      previousBranch,
    });
  });
  const rows = Array.from(repositories.values());
  useEffect(() => {
    for (const row of rows)
      history.current.set(`${serverId}:${agentId}:${row.root}`, {
        branch: row.branch,
        previousBranch: row.previousBranch,
      });
  }, [agentId, serverId, rows]);
  return (
    <ExecutionContextView
      compact={compact}
      trailing={trailing}
      cwd={cwd}
      onCopy={copyToClipboard}
      repositories={rows}
      connected={connected}
      loading={queries.some((query) => query.isLoading)}
      failed={queries.some((query) => query.isError || !!query.data?.error)}
    />
  );
}
