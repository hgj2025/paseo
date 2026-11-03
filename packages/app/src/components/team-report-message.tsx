import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useWorkspaceTeam } from "@/screens/workspace/workspace-team-context";
import { resolveTeamMessageDisplay, type TeamMessageDisplay } from "@/utils/team-message-display";
import { conversationBodyStyle } from "@/styles/conversation-typography";

export function useTeamMessageDisplay(message: string) {
  const context = useWorkspaceTeam();
  const tasks = context?.team?.tasks;
  return useMemo(() => {
    const display = resolveTeamMessageDisplay(message, tasks ?? []);
    return {
      text: display?.kind === "task" ? display.text : message,
      report: display?.kind === "report" ? display : null,
    };
  }, [message, tasks]);
}

export function TeamReportMessage({
  display,
}: {
  display: Extract<TeamMessageDisplay, { kind: "report" }>;
}) {
  const context = useWorkspaceTeam();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const members = [...(context?.team?.members ?? []), ...(context?.team?.retiredMembers ?? [])];
  const alias = members.find((member) => member.id === display.memberId)?.alias;
  const status = t(`workspace.team.status.${display.status}`);
  const label = alias ? `@${alias} · ${status}` : status;
  return (
    <View style={styles.container} testID="team-report-message">
      <Button
        variant="ghost"
        size="xs"
        leftIcon={expanded ? ChevronDown : ChevronRight}
        onPress={toggle}
        accessibilityLabel={`${label} · ${t(expanded ? "workspace.team.group.hide" : "workspace.team.group.details")}`}
        accessibilityState={accessibilityState}
        style={styles.trigger}
      >
        {label}
      </Button>
      {expanded && (
        <Text selectable style={styles.body}>
          {display.text}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "stretch",
    alignItems: "flex-start",
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  trigger: { paddingHorizontal: theme.spacing[1] },
  body: {
    color: theme.colors.foreground,
    ...conversationBodyStyle(theme),
    paddingHorizontal: theme.spacing[2],
  },
}));
