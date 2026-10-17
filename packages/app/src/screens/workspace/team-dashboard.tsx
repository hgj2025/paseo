import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TeamMember, TeamTask, WorkspaceTeam } from "@getpaseo/protocol/workspace-team";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { ScrollView } from "@/components/ui/scroll-view";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { TeamGroupHistory } from "./team-group-card";
import { MemberEditor } from "./team-member-card";
import { useWorkspaceTeam, WorkspaceTeamProvider } from "./workspace-team-context";

type Tab = "groups" | "tasks" | "activity" | "members";
type Filter = "all" | "active" | "attention" | "completed";
interface TaskView {
  tab: Tab;
  filter: Filter;
  search: string;
  selectedId: string | null;
}
const INITIAL_VIEW: TaskView = { tab: "tasks", filter: "all", search: "", selectedId: null };
const variants: Record<TeamTask["status"], StatusBadgeVariant> = {
  sending: "muted",
  running: "muted",
  permission: "warning",
  completed: "success",
  failed: "error",
  uncertain: "warning",
};
function TaskStatus({ task }: { task: TeamTask }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      size="xs"
      label={t(`workspace.team.status.${task.status}`)}
      variant={variants[task.status]}
    />
  );
}
function Empty({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.hint}>{description}</Text>
    </View>
  );
}
export function TeamDashboard({
  onClose,
  onOpenMember,
}: {
  onClose(): void;
  onOpenMember(member: TeamMember): void;
}) {
  const context = useWorkspaceTeam()!;
  const { team } = context;
  const connected = useHostRuntimeIsConnected(context.ownerServerId);
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const openMember = useStableEvent((member: TeamMember) => {
    onOpenMember(member);
    onClose();
  });
  const refresh = useStableEvent(async (task?: TeamTask) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await context.execute(task ? { kind: "refresh", taskId: task.id } : { kind: "read" });
    } catch (err) {
      setError(String(err));
    } finally {
      setPending(false);
    }
  });
  const reload = useStableEvent(() => {
    void refresh();
  });
  const contextBridge = useMemo(
    () => (children: ReactNode) => (
      <WorkspaceTeamProvider value={context}>{children}</WorkspaceTeamProvider>
    ),
    [context],
  );
  const header = useMemo(
    () => ({
      title: t("workspace.team.dashboard.title"),
      actions: (
        <Button
          size="xs"
          variant="ghost"
          disabled={!connected || pending}
          onPress={reload}
          testID="team-refresh"
        >
          {t("workspace.team.dashboard.refresh")}
        </Button>
      ),
    }),
    [t, connected, pending, reload],
  );
  const failure = connected ? error || context.error : t("workspace.team.dashboard.offline");
  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={header}
      desktopMaxWidth={1040}
      desktopHeight="85%"
      scrollable={false}
      contentStyle={styles.frame}
      snapPoints={["90%"]}
      contextBridge={contextBridge}
      testID="team-dashboard"
    >
      {failure && <Text style={styles.error}>{failure}</Text>}
      {team ? (
        <TeamContent
          team={team}
          connected={connected}
          pending={pending}
          onOpenMember={openMember}
          onRefresh={refresh}
        />
      ) : (
        <Empty
          title={t(
            context.error
              ? "workspace.team.dashboard.loadFailed"
              : "workspace.team.dashboard.loading",
          )}
          description={t("workspace.team.dashboard.refreshHint")}
        />
      )}
    </AdaptiveModalSheet>
  );
}
interface TeamContentProps {
  team: WorkspaceTeam;
  connected: boolean;
  pending: boolean;
  onOpenMember(member: TeamMember): void;
  onRefresh(task: TeamTask): Promise<void>;
}
function TeamContent({ team, connected, pending, onOpenMember, onRefresh }: TeamContentProps) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const [view, setView] = useState<TaskView>(() => ({
    ...INITIAL_VIEW,
    tab: team.groups?.length ? "groups" : "tasks",
  }));
  const [editingId, setEditingId] = useState<string | null>(null);
  const setTab = useStableEvent((tab: Tab) => setView((v) => ({ ...v, tab })));
  const closeEditor = useStableEvent(() => setEditingId(null));
  const showTask = useStableEvent((id: string) => setView({ ...INITIAL_VIEW, selectedId: id }));
  const editing = team.members.find((m) => m.id === editingId);
  const memberName = useStableEvent(
    (id: string | null) =>
      team.members.find((m) => m.id === id)?.alias ||
      t(id ? "workspace.team.dashboard.formerMember" : "workspace.team.dashboard.you"),
  );
  const hostName = useStableEvent(
    (id: string) => hosts.find((h) => h.serverId === id)?.label || id,
  );
  const tasks = useMemo(
    () => [...team.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [team.tasks],
  );
  const tabs = useMemo(
    () =>
      (["groups", "tasks", "activity", "members"] as const).map((value) => ({
        value,
        label: t(`workspace.team.dashboard.${value}`),
        testID: `team-tab-${value}`,
      })),
    [t],
  );
  const active = tasks.filter((task) => ["running", "sending"].includes(task.status)).length;
  const attention = tasks.filter((task) =>
    ["permission", "uncertain", "failed"].includes(task.status),
  ).length;
  return (
    <>
      <View style={styles.toolbar}>
        <SegmentedControl options={tabs} value={view.tab} onValueChange={setTab} size="sm" />
      </View>
      <View style={styles.summary}>
        <Text style={styles.meta}>
          {t("workspace.team.dashboard.summary", {
            members: team.members.length,
            active,
            attention,
          })}
        </Text>
      </View>
      {view.tab === "groups" && <TeamGroupHistory />}
      {view.tab === "members" && (
        <ScrollView style={styles.grow}>
          <View style={styles.memberList}>
            {team.members.length === 0 && (
              <Empty
                title={t("workspace.team.dashboard.noMembers")}
                description={t("workspace.team.dashboard.noMembersHint")}
              />
            )}
            {team.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                captain={member.id === team.captainId}
                host={hostName(member.serverId)}
                connected={connected}
                onEdit={setEditingId}
                onOpen={onOpenMember}
              />
            ))}
          </View>
        </ScrollView>
      )}
      {view.tab === "activity" && (
        <ScrollView style={styles.grow}>
          <View style={styles.memberList}>
            <Text style={styles.meta}>{t("workspace.team.dashboard.snapshotHint")}</Text>
            {tasks.length === 0 && (
              <Empty
                title={t("workspace.team.dashboard.noTasks")}
                description={t("workspace.team.dashboard.noTasksHint")}
              />
            )}
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                memberName={memberName(task.memberId)}
                selected={false}
                onSelect={showTask}
              />
            ))}
          </View>
        </ScrollView>
      )}
      {view.tab === "tasks" && (
        <TaskBrowser
          tasks={tasks}
          team={team}
          memberName={memberName}
          hostName={hostName}
          view={view}
          onView={setView}
          connected={connected}
          pending={pending}
          onOpenMember={onOpenMember}
          onRefresh={onRefresh}
        />
      )}
      {editing && (
        <MemberEditor key={editing.id} member={editing} team={team} onClose={closeEditor} />
      )}
    </>
  );
}
interface MemberRowProps {
  member: TeamMember;
  captain: boolean;
  host: string;
  connected: boolean;
  onEdit(id: string): void;
  onOpen(member: TeamMember): void;
}
function MemberRow({ member, captain, host, connected, onEdit, onOpen }: MemberRowProps) {
  const { t } = useTranslation();
  const edit = useStableEvent(() => onEdit(member.id));
  const open = useStableEvent(() => onOpen(member));
  return (
    <View style={styles.memberRow} testID={`team-overview-member-${member.id}`}>
      <View style={styles.grow}>
        <View style={styles.inline}>
          <Text style={styles.title}>@{member.alias}</Text>
          {captain && <StatusBadge label="Captain" size="xs" />}
        </View>
        <Text style={styles.meta}>
          {member.provider} · {host}
        </Text>
        <Text style={styles.body}>{member.role || t("workspace.team.dashboard.noRole")}</Text>
        {member.skills.length > 0 && <Text style={styles.meta}>{member.skills.join(" · ")}</Text>}
      </View>
      <View style={styles.memberActions}>
        <Button variant="ghost" size="xs" disabled={!connected} onPress={edit}>
          {t("workspace.team.memberSettings")}
        </Button>
        <Button variant="ghost" size="xs" onPress={open}>
          {t("workspace.crossHost.sessions")}
        </Button>
      </View>
    </View>
  );
}
interface TaskRowProps {
  task: TeamTask;
  memberName: string;
  selected: boolean;
  onSelect(id: string): void;
}
function TaskRow({ task, memberName, selected, onSelect }: TaskRowProps) {
  const select = useStableEvent(() => onSelect(task.id));
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={select}
      style={[styles.taskRow, selected && styles.selected]}
      testID={`team-task-${task.id}`}
    >
      <View style={styles.inline}>
        <Text style={styles.meta}>@{memberName}</Text>
        <TaskStatus task={task} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {task.prompt}
      </Text>
      <Text style={styles.meta}>{new Date(task.updatedAt).toLocaleString()}</Text>
    </Pressable>
  );
}
interface TaskBrowserProps extends TeamContentProps {
  tasks: TeamTask[];
  memberName(id: string | null): string;
  hostName(id: string): string;
  view: TaskView;
  onView(value: TaskView): void;
}
function TaskBrowser({
  tasks,
  team,
  memberName,
  hostName,
  view,
  onView,
  ...actions
}: TaskBrowserProps) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const setSearch = useStableEvent((search: string) => onView({ ...view, search }));
  const setFilter = useStableEvent((filter: Filter) => onView({ ...view, filter }));
  const select = useStableEvent((selectedId: string) => onView({ ...view, selectedId }));
  const back = useStableEvent(() => onView({ ...view, selectedId: null }));
  const filters = useMemo(
    () =>
      (["all", "active", "attention", "completed"] as const).map((value) => ({
        value,
        label: t(`workspace.team.dashboard.${value}`),
        testID: `team-filter-${value}`,
      })),
    [t],
  );
  const visible = tasks.filter((task) => {
    const matchesStatus =
      view.filter === "all" ||
      (view.filter === "active" && ["sending", "running"].includes(task.status)) ||
      (view.filter === "attention" &&
        ["permission", "failed", "uncertain"].includes(task.status)) ||
      (view.filter === "completed" && task.status === "completed");
    return (
      matchesStatus &&
      `${task.prompt} ${memberName(task.memberId)} ${task.id}`
        .toLocaleLowerCase()
        .includes(view.search.trim().toLocaleLowerCase())
    );
  });
  const selected =
    visible.find((task) => task.id === view.selectedId) ?? (!compact ? visible[0] : undefined);
  const member = team.members.find((m) => m.id === selected?.memberId);
  return (
    <View style={[styles.taskLayout, compact && styles.compactLayout]}>
      {(!compact || !selected) && (
        <View style={[styles.list, compact && styles.compactList]}>
          <View style={styles.filters}>
            <FormTextInput
              size="sm"
              initialValue={view.search}
              onChangeText={setSearch}
              placeholder={t("workspace.team.dashboard.search")}
              testID="team-task-search"
            />
            <SegmentedControl
              options={filters}
              value={view.filter}
              onValueChange={setFilter}
              size="xs"
            />
          </View>
          <ScrollView style={styles.grow}>
            {visible.length === 0 && (
              <Empty
                title={t(
                  tasks.length
                    ? "workspace.team.dashboard.noMatches"
                    : "workspace.team.dashboard.noTasks",
                )}
                description={t(
                  tasks.length
                    ? "workspace.team.dashboard.noMatchesHint"
                    : "workspace.team.dashboard.noTasksHint",
                )}
              />
            )}
            {visible.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                memberName={memberName(task.memberId)}
                selected={selected?.id === task.id}
                onSelect={select}
              />
            ))}
          </ScrollView>
          <Text style={styles.historyHint}>{t("workspace.team.dashboard.historyHint")}</Text>
        </View>
      )}
      {selected && (
        <TaskDetail
          task={selected}
          member={member}
          sender={memberName(selected.senderId)}
          recipient={memberName(selected.memberId)}
          host={member ? hostName(member.serverId) : ""}
          compact={compact}
          onBack={back}
          {...actions}
        />
      )}
      {!selected && !compact && (
        <Empty
          title={t("workspace.team.dashboard.selectTask")}
          description={t("workspace.team.dashboard.selectTaskHint")}
        />
      )}
    </View>
  );
}
interface TaskDetailProps {
  task: TeamTask;
  member: TeamMember | undefined;
  sender: string;
  recipient: string;
  host: string;
  compact: boolean;
  onBack(): void;
  connected: boolean;
  pending: boolean;
  onOpenMember(member: TeamMember): void;
  onRefresh(task: TeamTask): Promise<void>;
}
function TaskDetail({
  task,
  member,
  sender,
  recipient,
  host,
  compact,
  onBack,
  connected,
  pending,
  onOpenMember,
  onRefresh,
}: TaskDetailProps) {
  const { t } = useTranslation();
  const open = useStableEvent(() => {
    if (member) onOpenMember(member);
  });
  const refresh = useStableEvent(() => {
    void onRefresh(task);
  });
  return (
    <ScrollView style={styles.grow} testID="team-task-detail">
      <View style={styles.detail}>
        {compact && (
          <Button variant="ghost" size="sm" onPress={onBack}>
            {t("workspace.team.dashboard.back")}
          </Button>
        )}
        <View style={styles.inline}>
          <TaskStatus task={task} />
          <Text style={styles.meta} selectable>
            {task.id.slice(0, 8)}
          </Text>
        </View>
        <Text style={styles.heading} numberOfLines={2}>
          {task.prompt.split("\n")[0]}
        </Text>
        <Text style={styles.meta}>
          {sender} → @{recipient} · {host}
        </Text>
        <View style={styles.inline}>
          {member && (
            <Button size="sm" variant="outline" onPress={open}>
              {t("workspace.crossHost.sessions")}
            </Button>
          )}
          {task.status === "uncertain" && (
            <Button size="sm" variant="outline" disabled={!connected || pending} onPress={refresh}>
              {t("workspace.team.checkTask")}
            </Button>
          )}
        </View>
        {task.status === "permission" && (
          <Text style={styles.hint}>{t("workspace.team.dashboard.permissionHint")}</Text>
        )}
        <View style={styles.section}>
          <Text style={styles.heading}>{t("workspace.team.dashboard.instructions")}</Text>
          <Text style={styles.body} selectable>
            {task.prompt}
          </Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>{t("workspace.team.dashboard.result")}</Text>
          <Text style={styles.body} selectable>
            {task.result || t("workspace.team.dashboard.noResult")}
          </Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.heading}>{t("workspace.team.dashboard.delivery")}</Text>
          <Text style={styles.meta}>
            {t(`workspace.team.dashboard.notification.${task.notification}`)}
          </Text>
          <Text style={styles.meta}>
            {t("workspace.team.dashboard.created")} · {new Date(task.createdAt).toLocaleString()}
          </Text>
          <Text style={styles.meta}>
            {t("workspace.team.dashboard.updated")} · {new Date(task.updatedAt).toLocaleString()}
          </Text>
          <Text style={styles.meta} selectable>
            {task.id}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: { padding: 0, flex: 1, minHeight: 0 },
  grow: { flex: 1, minWidth: 0, minHeight: 0 },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  summary: {
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  inline: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  taskLayout: { flex: 1, minHeight: 0, flexDirection: "row" },
  compactLayout: { flexDirection: "column" },
  list: {
    width: 320,
    backgroundColor: theme.colors.surfaceSidebar,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  compactList: { width: "100%", flex: 1, borderRightWidth: 0 },
  filters: { padding: theme.spacing[3], gap: theme.spacing[3] },
  taskRow: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  selected: { backgroundColor: theme.colors.interactionHighlight },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    lineHeight: 21,
  },
  heading: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    lineHeight: 22,
  },
  body: { fontSize: theme.fontSize.content, color: theme.colors.foreground, lineHeight: 24 },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, lineHeight: 18 },
  hint: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    lineHeight: 22,
    maxWidth: 360,
  },
  historyHint: {
    padding: theme.spacing[3],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  detail: { padding: theme.spacing[6], gap: theme.spacing[4] },
  section: {
    gap: theme.spacing[3],
    paddingTop: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  memberList: {
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[3],
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  memberActions: { gap: theme.spacing[2] },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusWarning,
    padding: theme.spacing[3],
  },
}));
