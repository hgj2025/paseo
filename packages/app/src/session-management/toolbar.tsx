import { useState, useCallback } from "react";
import { ArchiveRuleSheet } from "./rule-sheet";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import type { HistoryFilter } from "./model";
import { useManagementCopy } from "./copy";

function ArchiveFilterButton({
  value,
  selected,
  busy,
  onSelect,
}: {
  value: HistoryFilter;
  selected: HistoryFilter;
  busy: boolean;
  onSelect: (value: HistoryFilter) => void;
}) {
  const c = useManagementCopy();
  const select = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button
      size="sm"
      variant={selected === value ? "secondary" : "ghost"}
      onPress={select}
      disabled={busy}
    >
      {c[value]}
    </Button>
  );
}
export function HistoryManagementActions({
  serverId,
  hostName,
  managing,
  busy,
  toggle,
}: {
  serverId: string | null;
  hostName: string;
  managing: boolean;
  busy: boolean;
  toggle: () => void;
}) {
  const c = useManagementCopy();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <View style={styles.row}>
      <Button size="sm" variant="ghost" disabled={busy} onPress={toggle}>
        {managing ? c.done : c.manage}
      </Button>
      <Button size="sm" variant="ghost" disabled={!serverId} onPress={show}>
        {c.automatic}
      </Button>
      {open && serverId ? (
        <ArchiveRuleSheet key={serverId} serverId={serverId} hostName={hostName} onClose={close} />
      ) : null}
    </View>
  );
}
export function HistoryManagementToolbar(props: {
  filter: HistoryFilter;
  setFilter: (v: HistoryFilter) => void;
  provider: string;
  setProvider: (v: string) => void;
  directory: string;
  setDirectory: (v: string) => void;
  managing: boolean;
  hostRequired: boolean;
  selected: number;
  busy: boolean;
  message: string;
  selectLoaded: () => void;
  clear: () => void;
  archive: () => void;
  restore: () => void;
}) {
  const c = useManagementCopy();
  if (!props.managing) return null;
  return (
    <View style={styles.body}>
      <View style={styles.row}>
        {(["all", "unarchived", "archived"] as const).map((value) => (
          <ArchiveFilterButton
            key={value}
            value={value}
            selected={props.filter}
            onSelect={props.setFilter}
            busy={props.busy}
          />
        ))}
      </View>
      <View style={styles.fields}>
        <SearchField
          clearAccessibilityLabel={c.clear}
          value={props.provider}
          onChangeText={props.setProvider}
          placeholder={c.provider}
        />
        <SearchField
          clearAccessibilityLabel={c.clear}
          value={props.directory}
          onChangeText={props.setDirectory}
          placeholder={c.directory}
        />
      </View>
      <View style={styles.row}>
        <Button size="sm" variant="ghost" onPress={props.selectLoaded} disabled={props.busy}>
          {c.selectLoaded}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={props.clear}
          disabled={props.busy || !props.selected}
        >
          {c.clear}
        </Button>
        <Text style={styles.hint}>
          {c.select} · {props.selected}
        </Text>
        <Button
          size="sm"
          variant="secondary"
          onPress={props.archive}
          disabled={props.busy || !props.selected}
        >
          {c.archive}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={props.restore}
          disabled={props.busy || !props.selected}
        >
          {c.restore}
        </Button>
      </View>
      {props.hostRequired ? <Text style={styles.hint}>{c.hostRequired}</Text> : null}
      <Text style={styles.hint}>{props.busy ? c.working : props.message || c.loaded}</Text>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[2] },
  fields: { flexDirection: { xs: "column", md: "row" }, gap: theme.spacing[2] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
