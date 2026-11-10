import { Pressable, Text, View } from "react-native";
import { Files } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

import { SessionFiles } from "./session-files";
import { SessionFilesTabs, sessionFilesStyles } from "./session-files-view";
import { scopeWorkspaceTabTarget } from "@/workspace-tabs/scope";
import type { WorkspaceScope } from "@/workspace-tabs/model";

const ThemedFiles = withUnistyles(Files);
const filesPanelPresentation = {
  label: (t) => t("panels.files.label"),
  subtitle: (t) => t("panels.files.subtitle"),
  tooltip: (t) => t("panels.files.tooltip"),
  icon: ThemedFiles,
} satisfies PanelPresentation;

function FilesPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, layoutOwner, target, openPreferredTarget, openTargetToSide } =
    usePaneContext();
  const [mode, setMode] = useState<"session" | "directory">("session");
  const [browse, setBrowse] = useState<{ scope: WorkspaceScope; path: string } | null>(null);
  const workspaceRoot = useWorkspaceDirectory(serverId, workspaceId);
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId, layoutOwner });
  invariant(target.kind === "files", "FilesPanel requires files target");
  const onOpenFile = useCallback(
    (path: string) =>
      openPreferredTarget(
        scopeWorkspaceTabTarget({ kind: "file", path }, browse?.scope ?? { serverId, workspaceId }),
        "explorerFiles",
      ),
    [openPreferredTarget, browse, serverId, workspaceId],
  );
  const onOpenFileToSide = useCallback(
    (path: string) =>
      openTargetToSide?.(
        scopeWorkspaceTabTarget({ kind: "file", path }, browse?.scope ?? { serverId, workspaceId }),
      ),
    [openTargetToSide, browse, serverId, workspaceId],
  );
  const onBrowse = useCallback((scope: WorkspaceScope, path: string) => {
    setBrowse({ scope, path });
    setMode("directory");
  }, []);
  const resetBrowse = useCallback(() => setBrowse(null), []);
  return (
    <View style={sessionFilesStyles.fill}>
      <SessionFilesTabs mode={mode} onChange={setMode} />
      {mode === "session" ? (
        <SessionFiles onBrowse={onBrowse} />
      ) : (
        <>
          {browse && (
            <Pressable onPress={resetBrowse} style={sessionFilesStyles.tabs}>
              <Text style={sessionFilesStyles.tabText}>{t("sessionFiles.backToWorkspace")}</Text>
            </Pressable>
          )}
          {browse?.path || workspaceRoot ? (
            <FileExplorerPane
              key={`${browse?.scope.serverId ?? serverId}:${browse?.path ?? workspaceRoot}`}
              serverId={browse?.scope.serverId ?? serverId}
              workspaceId={browse?.scope.workspaceId ?? workspaceId}
              workspaceRoot={browse?.path ?? workspaceRoot!}
              onOpenFile={onOpenFile}
              onOpenFileToSide={openTargetToSide ? onOpenFileToSide : undefined}
              onAddToChat={!browse && canAddToChat ? addFile : undefined}
            />
          ) : (
            <View style={styles.centerState}>
              <Text>{t("panels.file.directoryMissing")}</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

export const filesPanelRegistration = definePanel("files", {
  component: FilesPanel,
  presentation: filesPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
}));
