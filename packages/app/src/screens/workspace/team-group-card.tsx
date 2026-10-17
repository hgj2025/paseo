import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { v4 as uuid } from "uuid";
import type {
  TeamAction,
  TeamGroup,
  TeamGroupStep,
  WorkspaceTeam,
} from "@getpaseo/protocol/workspace-team";
import { Button } from "@/components/ui/button";
import { ScrollView } from "@/components/ui/scroll-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useWorkspaceTeam } from "./workspace-team-context";

function GroupStatus({ status }: { status: TeamGroup["status"] | TeamGroupStep["status"] }) {
  const { t } = useTranslation();
  let variant: "success" | "error" | "muted" | "warning" = "muted";
  if (status === "completed") variant = "success";
  if (status === "failed") variant = "error";
  if (["permission", "uncertain", "blocked", "clarification"].includes(status)) variant = "warning";
  return (
    <StatusBadge size="xs" label={t(`workspace.team.group.status.${status}`)} variant={variant} />
  );
}

function GroupStep({
  step,
  team,
  pending,
  onRetry,
}: {
  step: TeamGroupStep;
  team: WorkspaceTeam;
  pending: boolean;
  onRetry(memberId: string): void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggle = useStableEvent(() => setExpanded((value) => !value));
  const retry = useStableEvent(() => onRetry(step.memberId));
  const alias = (id: string) => `@${team.members.find((m) => m.id === id)?.alias ?? "?"}`;
  return (
    <View style={styles.step} testID={`team-group-step-${step.memberId}`}>
      <View style={styles.row}>
        <Text style={styles.member}>{alias(step.memberId)}</Text>
        <GroupStatus status={step.status} />
        <View style={styles.spacer} />
        <Button variant="ghost" size="xs" onPress={toggle}>
          {t(expanded ? "workspace.team.group.hide" : "workspace.team.group.details")}
        </Button>
        {step.status === "failed" && (
          <Button
            variant="outline"
            size="xs"
            onPress={retry}
            disabled={pending}
            testID="team-group-retry"
          >
            {t("workspace.team.group.retry")}
          </Button>
        )}
      </View>
      {step.dependsOn.length > 0 && (
        <Text style={styles.meta}>
          {t("workspace.team.group.dependsOn")} {step.dependsOn.map(alias).join(", ")}
        </Text>
      )}
      {expanded && (
        <View style={styles.details}>
          <Text style={styles.body} selectable>
            {step.prompt}
          </Text>
          <Text style={styles.meta} selectable>
            {step.result || t("workspace.team.dashboard.noResult")}
          </Text>
          <Text style={styles.meta}>
            {t("workspace.team.group.attempts", { count: step.taskIds.length })}
          </Text>
        </View>
      )}
    </View>
  );
}

export function TeamGroupCard({ group, compact = false }: { group: TeamGroup; compact?: boolean }) {
  const { t } = useTranslation();
  const context = useWorkspaceTeam();
  const [expanded, setExpanded] = useState(!compact);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const retryIds = useRef(new Map<string, string>());
  const toggle = useStableEvent(() => setExpanded((value) => !value));
  const run = useStableEvent(async (action: TeamAction) => {
    if (!context || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await context.execute(action);
    } catch (cause) {
      setError(String(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  });
  const refresh = useStableEvent(() => {
    void run({ kind: "refresh_group", groupId: group.id });
  });
  const retry = useStableEvent((memberId: string) => {
    const step = group.steps.find((s) => s.memberId === memberId);
    // A lost response keeps this ID; only a new failed attempt permits another retry.
    const key = `${memberId}:${step?.taskIds.at(-1)}`;
    const retryId = retryIds.current.get(key) ?? uuid();
    retryIds.current.set(key, retryId);
    void run({ kind: "retry_group_step", groupId: group.id, memberId, retryId });
  });
  if (!context?.team) return null;
  const team = context.team;
  const completed = group.steps.filter((step) => step.status === "completed").length;
  return (
    <View style={styles.card} testID={`team-group-${group.id}`}>
      <View style={styles.row}>
        <Text style={styles.title}>{t(`workspace.team.group.${group.mode}`)}</Text>
        <GroupStatus status={group.status} />
        <Text style={styles.meta}>
          {completed}/{group.memberIds.length}
        </Text>
        <View style={styles.spacer} />
        <Button size="xs" variant="ghost" onPress={toggle} testID="team-group-expand">
          {t(expanded ? "workspace.team.group.hide" : "workspace.team.group.details")}
        </Button>
      </View>
      <Text style={styles.body} numberOfLines={expanded ? undefined : 1} selectable>
        {group.prompt}
      </Text>
      {!expanded && (
        <Text style={styles.meta} numberOfLines={1}>
          {group.memberIds
            .map((id) => `@${team.members.find((m) => m.id === id)?.alias ?? "?"}`)
            .join(" · ")}
        </Text>
      )}
      {expanded && (
        <ScrollView style={styles.scroll}>
          {group.steps.map((step) => (
            <GroupStep
              key={step.memberId}
              step={step}
              team={team}
              pending={pending}
              onRetry={retry}
            />
          ))}
          {!group.steps.length && (
            <Text style={styles.meta}>{t("workspace.team.group.planningHint")}</Text>
          )}
          {group.result && (
            <Text style={styles.meta} selectable>
              {group.result}
            </Text>
          )}
          {["permission", "uncertain"].some((status) =>
            group.steps.some((s) => s.status === status),
          ) && <Text style={styles.meta}>{t("workspace.team.group.attentionHint")}</Text>}
          <View style={styles.row}>
            <Button
              size="xs"
              variant="ghost"
              onPress={refresh}
              disabled={pending}
              testID="team-group-refresh"
            >
              {t("workspace.team.group.refresh")}
            </Button>
            <Text style={styles.meta}>
              {t(`workspace.team.dashboard.notification.${group.notification}`)}
            </Text>
          </View>
          <Text style={styles.meta} selectable>
            {group.id} · {new Date(group.createdAt).toLocaleString()}
          </Text>
        </ScrollView>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export function TeamGroupFeed() {
  const context = useWorkspaceTeam();
  const groups = context?.team?.groups;
  const latest = groups?.at(-1);
  if (!latest) return null;
  // Once delivered, the durable card belongs to the Captain conversation timeline.
  if (
    latest.mode === "coordinate" &&
    context?.team?.tasks.some(
      (task) => task.id === latest.coordinatorTaskId && task.status !== "uncertain",
    )
  )
    return null;
  if (latest.mode === "broadcast" && latest.notification === "delivered") return null;
  return <TeamGroupCard key={latest.id} group={latest} compact />;
}

export function TeamGroupHistory() {
  const { t } = useTranslation();
  const context = useWorkspaceTeam();
  const groups = (context?.team?.groups ?? []).toReversed();
  return (
    <ScrollView style={styles.history}>
      <View style={styles.historyContent}>
        {!groups.length && <Text style={styles.meta}>{t("workspace.team.group.empty")}</Text>}
        {groups.map((group) => (
          <TeamGroupCard key={group.id} group={group} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[2],
    gap: theme.spacing[2],
  },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  spacer: { flex: 1 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  body: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, lineHeight: 20 },
  member: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, lineHeight: 18 },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  step: {
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  details: { paddingVertical: theme.spacing[2], gap: theme.spacing[2] },
  scroll: { maxHeight: 260 },
  history: { flex: 1 },
  historyContent: { padding: theme.spacing[4] },
}));

export function useTeamMessageGroup(message: string) {
  const context = useWorkspaceTeam();
  return context?.team?.groups?.find((request) =>
    request.mode === "coordinate"
      ? message.startsWith(`[Team task ${request.coordinatorTaskId}]`)
      : message.startsWith(`[Team request result ${request.id}]`),
  );
}
