import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Folder, GitBranch, Copy, Check, ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { density } from "@/styles/density";
import { DensityIcon } from "@/components/ui/density-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ExecutionRepository {
  root: string;
  branch: string | null;
  dirty: boolean;
  edited: boolean;
  previousBranch?: string;
}
export function ExecutionContextView({
  cwd,
  repositories,
  connected,
  loading,
  failed,
  onCopy,
  trailing,
  compact = false,
}: {
  cwd: string;
  repositories: readonly ExecutionRepository[];
  connected: boolean;
  loading: boolean;
  failed: boolean;
  onCopy: (path: string) => Promise<void>;
  trailing?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const barStyle = useMemo(() => [styles.bar, compact && styles.compactBar], [compact]);
  let state = t("executionContext.noRepository");
  if (loading) state = t("executionContext.loading");
  if (failed) state = t("executionContext.failed");
  if (!connected) state = t("executionContext.offline");
  const primary = primaryRepository(repositories);
  let summary = repositorySummary(cwd, primary, t("executionContext.detached"));
  if (repositories.length === 0 && (loading || failed)) summary = state;
  return (
    <View style={barStyle} testID="composer-execution-context">
      <ExecutionSummary
        primary={primary}
        summary={summary}
        count={repositories.length}
        connected={connected}
        expanded={expanded}
        toggle={toggle}
        onCopy={onCopy}
        trailing={trailing}
      />
      {expanded && (
        <ScrollView
          style={styles.detailsViewport}
          contentContainerStyle={styles.details}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          testID="execution-context-details"
        >
          <View style={styles.directory}>
            <DensityIcon icon={Folder} size="sm" color="foregroundMuted" />
            <Text style={styles.label}>{t("executionContext.directory")}</Text>
            <CopyPath path={cwd} onCopy={onCopy} />
          </View>
          {repositories.map((repo) => (
            <RepositoryRow key={repo.root} repo={repo} connected={connected} onCopy={onCopy} />
          ))}
          {(repositories.length === 0 || failed || !connected) && (
            <Text style={styles.secondary}>{state}</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}
function ExecutionSummary({
  primary,
  summary,
  count,
  connected,
  expanded,
  toggle,
  onCopy,
  trailing,
}: {
  primary: ExecutionRepository | undefined;
  summary: string;
  count: number;
  connected: boolean;
  expanded: boolean;
  toggle: () => void;
  onCopy: (path: string) => Promise<void>;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const disclosure = useMemo(() => ({ expanded }), [expanded]);
  return (
    <View style={styles.summaryRow}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={disclosure}
        aria-expanded={expanded}
        accessibilityLabel={t(expanded ? "executionContext.collapse" : "executionContext.expand")}
        style={styles.summary}
        testID="execution-context-toggle"
      >
        <DensityIcon
          icon={GitBranch}
          size="sm"
          color={primary?.previousBranch !== undefined ? "statusWarning" : "foregroundMuted"}
        />
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.summaryText}>
          {primary?.branch ? basename(primary.root) : summary}
        </Text>
      </Pressable>
      {primary?.branch && (
        <View style={styles.summaryBranch}>
          <CopyPath key={primary.branch} path={primary.branch} onCopy={onCopy} />
          {primary.dirty && <Text style={styles.secondary}>*</Text>}
        </View>
      )}
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={t(expanded ? "executionContext.collapse" : "executionContext.expand")}
        style={styles.summaryActions}
      >
        {count > 1 && <Text style={styles.secondary}>+{count - 1}</Text>}
        {primary?.previousBranch !== undefined && (
          <Text style={styles.change}>{t("executionContext.branchChanged")}</Text>
        )}
        {!connected && <Text style={styles.secondary}>{t("executionContext.offlineShort")}</Text>}
        <DensityIcon
          icon={expanded ? ChevronDown : ChevronRight}
          size="xs"
          color="foregroundMuted"
        />
      </Pressable>
      {trailing}
    </View>
  );
}
function primaryRepository(repositories: readonly ExecutionRepository[]) {
  return (
    repositories.find((repo) => repo.previousBranch !== undefined) ??
    repositories.find((repo) => repo.edited) ??
    repositories[0]
  );
}
function repositorySummary(
  cwd: string,
  primary: ExecutionRepository | undefined,
  detached: string,
) {
  if (!primary) return basename(cwd);
  return `${basename(primary.root)} · ${primary.branch ?? detached}${primary.dirty ? " *" : ""}`;
}
function basename(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
}

function CopyPath({
  path,
  onCopy,
  branch = false,
}: {
  path: string;
  onCopy: (path: string) => Promise<void>;
  branch?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await onCopy(path);
    setCopied(true);
  }, [path, onCopy]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Pressable
          onPress={copy}
          accessibilityRole="button"
          accessibilityLabel={t("executionContext.copy", { path })}
          style={[styles.pathButton, branch && styles.branchButton]}
        >
          {branch && <DensityIcon icon={GitBranch} size="xs" color="foregroundMuted" />}
          <Text
            numberOfLines={1}
            ellipsizeMode="middle"
            style={branch ? styles.branch : styles.path}
          >
            {path}
          </Text>
          <DensityIcon icon={copied ? Check : Copy} size="xs" color="foregroundMuted" />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top">
        <Text>{copied ? t("executionContext.copied") : path}</Text>
      </TooltipContent>
    </Tooltip>
  );
}
function RepositoryRow({
  repo,
  connected,
  onCopy,
}: {
  repo: ExecutionRepository;
  connected: boolean;
  onCopy: (path: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.repository}>
      <View style={styles.repositoryHeading}>
        <Text style={styles.repoName} numberOfLines={1}>
          {basename(repo.root)}
        </Text>
        <Text style={[styles.repositoryStatus, repo.dirty && styles.change]}>
          {t(repo.dirty ? "executionContext.dirty" : "executionContext.clean")}
        </Text>
      </View>
      {repo.branch ? (
        <CopyPath key={repo.branch} path={repo.branch} onCopy={onCopy} branch />
      ) : (
        <Text style={styles.secondary}>{t("executionContext.detached")}</Text>
      )}
      {!connected && <Text style={styles.secondary}>{t("executionContext.offlineShort")}</Text>}
      <CopyPath path={repo.root} onCopy={onCopy} />
      {repo.previousBranch !== undefined && (
        <Text style={styles.change} accessibilityLiveRegion="polite" numberOfLines={1}>
          {t("executionContext.changed", { branch: repo.previousBranch })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexShrink: 10,
    minHeight: 0,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  compactBar: { maxHeight: 148, minHeight: 44 },
  detailsViewport: { flexShrink: 1, minHeight: 0, maxHeight: 240 },
  summaryRow: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  summary: {
    flex: 1,
    minWidth: 0,
    minHeight: density.rowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  summaryBranch: {
    flex: 2,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  summaryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: density.rowHeight,
  },
  summaryText: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  details: { gap: theme.spacing[2], paddingBottom: theme.spacing[2] },
  directory: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], minWidth: 0 },
  repository: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  repositoryHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  repoName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flex: 1,
    minWidth: 0,
  },
  repositoryStatus: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  branchButton: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  label: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, flexShrink: 0 },
  pathButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    minHeight: density.rowHeight,
  },
  path: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, flexShrink: 1 },
  branch: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  secondary: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, flexShrink: 0 },
  change: { fontSize: theme.fontSize.sm, color: theme.colors.statusWarning, flexShrink: 0 },
}));
