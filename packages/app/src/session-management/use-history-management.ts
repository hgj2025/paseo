import { useCallback, useEffect, useMemo, useState } from "react";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { agentKey, filterHistory, parentAgentIds, type HistoryFilter } from "./model";
import { archiveCandidates, loadHostHistory } from "./service";
import { getProtectedAgentIds, useInvalidateHistory, withArchiveLock } from "./runtime";
import { useManagementCopy } from "./copy";

export function useHistoryManagement(
  agents: AggregatedAgent[],
  scope: string,
  refresh: () => Promise<void>,
) {
  const c = useManagementCopy();
  const [managing, setManaging] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [provider, setProvider] = useState("");
  const [directory, setDirectory] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const invalidate = useInvalidateHistory();
  const visible = useMemo(
    () =>
      managing
        ? filterHistory(agents, {
            archive: filter,
            provider: provider.trim(),
            directory: directory.trim(),
          })
        : agents,
    [agents, managing, filter, provider, directory],
  );
  useEffect(() => {
    setSelected(new Set());
    setMessage("");
  }, [scope, filter, provider, directory, managing]);
  const toggle = useCallback(
    (agent: AggregatedAgent) =>
      setSelected((before) => {
        const next = new Set(before);
        const key = agentKey(agent);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const run = async (restore: boolean) => {
    if (busy) return;
    const targets = visible.filter((a) => selected.has(agentKey(a)));
    if (
      !restore &&
      !(await confirmDialog({
        title: c.confirm,
        message: `${targets.length}\n${c.confirmBody}`,
        confirmLabel: c.archive,
        cancelLabel: c.cancel,
      }))
    )
      return;
    setBusy(true);
    setMessage("");
    let changed = 0;
    let skipped = 0;
    let failed = 0;
    const byHost = new Map<string, AggregatedAgent[]>();
    for (const agent of targets)
      byHost.set(agent.serverId, [...(byHost.get(agent.serverId) ?? []), agent]);
    for (const [serverId, candidates] of byHost) {
      const runtime = getHostRuntimeStore();
      const client = runtime.getClient(serverId);
      if (!client || !isHostRuntimeConnected(runtime.getSnapshot(serverId))) {
        failed += candidates.length;
        continue;
      }
      try {
        await withArchiveLock(serverId, async () => {
          if (restore) {
            for (const agent of candidates) {
              if (!agent.archivedAt) {
                skipped++;
                continue;
              }
              try {
                const latest = await client.fetchAgent(agent.id);
                if (
                  !latest?.agent.archivedAt ||
                  latest.agent.status === "running" ||
                  latest.agent.activeTurn
                ) {
                  skipped++;
                  continue;
                }
                await client.refreshAgent(agent.id);
                changed++;
              } catch {
                failed++;
              }
            }
          } else {
            const history = await loadHostHistory(client, serverId);
            const result = await archiveCandidates({
              client,
              serverId,
              candidates,
              manual: true,
              parents: parentAgentIds(history),
              protectedIds: () => getProtectedAgentIds(serverId, history, false),
            });
            changed += result.archived;
            skipped += result.skipped;
            failed += result.failed;
          }
        });
      } catch {
        failed += candidates.length;
      }
      invalidate(serverId);
    }
    setMessage(
      `${restore ? c.restored : c.success} ${changed} · ${c.skipped} ${skipped} · ${c.error} ${failed}`,
    );
    setSelected(new Set());
    setBusy(false);
    await refresh();
  };
  const listSelection = useMemo(
    () => (managing ? { selectedKeys: selected, onToggle: toggle } : undefined),
    [managing, selected, toggle],
  );
  const toggleManaging = useCallback(() => setManaging((value) => !value), []);
  return {
    listSelection,
    toggleManaging,
    managing,
    setManaging,
    filter,
    setFilter,
    provider,
    setProvider,
    directory,
    setDirectory,
    selected,
    busy,
    message,
    visible,
    toggle,
    selectLoaded: () => setSelected(new Set(visible.map(agentKey))),
    clear: () => setSelected(new Set()),
    archive: () => void run(false),
    restore: () => void run(true),
  };
}
