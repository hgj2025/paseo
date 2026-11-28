import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Folder, GitBranch, Copy, Check, ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { density } from "@/styles/density";
import { DensityIcon } from "@/components/ui/density-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortenPath } from "@/utils/shorten-path";

export interface ExecutionRepository {
  root: string;
  branch: string | null;
  dirty: boolean;
  edited: boolean;
  previousBranch?: string;
}

const COPIED_FEEDBACK_MS = 1500;

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function isPathWithin(target: string, root: string): boolean {
  const normalizedTarget = normalizePath(target);
  const normalizedRoot = normalizePath(root);
  if (normalizedTarget === normalizedRoot) {
    return true;
  }
  const prefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
  return normalizedTarget.startsWith(prefix);
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
}

function findCwdRepository(
  repositories: readonly ExecutionRepository[],
  cwd: string,
): ExecutionRepository | undefined {
  let best: ExecutionRepository | undefined;
  let bestLength = -1;
  for (const repo of repositories) {
    if (!isPathWithin(cwd, repo.root)) {
      continue;
    }
    const length = normalizePath(repo.root).length;
    if (length > bestLength) {
      best = repo;
      bestLength = length;
    }
  }
  return best;
}

function selectPrimaryAndExtraRepositories(
  repositories: readonly ExecutionRepository[],
  cwd: string,
): {
  primary: ExecutionRepository | undefined;
  primaryMatchesCwd: boolean;
  extraRepositories: readonly ExecutionRepository[];
} {
  const cwdRepo = findCwdRepository(repositories, cwd);
  if (cwdRepo) {
    return {
      primary: cwdRepo,
      primaryMatchesCwd: true,
      extraRepositories: repositories.filter((repo) => repo.root !== cwdRepo.root),
    };
  }
  const fallbackPrimary =
    repositories.find((repo) => repo.previousBranch !== undefined) ??
    repositories.find((repo) => repo.edited) ??
    repositories[0];
  if (!fallbackPrimary) {
    return { primary: undefined, primaryMatchesCwd: false, extraRepositories: [] };
  }
  return {
    primary: fallbackPrimary,
    primaryMatchesCwd: false,
    extraRepositories: repositories.filter((repo) => repo.root !== fallbackPrimary.root),
  };
}

