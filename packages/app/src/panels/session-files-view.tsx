import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react-native";
import { DensityIcon } from "@/components/ui/density-icon";
export interface SessionRepository {
  key: string;
  host: string;
  root: string;
  branch: string | null;
  git: boolean;
  pending: boolean;
  files: { path: string; open: () => void }[];
  directories: string[];
  browse: () => void;
}
export function SessionFilesView({
  repositories,
  loading,
  failed,
  offline,
  onRetry,
}: {
  repositories: SessionRepository[];
  loading: boolean;
  failed: boolean;
  offline: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  let notice = "sessionFiles.loading";
  if (failed) notice = "sessionFiles.failed";
  if (offline) notice = "sessionFiles.offline";
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.muted}>
          {t("sessionFiles.summary", {
            repositories: repositories.length,
            files: repositories.reduce((n, r) => n + r.files.length, 0),
          })}
        </Text>
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.link}>{t("sessionFiles.refresh")}</Text>
        </Pressable>
      </View>
      {(loading || failed || offline) && (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {t(notice)}
        </Text>
      )}
      {!loading && !repositories.length && (
        <Text style={styles.empty}>{t("sessionFiles.empty")}</Text>
      )}
      {repositories.map((repo) => (
        <Repository key={repo.key} repo={repo} />
      ))}
      {repositories.length > 0 && <Text style={styles.note}>{t("sessionFiles.coverage")}</Text>}
    </ScrollView>
  );
}
function Repository({ repo }: { repo: SessionRepository }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [showDirectories, setShowDirectories] = useState(false);
  const expandedState = useMemo(() => ({ expanded }), [expanded]);
  const directoriesState = useMemo(() => ({ expanded: showDirectories }), [showDirectories]);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const toggleDirectories = useCallback(() => setShowDirectories((value) => !value), []);
  let branch = t("sessionFiles.noGit");
  if (repo.git) branch = repo.branch ?? t("executionContext.detached");
  if (repo.pending) branch = t("sessionFiles.checking");
  const folders = new Map<string, typeof repo.files>();
  for (const file of repo.files) {
    const relative = file.path.startsWith(`${repo.root}/`)
      ? file.path.slice(repo.root.length + 1)
      : file.path;
    const directory = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : ".";
    folders.set(directory, [...(folders.get(directory) ?? []), file]);
  }
  return (
    <View style={styles.repository}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${repo.host} · ${repo.root} · ${branch}`}
        accessibilityState={expandedState}
        onPress={toggle}
        style={styles.row}
      >
        <DensityIcon
          icon={expanded ? ChevronDown : ChevronRight}
          size="xs"
          color="foregroundMuted"
        />
        <Text style={styles.name} numberOfLines={1}>
          {repo.root.split("/").findLast(Boolean) ?? "/"}
        </Text>
        <Text style={styles.collapsedBranch} numberOfLines={1} ellipsizeMode="middle">
          {repo.git || repo.pending ? branch : repo.host}
        </Text>
        <Text style={styles.muted}>{repo.files.length || ""}</Text>
      </Pressable>
      {expanded && (
        <View style={styles.details}>
          <Text style={styles.path} selectable>
            {repo.host} · {repo.root}
          </Text>
          <View style={styles.row}>
            {repo.git && <DensityIcon icon={GitBranch} size="xs" color="foregroundMuted" />}
            <Text style={styles.branch} numberOfLines={1}>
              {branch}
            </Text>
            <Pressable accessibilityRole="button" onPress={repo.browse}>
              <Text style={styles.link}>{t("sessionFiles.browse")}</Text>
            </Pressable>
          </View>
          <View style={styles.tree}>
            {Array.from(folders)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([directory, files]) => (
                <View key={directory}>
                  {directory !== "." && (
                    <Text style={styles.folder} numberOfLines={1}>
                      {directory}/
                    </Text>
                  )}
                  {files
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map((file) => (
                      <Pressable
                        key={file.path}
                        accessibilityRole="button"
                        onPress={file.open}
                        style={styles.file}
                      >
                        <Text style={styles.fileName} numberOfLines={1}>
                          {file.path.split("/").pop()}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              ))}
            {!!repo.directories.length && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={directoriesState}
                  onPress={toggleDirectories}
                  style={styles.directoryToggle}
                >
                  <DensityIcon
                    icon={showDirectories ? ChevronDown : ChevronRight}
                    size="xs"
                    color="foregroundMuted"
                  />
                  <Text style={styles.muted}>
                    {t("sessionFiles.commandDirectories", { count: repo.directories.length })}
                  </Text>
                </Pressable>
                {showDirectories &&
                  repo.directories.map((path) => (
                    <Text key={path} style={styles.path} selectable>
                      {path}
                    </Text>
                  ))}
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
export function SessionFilesTabs({
  mode,
  onChange,
}: {
  mode: "session" | "directory";
  onChange: (value: "session" | "directory") => void;
}) {
  return (
    <View style={sessionFilesStyles.tabs}>
      <ModeTab value="session" selected={mode === "session"} onChange={onChange} />
      <ModeTab value="directory" selected={mode === "directory"} onChange={onChange} />
    </View>
  );
}
function ModeTab({
  value,
  selected,
  onChange,
}: {
  value: "session" | "directory";
  selected: boolean;
  onChange: (value: "session" | "directory") => void;
}) {
  const { t } = useTranslation();
  const state = useMemo(() => ({ selected }), [selected]);
  const press = useCallback(() => onChange(value), [onChange, value]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={state}
      onPress={press}
      style={[sessionFilesStyles.tab, selected && sessionFilesStyles.selected]}
    >
      <Text style={[sessionFilesStyles.tabText, selected && sessionFilesStyles.selectedText]}>
        {t(`sessionFiles.${value}`)}
      </Text>
    </Pressable>
  );
}
export const sessionFilesStyles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  tabs: {
    flexDirection: "row",
    padding: theme.spacing[2],
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: theme.spacing[2],
    alignItems: "center",
    borderRadius: theme.borderRadius.sm,
  },
  selected: { backgroundColor: theme.colors.surface2 },
  tabText: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  selectedText: { color: theme.colors.foreground },
}));
const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  content: { padding: theme.spacing[3], gap: theme.spacing[3] },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  link: { fontSize: theme.fontSize.sm, color: theme.colors.foreground, paddingVertical: 4 },
  notice: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  empty: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, paddingVertical: 24 },
  repository: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], minHeight: 28 },
  name: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flex: 1,
  },
  path: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, lineHeight: 18 },
  details: { gap: theme.spacing[1], paddingBottom: theme.spacing[2] },
  collapsedBranch: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    maxWidth: "43%",
    flexShrink: 1,
  },
  branch: { fontSize: theme.fontSize.sm, color: theme.colors.foreground, flex: 1 },
  tree: { paddingLeft: theme.spacing[3], gap: theme.spacing[1] },
  folder: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, paddingTop: 8 },
  directoryToggle: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 4 },
  file: { minHeight: 30, justifyContent: "center", paddingHorizontal: theme.spacing[1] },
  fileName: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, lineHeight: 18 },
}));
