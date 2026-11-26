import { useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SelectField } from "@/components/ui/select-field";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildProviderLabelMap } from "@/components/import-session-sheet-view-model";
import { useManagementCopy } from "./copy";

export function ArchiveScopeFields({
  serverId,
  provider,
  directory,
  busy,
  setProvider,
  setDirectory,
}: {
  serverId: string;
  provider: string;
  directory: string;
  busy: boolean;
  setProvider: (value: string) => void;
  setDirectory: (value: string) => void;
}) {
  const c = useManagementCopy();
  const { entries, isLoading } = useProvidersSnapshot(serverId);
  const labels = useMemo(() => buildProviderLabelMap(entries), [entries]);
  const options = useMemo(() => {
    const available = (entries ?? []).map((entry) => ({
      id: entry.provider,
      value: entry.provider,
      label: labels.get(entry.provider) ?? entry.provider,
    }));
    if (provider && !available.some((option) => option.id === provider))
      available.push({ id: provider, value: provider, label: labels.get(provider) ?? provider });
    return [{ id: "all-sources", value: "", label: c.allSources }, ...available];
  }, [entries, labels, provider, c.allSources]);
  const display = useMemo(
    () => ({ label: provider ? (labels.get(provider) ?? provider) : c.allSources }),
    [provider, labels, c.allSources],
  );
  return (
    <View style={styles.body}>
      <SelectField
        label={c.sourceLabel}
        value={provider}
        selectedDisplay={display}
        options={options}
        onChange={setProvider}
        placeholder={c.allSources}
        emptyText={c.allSources}
        loading={isLoading}
        disabled={busy}
        size="sm"
      />
      <View style={styles.field}>
        <Text style={styles.label}>{c.directoryLabel}</Text>
        <AdaptiveTextInput
          accessibilityLabel={c.directoryLabel}
          initialValue={directory}
          editable={!busy}
          autoCapitalize="none"
          onChangeText={setDirectory}
          placeholder={c.allDirectories}
          style={styles.input}
        />
        <Text style={styles.hint}>{c.directoryHint}</Text>
      </View>
      <Text style={styles.hint}>{c.safe}</Text>
      <Text style={styles.hint}>{c.localRule}</Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[4], paddingBottom: theme.spacing[3] },
  field: { gap: theme.spacing[2] },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, lineHeight: 18 },
  input: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minHeight: 36,
    fontSize: theme.fontSize.sm,
  },
}));
