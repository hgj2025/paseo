import { memberTabLabel } from "./member-tab-label";
import { usePaneHeaderMember } from "./pane-member-header";
import { useWorkspaceLayoutStore, findPaneContainingTab } from "@/stores/workspace-layout-store";
import { useProviderIcon } from "@/components/provider-icons";
import { useSessionStore } from "@/stores/session-store";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { Theme } from "@/styles/theme";
import { StatusIcon } from "@/components/status-icon";
import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Check } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { getPanelRegistration, type PanelIconProps } from "@/panels/panel-registry";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { usePanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { resolveWorkspaceTabScope } from "@/workspace-tabs/scope";

export interface WorkspaceTabPresentation {
  key: string;
  kind: WorkspaceTabDescriptor["kind"];
  label: string;
  subtitle: string;
  tooltip: string;
  modified: boolean;
  showCloseButton: boolean;
  titleState: "ready" | "loading";
  icon: React.ComponentType<PanelIconProps>;
  statusBucket: SidebarStateBucket | null;
  historyTarget?: { serverId: string; agentId: string };
}

interface WorkspaceTabPresentationResolverProps {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  children: (presentation: WorkspaceTabPresentation) => ReactNode;
}

type WorkspaceTabPresentationResolverInnerProps = WorkspaceTabPresentationResolverProps & {
  registration: NonNullable<ReturnType<typeof getPanelRegistration>>;
  layoutOwner: { serverId: string; workspaceId: string };
  scopeBound: boolean;
};

export function WorkspaceTabPresentationResolver({
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverProps): ReactElement {
  const resolved = resolveWorkspaceTabScope(tab.target, { serverId, workspaceId });
  const registration = getPanelRegistration(resolved.target.kind);
  invariant(registration, `No panel registration for kind: ${tab.kind}`);
  const layoutOwner = useMemo(() => ({ serverId, workspaceId }), [serverId, workspaceId]);
  const resourceTab = useMemo(
    () => ({ ...tab, kind: resolved.target.kind, target: resolved.target }),
    [tab, resolved.target],
  );

  return (
    <WorkspaceTabPresentationResolverInner
      key={`${tab.key}:${resolved.scope.serverId}:${resolved.target.kind}`}
      registration={registration}
      layoutOwner={layoutOwner}
      scopeBound={tab.target.kind === "scoped"}
      tab={resourceTab}
      serverId={resolved.scope.serverId}
      workspaceId={resolved.scope.workspaceId}
    >
      {children}
    </WorkspaceTabPresentationResolverInner>
  );
}

function WorkspaceTabPresentationResolverInner({
  registration,
  tab,
  serverId,
  workspaceId,
  children,
  layoutOwner,
  scopeBound,
}: WorkspaceTabPresentationResolverInnerProps): ReactElement {
  const descriptor = registration.useDescriptor(tab.target as never, {
    serverId,
    workspaceId,
    tabId: tab.tabId,
  });
  const attributes = usePanelInstanceAttributes({ ...layoutOwner, tabId: tab.tabId });
  const ownerKey = `${layoutOwner.serverId}:${layoutOwner.workspaceId}`;
  const paneId = useWorkspaceLayoutStore((state) => {
    const layout = state.layoutByWorkspace[ownerKey];
    return tab.target.kind === "agent" && layout
      ? findPaneContainingTab(layout.root, tab.tabId)?.id
      : undefined;
  });
  const { member } = usePaneHeaderMember(layoutOwner.serverId, layoutOwner.workspaceId, paneId);
  const tabMember =
    tab.target.kind === "agent" &&
    member?.agentId === tab.target.agentId &&
    member.serverId === serverId &&
    member.workspaceId === workspaceId
      ? member
      : undefined;
  const execution = tabMember?.execution;
  const executionAgent = useSessionStore((state) =>
    tabMember
      ? (state.sessions[execution?.serverId ?? tabMember.serverId]?.agents.get(
          execution?.agentId ?? tabMember.agentId,
        ) ??
        state.sessions[execution?.serverId ?? tabMember.serverId]?.agentDetails.get(
          execution?.agentId ?? tabMember.agentId,
        ))
      : undefined,
  );
  const executionIcon = useProviderIcon(
    execution?.provider ?? tabMember?.provider ?? "codex",
    execution?.serverId ?? serverId,
  );
  const executionStatus = executionAgent
    ? deriveSidebarStateBucket({
        status: executionAgent.status,
        pendingPermissionCount: executionAgent.pendingPermissions.length,
        requiresAttention: executionAgent.requiresAttention,
        attentionReason: executionAgent.attentionReason,
      })
    : null;

  const memberLabel = tabMember
    ? memberTabLabel(tabMember, executionAgent?.model ?? execution?.model)
    : null;

  const presentation = useMemo(
    () => ({
      historyTarget:
        tab.target.kind === "agent"
          ? {
              serverId: execution?.serverId ?? serverId,
              agentId: execution?.agentId ?? tab.target.agentId,
            }
          : undefined,
      key: tab.key,
      kind: tab.kind,
      label: memberLabel ?? descriptor.label,
      subtitle: descriptor.subtitle,
      tooltip: memberLabel ?? descriptor.tooltip,
      modified: attributes.modified,
      showCloseButton: scopeBound || registration.showCloseButton,
      titleState: tabMember ? ("ready" as const) : descriptor.titleState,
      icon: execution ? executionIcon : descriptor.icon,
      statusBucket: execution ? executionStatus : descriptor.statusBucket,
    }),
    [
      serverId,
      tab.target,
      tabMember,
      memberLabel,
      execution,
      executionIcon,
      executionStatus,
      descriptor.icon,
      descriptor.label,
      descriptor.tooltip,
      descriptor.statusBucket,
      descriptor.subtitle,
      descriptor.titleState,
      tab.key,
      tab.kind,
      attributes.modified,
      registration.showCloseButton,
      scopeBound,
    ],
  );

  return <>{children(presentation)}</>;
}

interface WorkspaceTabIconProps {
  presentation: WorkspaceTabPresentation;
  active?: boolean;
  size?: number;
  strokeWidth?: number;
  statusDotBorderColor?: string;
  /**
   * The surface this icon is sitting on, so the running ring can knock out of it. This icon is
   * shared by the desktop tab strip, the tab switcher trigger, the split drag chip and the
   * subagents track, which are on different surfaces and some of which change surface on hover —
   * it cannot work the colour out for itself.
   */
  backdrop: SurfaceBackdrop;
}

const ThemedCheckIcon = withUnistyles(Check);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export function WorkspaceTabIcon({
  presentation,
  active = false,
  size = 14,
  strokeWidth,
  statusDotBorderColor,
  backdrop,
}: WorkspaceTabIconProps): ReactElement {
  const Icon = presentation.icon;
  const iconColor = active ? styles.iconActive.color : styles.iconInactive.color;
  return (
    <StatusIcon
      statusBucket={presentation.statusBucket}
      size={size}
      statusDotBorderColor={statusDotBorderColor}
      backdrop={backdrop}
    >
      <Icon size={size} color={iconColor} strokeWidth={strokeWidth} />
    </StatusIcon>
  );
}

interface WorkspaceTabOptionRowProps {
  presentation: WorkspaceTabPresentation;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  trailingAccessory?: ReactNode;
}

export function WorkspaceTabOptionRow({
  presentation,
  selected,
  active,
  onPress,
  trailingAccessory,
}: WorkspaceTabOptionRowProps): ReactElement {
  const { t } = useTranslation();
  const isOptionActive = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      Boolean(hovered) || pressed || active,
    [active],
  );
  const pressableStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionMainPressable,
      isOptionActive(state) && styles.optionRowActive,
    ],
    [isOptionActive],
  );
  const optionRowStyle = useMemo(
    () => [styles.optionRow, active && styles.optionRowActive],
    [active],
  );
  return (
    <View style={optionRowStyle}>
      <Pressable onPress={onPress} style={pressableStyle}>
        {(state) => {
          const optionActive = isOptionActive(state);
          return (
            <>
              <View style={styles.optionLeadingSlot}>
                <WorkspaceTabIcon
                  presentation={presentation}
                  active={selected || active}
                  backdrop={optionActive ? "surface1" : "surface0"}
                />
              </View>
              <View style={styles.optionContent}>
                <Text numberOfLines={1} style={styles.optionLabel}>
                  {presentation.titleState === "loading"
                    ? t("workspace.tabs.loading")
                    : presentation.label}
                </Text>
              </View>
            </>
          );
        }}
      </Pressable>
      {presentation.modified ? (
        <View style={styles.optionModifiedDot} accessibilityLabel={t("workspace.tabs.modified")} />
      ) : null}
      {selected ? (
        <View style={styles.optionTrailingSlot}>
          <ThemedCheckIcon size={16} uniProps={mutedColorMapping} />
        </View>
      ) : null}
      {trailingAccessory ? (
        <View style={styles.optionTrailingAccessorySlot}>{trailingAccessory}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  iconActive: {
    color: theme.colors.foreground,
  },
  iconInactive: {
    color: theme.colors.foregroundMuted,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderRadius: 0,
    marginHorizontal: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  optionMainPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  optionRowActive: {
    backgroundColor: theme.colors.surface1,
  },
  optionLeadingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionContent: {
    flex: 1,
    flexShrink: 1,
  },
  optionLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  optionTrailingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionModifiedDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  optionTrailingAccessorySlot: {
    alignItems: "center",
    justifyContent: "center",
  },
}));