function resolveInlineState(input: {
  hasPrimary: boolean;
  connected: boolean;
  loading: boolean;
  failed: boolean;
  t: (key: string) => string;
}): string | undefined {
  if (!input.connected) {
    return input.t("executionContext.offlineShort");
  }
  if (input.hasPrimary) {
    return undefined;
  }
  if (input.loading) {
    return input.t("executionContext.loading");
  }
  if (input.failed) {
    return input.t("executionContext.failed");
  }
  return input.t("executionContext.noRepository");
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
  const { primary, primaryMatchesCwd, extraRepositories } = useMemo(
    () => selectPrimaryAndExtraRepositories(repositories, cwd),
    [cwd, repositories],
  );
  const canExpand = extraRepositories.length > 0;
  const isExpanded = canExpand && expanded;
  const inlineState = resolveInlineState({
    hasPrimary: Boolean(primary),
    connected,
    loading,
    failed,
    t,
  });

  return (
    <View style={barStyle} testID="composer-execution-context">
      <ExecutionSummary
        cwd={cwd}
        primary={primary}
        primaryMatchesCwd={primaryMatchesCwd}
        extraRepositories={extraRepositories}
        inlineState={inlineState}
        expanded={isExpanded}
        toggle={toggle}
        onCopy={onCopy}
        trailing={trailing}
      />
      {isExpanded && (
        <ScrollView
          style={styles.detailsViewport}
          contentContainerStyle={styles.details}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          testID="execution-context-details"
        >
          {extraRepositories.map((repo) => (
            <RepositoryRow key={repo.root} repo={repo} onCopy={onCopy} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ExecutionSummary({
  cwd,
  primary,
  primaryMatchesCwd,
  extraRepositories,
  inlineState,
  expanded,
  toggle,
  onCopy,
  trailing,
}: {
  cwd: string;
  primary: ExecutionRepository | undefined;
  primaryMatchesCwd: boolean;
  extraRepositories: readonly ExecutionRepository[];
  inlineState: string | undefined;
  expanded: boolean;
  toggle: () => void;
  onCopy: (path: string) => Promise<void>;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const disclosure = useMemo(() => ({ expanded }), [expanded]);
  const hasExtraBranchChange = extraRepositories.some((repo) => repo.previousBranch !== undefined);

  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryMain}>
        <CopyableDirectory path={cwd} onCopy={onCopy} />
        {primary ? (
          <BranchBadge
            repo={primary}
            repoPrefix={primaryMatchesCwd ? undefined : basename(primary.root)}
            onCopy={onCopy}
          />
        ) : null}
        {inlineState ? (
          <Text numberOfLines={1} style={styles.secondary}>
            {inlineState}
          </Text>
        ) : null}
        {extraRepositories.length > 0 ? (
          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityState={disclosure}
            aria-expanded={expanded}
            accessibilityLabel={t(
              expanded ? "executionContext.collapse" : "executionContext.expand",
            )}
            style={styles.expandToggle}
            testID="execution-context-toggle"
          >
            <Text style={styles.secondary}>+{extraRepositories.length}</Text>
            {hasExtraBranchChange ? (
              <Text style={styles.change}>{t("executionContext.branchChanged")}</Text>
            ) : null}
            <DensityIcon
              icon={expanded ? ChevronDown : ChevronRight}
              size="xs"
              color="foregroundMuted"
            />
          </Pressable>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

function useCopyAction(value: string, onCopy: (path: string) => Promise<void>) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCopied(false);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [value]);

  const copy = useCallback(async () => {
    await onCopy(value);
    setCopied(true);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, COPIED_FEEDBACK_MS);
  }, [onCopy, value]);

  return { copied, copy };
}

function CopyableDirectory({
  path,
  onCopy,
}: {
  path: string;
  onCopy: (path: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyAction(path, onCopy);
  const displayPath = useMemo(() => shortenPath(path), [path]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Pressable
          onPress={copy}
          accessibilityRole="button"
          accessibilityLabel={t("executionContext.copy", { path })}
          style={styles.directoryButton}
        >
          <DensityIcon icon={Folder} size="xs" color="foregroundMuted" />
          <Text numberOfLines={1} ellipsizeMode="middle" style={styles.path}>
            {displayPath}
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

function buildBranchTooltip(input: {
  branch: string;
  dirty: boolean;
  previousBranch?: string;
  copied: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}): string {
  if (input.copied) {
    return input.t("executionContext.copied");
  }
  const parts = [input.branch];
  if (input.dirty) {
    parts.push(input.t("executionContext.dirty"));
  }
  if (input.previousBranch !== undefined) {
    parts.push(input.t("executionContext.changed", { branch: input.previousBranch }));
  }
  return parts.join(" · ");
}

function BranchBadge({
  repo,
  repoPrefix,
  onCopy,
}: {
  repo: ExecutionRepository;
  repoPrefix?: string;
  onCopy: (path: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const branchText = repo.branch ?? "";
  const { copied, copy } = useCopyAction(branchText, onCopy);

  if (!repo.branch) {
    return (
      <View style={styles.detachedBadge}>
        <DensityIcon
          icon={GitBranch}
          size="xs"
          color={repo.previousBranch !== undefined ? "statusWarning" : "foregroundMuted"}
        />
        <Text numberOfLines={1} style={styles.secondary}>
          {repoPrefix
            ? `${repoPrefix} · ${t("executionContext.detached")}`
            : t("executionContext.detached")}
        </Text>
        {repo.dirty ? <Text style={styles.change}>*</Text> : null}
      </View>
    );
  }

  const tooltipText = buildBranchTooltip({
    branch: repo.branch,
    dirty: repo.dirty,
    previousBranch: repo.previousBranch,
    copied,
    t,
  });

  return (
    <View style={styles.branchGroup}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Pressable
            onPress={copy}
            accessibilityRole="button"
            accessibilityLabel={t("executionContext.copy", { path: repo.branch })}
            style={styles.branchButton}
          >
            <DensityIcon
              icon={GitBranch}
              size="xs"
              color={repo.previousBranch !== undefined ? "statusWarning" : "foregroundMuted"}
            />
            {repoPrefix ? (
              <Text numberOfLines={1} style={styles.secondary}>
                {repoPrefix}
              </Text>
            ) : null}
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.branch}>
              {repo.branch}
            </Text>
            {repo.dirty ? <Text style={styles.change}>*</Text> : null}
            <DensityIcon icon={copied ? Check : Copy} size="xs" color="foregroundMuted" />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top">
          <Text>{tooltipText}</Text>
        </TooltipContent>
      </Tooltip>
      {repo.previousBranch !== undefined ? (
        <Text style={styles.change} accessibilityLiveRegion="polite" numberOfLines={1}>
          {t("executionContext.changed", { branch: repo.previousBranch })}
        </Text>
      ) : null}
    </View>
  );
}

function RepositoryRow({
  repo,
  onCopy,
}: {
  repo: ExecutionRepository;
  onCopy: (path: string) => Promise<void>;
}) {
  return (
    <View style={styles.repositoryRow}>
      <CopyableDirectory path={repo.root} onCopy={onCopy} />
      <BranchBadge repo={repo} onCopy={onCopy} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexShrink: 10,
    minHeight: 0,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 2,
  },
  compactBar: {
    maxHeight: 148,
    minHeight: density.tightRowHeight,
  },
  detailsViewport: {
    flexShrink: 1,
    minHeight: 0,
    maxHeight: 180,
    marginTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  details: {
    paddingVertical: 2,
    gap: 2,
  },
  summaryRow: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    minHeight: density.tightRowHeight,
  },
  summaryMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  trailing: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  directoryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 2,
    minWidth: 0,
    maxWidth: "100%",
    minHeight: density.tightRowHeight,
  },
  branchGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "55%",
  },
  branchButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  detachedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  expandToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    minHeight: density.tightRowHeight,
    paddingHorizontal: 4,
  },
  repositoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: density.tightRowHeight,
  },
  path: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    minWidth: 0,
  },
  branch: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flexShrink: 1,
    minWidth: 0,
  },
  secondary: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  change: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusWarning,
    flexShrink: 0,
  },
}));
