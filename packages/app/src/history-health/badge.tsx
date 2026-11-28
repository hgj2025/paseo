import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { TriangleAlert } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { historyHealthStore, historyWarning } from "./model";
import type { Theme } from "@/styles/theme";
const Icon = withUnistyles(TriangleAlert);
const warningColor = (theme: Theme) => ({ color: theme.colors.statusWarning });
export function HistoryHealthBadge({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const subscribe = useCallback(
    (fn: () => void) => historyHealthStore.subscribe(serverId, agentId, fn),
    [serverId, agentId],
  );
  const snapshot = useCallback(
    () => historyHealthStore.get(serverId, agentId),
    [serverId, agentId],
  );
  const health = useSyncExternalStore(subscribe, snapshot, snapshot);
  const show = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const header = useMemo(() => ({ title: t("historyHealth.title") }), [t]);
  if (!historyWarning(health) && !open) return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Pressable
            testID="history-health-warning"
            accessibilityRole="button"
            accessibilityLabel={t("historyHealth.warning")}
            onPress={show}
            style={styles.trigger}
          >
            <Icon size={14} uniProps={warningColor} />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text>{t("historyHealth.warning")}</Text>
        </TooltipContent>
      </Tooltip>
      {open && (
        <AdaptiveModalSheet
          visible={open}
          onClose={close}
          header={header}
          desktopMaxWidth={420}
          contextBridge={null}
          testID="history-health-details"
        >
          <View style={styles.details}>
            <Text style={styles.text}>
              {t("historyHealth.rows", {
                value: health?.rows?.toLocaleString() ?? t("historyHealth.unassessed"),
              })}
            </Text>
            <Text style={styles.text}>
              {t("historyHealth.load", {
                value:
                  health?.loadMs != null
                    ? `${health.loadTimedOut ? "≥ " : ""}${Math.round(health.loadMs)} ms`
                    : t("historyHealth.unassessed"),
              })}
            </Text>
            <Text style={styles.text}>
              {t("historyHealth.process", {
                value:
                  health?.processMs != null
                    ? `${Math.round(health.processMs)} ms`
                    : t("historyHealth.unassessed"),
              })}
            </Text>
            <Text style={styles.hint}>{t("historyHealth.scope")}</Text>
            <Text style={styles.text}>{t("historyHealth.advice")}</Text>
          </View>
        </AdaptiveModalSheet>
      )}
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  trigger: {
    minWidth: 28,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  details: { padding: theme.spacing[4], gap: theme.spacing[3] },
  text: { color: theme.colors.foreground, fontSize: 14 },
  hint: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
}));
