import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TeamMember } from "@getpaseo/protocol/workspace-team";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  recipientIds,
  useTeamComposerStore,
  type TeamRecipient,
} from "@/stores/team-composer-store";

function RecipientChip({
  id,
  alias,
  onRemove,
  disabled,
}: {
  id: string;
  alias: string;
  onRemove(id: string): void;
  disabled: boolean;
}) {
  const remove = useStableEvent(() => onRemove(id));
  return (
    <Button
      size="xs"
      variant="secondary"
      testID="team-recipient-chip"
      onPress={remove}
      disabled={disabled}
    >
      @{alias} ×
    </Button>
  );
}

export function TeamRecipients({
  composerKey,
  recipient,
  members,
  supported,
  disabled,
}: {
  composerKey: string;
  recipient: TeamRecipient;
  members: TeamMember[];
  supported: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const ids = recipientIds(recipient);
  const remove = useStableEvent((id: string) => {
    const memberIds = ids.filter((memberId) => memberId !== id);
    useTeamComposerStore
      .getState()
      .set(
        composerKey,
        memberIds.length
          ? { memberIds, mode: recipient.mode ?? "coordinate", taskId: null, prompt: null }
          : null,
      );
  });
  const setMode = useStableEvent((mode: "coordinate" | "broadcast") => {
    useTeamComposerStore
      .getState()
      .set(composerKey, { memberIds: ids, mode, taskId: null, prompt: null });
  });
  const options = useMemo(
    () =>
      (["coordinate", "broadcast"] as const).map((value) => ({
        value,
        label: t(`workspace.team.group.${value}`),
        testID: `team-mode-${value}`,
        disabled,
      })),
    [t, disabled],
  );
  return (
    <View style={styles.selection} testID="team-recipients">
      <View style={styles.row}>
        {ids.map((id) => (
          <RecipientChip
            key={id}
            id={id}
            alias={members.find((m) => m.id === id)?.alias ?? "?"}
            onRemove={remove}
            disabled={disabled}
          />
        ))}
      </View>
      {supported && (
        <SegmentedControl
          size="xs"
          options={options}
          value={recipient.mode ?? "coordinate"}
          onValueChange={setMode}
        />
      )}
      <Text style={styles.hint}>
        {t(
          supported
            ? `workspace.team.group.${recipient.mode ?? "coordinate"}Hint`
            : "workspace.team.group.updateHost",
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  selection: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    alignItems: "flex-start",
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
