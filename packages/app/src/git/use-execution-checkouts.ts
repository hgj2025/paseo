import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQueries } from "@/data/query";
import { useAppVisible } from "@/hooks/use-app-visible";
import { checkoutStatusQueryKey } from "./query-keys";
import { fetchCheckoutStatus, type CheckoutStatusClient } from "./checkout-status-cache";

export interface ExecutionCheckoutTarget {
  serverId: string;
  cwd: string;
  client: CheckoutStatusClient | null;
  enabled: boolean;
}

/** All execution surfaces share the canonical cache; only evidence changes trigger extra reads. */
export function useExecutionCheckouts(targets: ExecutionCheckoutTarget[], revision: string) {
  const queryClient = useQueryClient();
  const visible = useAppVisible();
  const latestTargets = useRef(targets);
  latestTargets.current = targets;
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (!visible || previousRevision.current === revision) return;
    const changedAt = Date.now();
    // Coalesce tool completions; text streaming and identical history reads do not refresh Git.
    const timer = setTimeout(() => {
      previousRevision.current = revision;
      for (const target of latestTargets.current) {
        if (!target.enabled) continue;
        const queryKey = checkoutStatusQueryKey(target.serverId, target.cwd);
        if ((queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0) >= changedAt) continue;
        void queryClient.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [queryClient, revision, visible]);
  return useFetchQueries(
    targets.map((target) => ({
      queryKey: checkoutStatusQueryKey(target.serverId, target.cwd),
      queryFn: () => {
        if (!target.client) throw new Error("Host unavailable");
        return fetchCheckoutStatus({
          client: target.client,
          serverId: target.serverId,
          cwd: target.cwd,
        });
      },
      enabled: visible && target.enabled && !!target.client,
      staleTimeMs: 15_000,
      dataShape: "value" as const,
      refetchOnReconnect: true,
      refetchOnWindowFocus: "always",
    })),
  );
}
