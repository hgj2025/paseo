import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TeamMember } from "@getpaseo/protocol/workspace-team";
import { SettingsRow } from "@/components/settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { resolveTeamMemberPane, usePaneAppearanceStore } from "@/stores/pane-appearance-store";
import { PANE_COLOR_NAMES, type PaneColorChoice, type PaneTone } from "@/styles/pane-colors";
import { identityColor } from "@/styles/identity-colors";
import { useWorkspaceTeam } from "./workspace-team-context";

function Swatch({ tone }: { tone: PaneTone }) {
  return <View style={styles.swatch(tone)} />;
}
function ColorOption({
  choice,
  selected,
  automatic,
  onChange,
}: {
  choice: PaneColorChoice;
  selected: boolean;
  automatic: PaneTone;
  onChange(value: PaneColorChoice): void;
}) {
  const { t } = useTranslation();
  const select = useStableEvent(() => onChange(choice));
  const tone = choice === "auto" ? automatic : choice;
  const swatch = useMemo(() => <Swatch tone={tone} />, [tone]);
  return (
    <DropdownMenuItem
      selected={selected}
      leading={swatch}
      onSelect={select}
      testID={`team-pane-color-${choice}`}
    >
      {t(`paneAppearance.${choice}`)}
    </DropdownMenuItem>
  );
}

export function TeamMemberAppearance({ member }: { member: TeamMember }) {
  const { t } = useTranslation();
  const context = useWorkspaceTeam()!;
  const team = context.team!;
  const ownerKey = `${context.ownerServerId}:${context.workspaceId}`;
  const layout = useWorkspaceLayoutStore((state) => {
    if (team.sessionId && state.activeConversationByWorkspace[ownerKey] !== team.sessionId)
      return state.conversationsByWorkspace[ownerKey]?.[team.sessionId]?.layout;
    return state.layoutByWorkspace[ownerKey];
  });
  const paneId = resolveTeamMemberPane(layout, context.ownerServerId, member);
  const appearanceKey = team.sessionId ? `${ownerKey}:${team.sessionId}` : ownerKey;
  const appearance = usePaneAppearanceStore((state) =>
    paneId ? state.workspaces[appearanceKey]?.[paneId] : undefined,
  );
  const captain = team.captainId === member.id;
  const choice = captain ? "theme" : (appearance?.choice ?? "auto");
  const automatic = appearance?.automatic ?? "theme";
  const tone = choice === "auto" ? automatic : choice;
  const swatch = useMemo(() => <Swatch tone={tone} />, [tone]);
  const change = useStableEvent((value: PaneColorChoice) => {
    if (!captain && paneId)
      usePaneAppearanceStore.getState().setColor(appearanceKey, paneId, value);
  });
  return (
    <SettingsRow label={t("paneAppearance.title")} testID={`team-member-appearance-${member.id}`}>
      {captain ? (
        <Text style={styles.value}>{t("teamPanel.themeLocked")}</Text>
      ) : (
        <DropdownMenu>
          <DropdownTrigger
            leading={swatch}
            disabled={!paneId || !appearance}
            accessibilityLabel={t("teamPanel.memberColor", { name: member.alias })}
            testID={`team-member-color-${member.id}`}
          >
            {paneId ? t(`paneAppearance.${choice}`) : t("teamPanel.paneUnavailable")}
          </DropdownTrigger>
          <DropdownMenuContent align="end" side="bottom" width={200}>
            <ColorOption
              choice="auto"
              selected={choice === "auto"}
              automatic={automatic}
              onChange={change}
            />
            <ColorOption
              choice="theme"
              selected={choice === "theme"}
              automatic={automatic}
              onChange={change}
            />
            <DropdownMenuSeparator />
            {PANE_COLOR_NAMES.map((color) => (
              <ColorOption
                key={color}
                choice={color}
                selected={choice === color}
                automatic={automatic}
                onChange={change}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SettingsRow>
  );
}
const styles = StyleSheet.create((theme) => ({
  value: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  swatch: (tone: PaneTone) => ({
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.foregroundExtraMuted,
    backgroundColor: tone === "theme" ? theme.colors.surface0 : identityColor(tone),
  }),
}));
