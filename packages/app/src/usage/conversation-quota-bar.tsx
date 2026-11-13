import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useAgentUsage } from "./queries";
import { AgentUsage } from "./agent-usage";
import { UsageMeter } from "./meter";
import { formatPct } from "./format";
import { windowTone } from "./tone";
import { conversationQuota, quotaTiming } from "./conversation-quota";

export function ConversationQuotaBar({ serverId, agentId }: { serverId: string; agentId: string }) {
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
  let resetLabel = "";
  if (timing?.resetMinutes === 0) resetLabel = t("conversationQuota.resetting");
  else if (timing?.resetMinutes != null)
    resetLabel = t("conversationQuota.reset", { minutes: timing.resetMinutes });
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
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        accessibilityLabel={t("conversationQuota.details")}
        style={styles.row}
        testID="conversation-quota-bar"
      >
        {quota ? (
          <>
            <Text style={styles.text}>5h {formatPct(quota.percent)}</Text>
            <UsageMeter
              percent={quota.percent}
              tone={windowTone(quota.window)}
              style={styles.meter}
            />
            <Text numberOfLines={1} style={styles.trailing}>
              {quota.percent >= 100 ? `${t("conversationQuota.full")} · ` : ""}
              {resetLabel}
            </Text>
            {timing?.stale && <Text style={styles.text}>{t("conversationQuota.stale")}</Text>}
          </>
        ) : (
          <Text style={styles.text}>
            {t(
              view.kind === "loading"
                ? "conversationQuota.loading"
                : "conversationQuota.unavailable",
            )}
          </Text>
        )}
      </Pressable>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: 32,
    flexWrap: "wrap",
  },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  trailing: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  meter: { width: 64 },
  details: { padding: theme.spacing[3], gap: theme.spacing[2] },
}));
