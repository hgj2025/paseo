import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useAgentUsage } from "./queries";
import { AgentUsage } from "./agent-usage";
import { ContextWindowRing, getRingGeometry } from "@/components/context-window-ring";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
import { formatPct } from "./format";
import { windowTone } from "./tone";
import { conversationQuota, quotaTiming } from "./conversation-quota";

function quotaResetLabel(
  minutes: number | null | undefined,
  t: (key: string, options?: { minutes: number }) => string,
) {
  if (minutes === 0) return t("conversationQuota.resetting");
  if (minutes != null) return t("conversationQuota.reset", { minutes });
  return "";
}
export function ConversationQuotaBar({
  serverId,
  agentId,
  size = 14,
}: {
  serverId: string;
  agentId: string;
  size?: number;
}) {
  const geometry = getRingGeometry(size);
  const active = useRetainedPanelActive();
  const view = useAgentUsage(serverId, agentId, { active, poll: true });
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  const header = useMemo(() => ({ title: t("conversationQuota.details") }), [t]);
  const quota = view.kind === "ready" ? conversationQuota(view.reports) : null;
  const timing = quota ? quotaTiming(quota.entry.fetchedAt, quota.window, now) : null;
  const accessibilityState = useMemo(() => ({ expanded: open }), [open]);
  const close = useCallback(() => setOpen(false), []);
  const show = useCallback(() => setOpen(true), []);
  const resetLabel = quotaResetLabel(timing?.resetMinutes, t);
  const tone = quota ? windowTone(quota.window) : "default";
  const meterColors = useCallback(
    (theme: Theme) => {
      let progressColor = theme.colors.foregroundMuted;
      if (!timing?.stale && tone === "danger") progressColor = theme.colors.statusDanger;
      if (!timing?.stale && tone === "warning") progressColor = theme.colors.statusWarning;
      return { trackColor: theme.colors.surface3, progressColor };
    },
    [tone, timing?.stale],
  );
  let summary = t(
    view.kind === "loading" ? "conversationQuota.loading" : "conversationQuota.unavailable",
  );
  if (quota)
    summary = `5h ${t("conversationQuota.used", { percent: formatPct(quota.percent) })} · ${resetLabel}${timing?.stale ? ` · ${t("conversationQuota.stale")}` : ""}`;
  if (view.kind === "none") return null;
  // Providers without a five-hour quota retain their existing detailed usage UI.
  if (
    view.kind === "ready" &&
    !quota &&
    view.reports.every((entry) => entry.report.status === "available")
  )
    return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Pressable
            onPress={show}
            accessibilityRole="button"
            accessibilityState={accessibilityState}
            accessibilityLabel={summary}
            style={styles.trigger}
            testID="conversation-quota-ring"
          >
            <View style={styles.glyph}>
              <ContextWindowRing
                size={size}
                radius={geometry.radius}
                strokeWidth={geometry.strokeWidth}
                percentage={quota?.percent ?? null}
                uniProps={meterColors}
              />
              <Text style={styles.digit} pointerEvents="none">
                5
              </Text>
            </View>
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top">
          <Text style={styles.tooltip}>{summary}</Text>
        </TooltipContent>
      </Tooltip>
      {open && (
        <AdaptiveModalSheet
          header={header}
          visible={open}
          onClose={close}
          desktopMaxWidth={640}
          contextBridge={null}
          testID="conversation-quota-details"
        >
          <View style={styles.details}>
            {timing?.ageMinutes != null && (
              <Text style={styles.text}>
                {t("conversationQuota.updated", { minutes: timing.ageMinutes })}
              </Text>
            )}
            <AgentUsage serverId={serverId} agentId={agentId} refreshable />
          </View>
        </AdaptiveModalSheet>
      )}
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  trigger: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  glyph: { alignItems: "center", justifyContent: "center" },
  digit: {
    position: "absolute",
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
  },
  tooltip: { color: theme.colors.popoverForeground, fontSize: theme.fontSize.sm },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  details: { padding: theme.spacing[3], gap: theme.spacing[2] },
}));
