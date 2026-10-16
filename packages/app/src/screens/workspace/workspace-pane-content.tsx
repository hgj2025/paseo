import { ComposerEditingScope } from "@/composer/editing-session";
import React, { useMemo, type ComponentType } from "react";
import invariant from "tiny-invariant";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getPanelRegistration } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { RenderProfile } from "@/utils/render-profiler";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import type { OpenInSidePaneSource } from "@/workspace-tabs/open-beside";
import type { PaneHost } from "@/panels/panel-manifest";
import { resolveWorkspaceTabScope, scopeWorkspaceTabTarget } from "@/workspace-tabs/scope";
import { WorkspacePaneSession } from "./workspace-pane-session";

export interface WorkspacePaneContentModel {
  key: string;
  Component: ComponentType;
  paneContextValue: PaneContextValue;
}

export interface BuildWorkspacePaneContentModelInput {
  tab: WorkspaceTabDescriptor;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  host: PaneHost;
  fileNavigationRevision?: number;
  onOpenTab: (target: WorkspaceTabDescriptor["target"]) => void;
  onOpenPreferredTarget: (
    target: WorkspaceTabDescriptor["target"],
    source: OpenInSidePaneSource,
  ) => void;
  onOpenTargetToSide?: (target: WorkspaceTabDescriptor["target"]) => void;
  onCloseCurrentTab: () => void;
  onRetargetCurrentTab: (target: WorkspaceTabDescriptor["target"]) => void;
  onSetCurrentTabState: (state: WorkspaceTabDescriptor["state"]) => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
  onOpenImportSheet: () => void;
}

export function buildWorkspacePaneContentModel({
  tab,
  normalizedServerId,
  normalizedWorkspaceId,
  host,
  fileNavigationRevision,
  onOpenTab,
  onOpenPreferredTarget,
  onOpenTargetToSide,
  onCloseCurrentTab,
  onRetargetCurrentTab,
  onSetCurrentTabState,
  onOpenWorkspaceFile,
  onOpenImportSheet,
}: BuildWorkspacePaneContentModelInput): WorkspacePaneContentModel {
  ensurePanelsRegistered();
  const { scope, target } = resolveWorkspaceTabScope(tab.target, {
    serverId: normalizedServerId,
    workspaceId: normalizedWorkspaceId,
  });
  const bind = (next: WorkspaceTabDescriptor["target"]) =>
    tab.target.kind === "scoped" ? scopeWorkspaceTabTarget(next, scope) : next;
  const registration = getPanelRegistration(target.kind);
  invariant(registration, `No panel registration for kind: ${target.kind}`);
  return {
    key: `${scope.serverId}:${scope.workspaceId}:${tab.tabId}`,
    Component: registration.component,
    paneContextValue: {
      ...scope,
      scopeBound: tab.target.kind === "scoped",
      layoutOwner: { serverId: normalizedServerId, workspaceId: normalizedWorkspaceId },
      host,
      tabId: tab.tabId,
      target,
      state: tab.state,
      fileNavigationRevision,
      openTab: (next) => onOpenTab(bind(next)),
      openPreferredTarget: (next, source) => onOpenPreferredTarget(bind(next), source),
      openTargetToSide: onOpenTargetToSide ? (next) => onOpenTargetToSide(bind(next)) : undefined,
      closeCurrentTab: onCloseCurrentTab,
      retargetCurrentTab: (next) => onRetargetCurrentTab(bind(next)),
      setCurrentTabState: onSetCurrentTabState,
      openFileInWorkspace:
        tab.target.kind !== "scoped"
          ? onOpenWorkspaceFile
          : (request) => {
              const file = bind({ kind: "file", ...request.location });
              if (request.disposition === "side" && onOpenTargetToSide) onOpenTargetToSide(file);
              else if (request.disposition === "preferred")
                onOpenPreferredTarget(file, "chatFiles");
              else onOpenTab(file);
            },
      openImportSheet: onOpenImportSheet,
    },
  };
}

export interface WorkspacePaneContentProps {
  content: WorkspacePaneContentModel;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  onFocusPane?: () => void;
}

export function WorkspacePaneContent({
  content,
  isWorkspaceFocused,
  isPaneFocused,
  onFocusPane,
}: WorkspacePaneContentProps) {
  const { Component, key, paneContextValue } = content;
  const openTab = useStableEvent(paneContextValue.openTab);
  const openPreferredTarget = useStableEvent(paneContextValue.openPreferredTarget);
  const openTargetToSide = useStableEvent(paneContextValue.openTargetToSide ?? (() => undefined));
  const closeCurrentTab = useStableEvent(paneContextValue.closeCurrentTab);
  const retargetCurrentTab = useStableEvent(paneContextValue.retargetCurrentTab);
  const setCurrentTabState = useStableEvent(paneContextValue.setCurrentTabState);
  const openFileInWorkspace = useStableEvent(paneContextValue.openFileInWorkspace);
  const openImportSheet = useStableEvent(paneContextValue.openImportSheet);
  const stablePaneContextValue = useMemo(
    () => ({
      serverId: paneContextValue.serverId,
      workspaceId: paneContextValue.workspaceId,
      scopeBound: paneContextValue.scopeBound,
      layoutOwner: paneContextValue.layoutOwner,
      host: paneContextValue.host,
      tabId: paneContextValue.tabId,
      target: paneContextValue.target,
      state: paneContextValue.state,
      fileNavigationRevision: paneContextValue.fileNavigationRevision,
      openTab,
      openPreferredTarget,
      openTargetToSide: paneContextValue.openTargetToSide ? openTargetToSide : undefined,
      closeCurrentTab,
      retargetCurrentTab,
      setCurrentTabState,
      openFileInWorkspace,
      openImportSheet,
    }),
    [
      closeCurrentTab,
      openFileInWorkspace,
      openImportSheet,
      openTab,
      openPreferredTarget,
      openTargetToSide,
      paneContextValue.serverId,
      paneContextValue.fileNavigationRevision,
      paneContextValue.tabId,
      paneContextValue.target,
      paneContextValue.state,
      paneContextValue.workspaceId,
      paneContextValue.scopeBound,
      paneContextValue.layoutOwner,
      paneContextValue.host,
      paneContextValue.openTargetToSide,
      retargetCurrentTab,
      setCurrentTabState,
    ],
  );
  const paneFocusValue = useMemo(
    () =>
      createPaneFocusContextValue({
        isWorkspaceFocused,
        isPaneFocused,
        onFocusPane,
      }),
    [isPaneFocused, isWorkspaceFocused, onFocusPane],
  );

  return (
    <RenderProfile
      id={`WorkspacePaneContent:${paneContextValue.target.kind}:${paneContextValue.tabId}`}
    >
      <PaneProvider value={stablePaneContextValue}>
        <PaneFocusProvider value={paneFocusValue}>
          <ComposerEditingScope
            tabId={paneContextValue.tabId}
            targetKey={JSON.stringify(paneContextValue.target)}
          >
            <WorkspacePaneSession key={key}>
              <Component />
            </WorkspacePaneSession>
          </ComposerEditingScope>
        </PaneFocusProvider>
      </PaneProvider>
    </RenderProfile>
  );
}
