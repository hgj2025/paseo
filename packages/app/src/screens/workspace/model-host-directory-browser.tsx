import { useEffect, useState, useMemo, type RefObject } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import { Text, View } from "react-native";
import { ArrowUp, Folder } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  browseModelHostDirectory,
  parentModelHostDirectory,
  type ModelHostDestination,
} from "./model-host-destinations";

export function ModelHostDirectoryBrowser({
  serverId,
  hostLabel,
  initialDirectory,
  anchorRef,
  busy,
  onSelect,
  onOpenChange,
}: {
  serverId: string;
  hostLabel: string;
  initialDirectory?: string;
  anchorRef: RefObject<View | null>;
  busy: boolean;
  onSelect(directory: string): void;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState(() =>
    initialDirectory ? parentModelHostDirectory(initialDirectory) : "/",
  );
  const [entries, setEntries] = useState<ModelHostDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    const client = getHostRuntimeStore().getClient(serverId);
    const result = client
      ? browseModelHostDirectory(client, directory)
      : Promise.reject(new Error(t("workspace.terminal.hostDisconnected")));
    void result.then(
      (choices) => {
        if (!canceled) {
          setEntries(choices);
          setLoading(false);
        }
        return undefined;
      },
      (failure) => {
        if (!canceled) {
          setError(String(failure));
          setLoading(false);
        }
        return undefined;
      },
    );
    return () => {
      canceled = true;
    };
  }, [serverId, directory, reload, t]);
  const navigate = useStableEvent((path: string) => {
    setQuery("");
    setDirectory(path);
  });
  const goUp = useStableEvent(() => navigate(parentModelHostDirectory(directory)));
  const retry = useStableEvent(() => setReload((value) => value + 1));
  const confirm = useStableEvent(() => onSelect(directory));
  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Text style={styles.host}>{t("modelHostDirectory.title", { host: hostLabel })}</Text>
        <View style={styles.pathRow}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={ArrowUp}
            disabled={directory === "/" || busy}
            accessibilityLabel={t("modelHostDirectory.parent")}
            onPress={goUp}
          />
          <Text style={styles.path} selectable>
            {directory}
          </Text>
        </View>
      </View>
    ),
    [hostLabel, directory, busy, goUp, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {error ? (
          <Button variant="ghost" size="sm" onPress={retry}>
            {t("common.retry")}
          </Button>
        ) : null}
        <Button
          variant="default"
          size="sm"
          leftIcon={Folder}
          disabled={loading || Boolean(error) || busy}
          loading={busy}
          onPress={confirm}
        >
          {t("modelHostDirectory.select")}
        </Button>
      </View>
    ),
    [error, loading, busy, retry, confirm, t],
  );
  const options = useMemo(
    () =>
      entries.map((entry) => ({ id: entry.id, label: entry.label, kind: "directory" as const })),
    [entries],
  );
  return (
    <Combobox
      key={`${serverId}:${directory}`}
      options={options}
      value=""
      anchorRef={anchorRef}
      open
      onOpenChange={onOpenChange}
      onSearchQueryChange={setQuery}
      allowCustomValue={query.startsWith("/")}
      customValuePrefix=""
      customValueKind="directory"
      onSelect={navigate}
      keepOpenOnSelect
      desktopPreventInitialFlash
      desktopPlacement="bottom-start"
      desktopMinWidth={360}
      title={t("modelHostDirectory.title", { host: hostLabel })}
      searchPlaceholder={t("modelHostDirectory.search")}
      emptyText={loading ? t("common.loading") : (error ?? t("modelHostDirectory.empty"))}
      stickyHeader={header}
      footer={footer}
    />
  );
}
const styles = StyleSheet.create((theme) => ({
  header: { padding: theme.spacing[3], gap: theme.spacing[2] },
  host: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  pathRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  path: { color: theme.colors.foreground, fontSize: theme.fontSize.base, flex: 1, flexShrink: 1 },
  footer: {
    padding: theme.spacing[3],
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
