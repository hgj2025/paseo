import { useState, useSyncExternalStore, useCallback, useMemo } from "react";
import { View, Text, Pressable } from "react-native";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react-native";
import { Switch } from "@/components/ui/switch";
import { ArchiveScopeFields } from "./scope-fields";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { openArchiveRuleForm } from "./rule-form";
import { useArchiveRules } from "./store";
import { useManagementCopy } from "./copy";
import { canArchive, parentAgentIds, matchesArchiveRule } from "./model";
import { loadHostHistory } from "./service";
import { getProtectedAgentIds } from "./runtime";

export function ArchiveRuleSheet({
  serverId,
  hostName,
  onClose,
}: {
  serverId: string;
  hostName: string;
  onClose: () => void;
}) {
  const c = useManagementCopy();
  const [form] = useState(() => openArchiveRuleForm(useArchiveRules.getState().rules[serverId]));
  const state = useSyncExternalStore(form.subscribe, form.getState);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const toggleScope = useCallback(() => setScopeOpen((open) => !open), []);
  const report = useArchiveRules((s) => s.reports[serverId]);
  const preview = useCallback(async () => {
    const rule = form.value();
    if (!rule) {
      setMessage(c.invalid);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error("Host is disconnected");
      const agents = await loadHostHistory(client, serverId);
      const parents = parentAgentIds(agents);
      const protectedIds = getProtectedAgentIds(serverId, agents);
      const candidates = agents.filter(
        (a) =>
          canArchive(a, parents) &&
          !protectedIds.has(a.id) &&
          matchesArchiveRule(a, rule, Date.now()),
      );
      setMessage(
        candidates.length
          ? `${c.previewTitle} · ${candidates.length}\n${candidates
              .slice(0, 20)
              .map((a) => `${a.title || a.id.slice(0, 8)} · ${a.cwd}`)
              .join("\n")}${candidates.length > 20 ? "\n…" : ""}`
          : c.emptyPreview,
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }, [form, serverId, c]);
  const save = useCallback(() => {
    const rule = form.value();
    if (!rule) {
      setMessage(c.invalid);
      return;
    }
    useArchiveRules.getState().setRule(serverId, rule);
    onClose();
  }, [form, serverId, onClose, c]);
  const header = useMemo(() => ({ title: `${c.title} · ${hostName}` }), [c.title, hostName]);
  const setEnabled = useCallback(
    (enabled: boolean) => {
      setMessage("");
      form.set({ enabled });
    },
    [form],
  );
  const setDays = useCallback(
    (days: string) => {
      setMessage("");
      form.set({ days });
    },
    [form],
  );
  const setProvider = useCallback(
    (provider: string) => {
      setMessage("");
      form.set({ provider });
    },
    [form],
  );
  const setDirectory = useCallback(
    (directory: string) => {
      setMessage("");
      form.set({ directory });
    },
    [form],
  );
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button variant="ghost" onPress={onClose}>
          {c.cancel}
        </Button>
        <Button onPress={save} disabled={busy}>
          {c.save}
        </Button>
      </View>
    ),
    [onClose, save, busy, c],
  );
  const ScopeChevron = scopeOpen ? ThemedChevronDown : ThemedChevronRight;
  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={header}
      desktopMaxWidth={440}
      footer={footer}
      footerContainerStyle={styles.footer}
    >
      <View style={styles.body}>
        <View style={styles.toggle}>
          <View style={styles.toggleCopy}>
            <Text style={styles.labelStrong}>{c.autoLabel}</Text>
            <Text style={styles.hint}>{c.daily}</Text>
          </View>
          <Switch
            disabled={busy}
            accessibilityLabel={c.enable}
            value={state.enabled}
            onValueChange={setEnabled}
          />
        </View>
        <View style={styles.separator} />
        <View style={styles.row}>
          <Text style={styles.label}>{c.inactivity}</Text>
          <View style={styles.dayControl}>
            <AdaptiveTextInput
              accessibilityLabel={c.days}
              editable={!busy}
              keyboardType="number-pad"
              initialValue={state.days}
              onChangeText={setDays}
              style={styles.daysInput}
            />
            <Text style={styles.label}>{c.dayUnit}</Text>
          </View>
        </View>
        <Pressable
          onPress={toggleScope}
          accessibilityRole="button"
          accessibilityLabel={c.rangeLabel}
          accessibilityState={scopeOpen ? SCOPE_EXPANDED : SCOPE_COLLAPSED}
          style={styles.scopeRow}
        >
          <Text style={styles.label}>{c.rangeLabel}</Text>
          <View style={styles.scopeSummary}>
            <Text style={styles.hint} numberOfLines={1}>
              {state.provider || c.allSources} · {state.directory || c.allDirectories}
            </Text>
            <ScopeChevron size={14} />
          </View>
        </Pressable>
        {scopeOpen ? (
          <ArchiveScopeFields
            serverId={serverId}
            provider={state.provider}
            directory={state.directory}
            busy={busy}
            setProvider={setProvider}
            setDirectory={setDirectory}
          />
        ) : null}
        <View style={styles.separator} />
        <View style={styles.previewRow}>
          <Text style={styles.hint}>
            {c.lastRun} · {report ? new Date(report.at).toLocaleString() : c.never}
          </Text>
          <Button size="sm" variant="ghost" onPress={preview} disabled={busy}>
            {busy ? c.working : c.preview}
          </Button>
        </View>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={styles.result}>
            {message}
          </Text>
        ) : null}
        {report ? (
          <Text style={styles.result}>
            {c.success} {report.archived} · {c.skipped} {report.skipped} · {c.error} {report.failed}
            {report.error ? `\n${report.error}` : ""}
          </Text>
        ) : null}
        <View style={styles.notice}>
          <ThemedShieldCheck size={14} />
          <View style={styles.noticeCopy}>
            <Text style={styles.hint}>{c.preserve}</Text>
            <Text style={styles.hint}>{c.runHint}</Text>
          </View>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedShieldCheck = withUnistyles(ShieldCheck, mutedIcon);
const ThemedChevronDown = withUnistyles(ChevronDown, mutedIcon);
const ThemedChevronRight = withUnistyles(ChevronRight, mutedIcon);
const SCOPE_EXPANDED = { expanded: true };
const SCOPE_COLLAPSED = { expanded: false };
const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[4] },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  labelStrong: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, lineHeight: 18 },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  toggleCopy: { gap: theme.spacing[1] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  dayControl: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  daysInput: {
    width: 64,
    minHeight: 36,
    textAlign: "center",
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.sm,
  },
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    minHeight: 32,
  },
  scopeSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  separator: { height: 1, backgroundColor: theme.colors.border },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  result: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, lineHeight: 19 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
  noticeCopy: { flex: 1, gap: theme.spacing[1] },
  actions: { flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  footer: { justifyContent: "flex-end" },
}));
