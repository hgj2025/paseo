import { useStableEvent } from "@/hooks/use-stable-event";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  TeamAliasSchema,
  type TeamMember,
  type TeamTask,
  type WorkspaceTeam,
} from "@getpaseo/protocol/workspace-team";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useWorkspaceTeam } from "./workspace-team-context";

export function MemberEditor({
  member,
  team,
  onClose,
}: {
  member: TeamMember;
  team: WorkspaceTeam;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const context = useWorkspaceTeam()!;
  const [model] = useState(() =>
    createStore(() => ({
      alias: member.alias,
      role: member.role,
      skills: member.skills.join(", "),
      captain: team.captainId === member.id,
      pending: false,
      error: "",
    })),
  );
  const form = useStore(model);
  const save = useStableEvent(async () => {
    if (form.pending) return;
    if (!TeamAliasSchema.safeParse(form.alias.trim()).success) {
      model.setState({ error: t("workspace.team.invalidName") });
      return;
    }
    model.setState({ pending: true, error: "" });
    try {
      await context.execute({
        kind: "edit",
        memberId: member.id,
        revision: team.revision,
        alias: form.alias.trim(),
        role: form.role.trim(),
        skills: form.skills
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        captain: form.captain,
      });
      onClose();
    } catch (error) {
      model.setState({ error: String(error), pending: false });
    }
  });
  const setAlias = useStableEvent((alias: string) => model.setState({ alias }));
  const setRole = useStableEvent((role: string) => model.setState({ role }));
  const setSkills = useStableEvent((skills: string) => model.setState({ skills }));
  const makeCaptain = useStableEvent(() => model.setState({ captain: true }));
  const setError = useStableEvent((error: string) => model.setState({ error }));
  const header = useMemo(() => ({ title: t("workspace.team.memberSettings") }), [t]);
  return (
    <AdaptiveModalSheet visible onClose={onClose} header={header} testID="team-member-editor">
      <View style={styles.editor}>
        <Text style={styles.meta}>
          {member.provider} · {member.serverId}
        </Text>
        <Field label={t("workspace.team.name")}>
          <FormTextInput
            size="sm"
            initialValue={member.alias}
            onChangeText={setAlias}
            maxLength={32}
            testID="team-member-name"
          />
        </Field>
        <Field label={t("workspace.team.role")}>
          <FormTextInput
            size="sm"
            initialValue={member.role}
            onChangeText={setRole}
            multiline
            maxLength={1000}
            testID="team-member-role"
          />
        </Field>
        <Field label={t("workspace.team.skills")}>
          <FormTextInput
            size="sm"
            initialValue={member.skills.join(", ")}
            onChangeText={setSkills}
            testID="team-member-skills"
          />
        </Field>
        {member.serverId === context.ownerServerId && (
          <Button variant={form.captain ? "secondary" : "ghost"} size="sm" onPress={makeCaptain}>
            {form.captain ? "Captain" : t("workspace.team.makeCaptain")}
          </Button>
        )}
        {form.error ? <Text style={styles.error}>{form.error}</Text> : null}
        <View style={styles.actions}>
          <Button size="sm" variant="ghost" onPress={onClose}>
            {t("common.actions.cancel")}
          </Button>
          <Button size="sm" disabled={form.pending} onPress={save} testID="team-member-save">
            {t("common.actions.save")}
          </Button>
        </View>
        <Text style={styles.section}>{t("workspace.team.members")}</Text>
        {team.members.map((entry) => (
          <View key={entry.id} style={styles.member}>
            <Text style={styles.name}>
              @{entry.alias}
              {team.captainId === entry.id ? " · Captain" : ""}
            </Text>
            <Text style={styles.meta}>
              {entry.role || entry.provider}
              {entry.skills.length ? ` · ${entry.skills.join(" / ")}` : ""}
            </Text>
          </View>
        ))}
        {(context.team ?? team).tasks
          .filter((task) => task.memberId === member.id)
          .slice(-5)
          .toReversed()
          .map((task) => (
            <TaskResult key={task.id} task={task} onError={setError} />
          ))}
      </View>
    </AdaptiveModalSheet>
  );
}

function TaskResult({ task, onError }: { task: TeamTask; onError(error: string): void }) {
  const { t } = useTranslation();
  const context = useWorkspaceTeam()!;
  const refresh = useStableEvent(() => {
    void context
      .execute({ kind: "refresh", taskId: task.id })
      .catch((error) => onError(String(error)));
  });
  return (
    <View style={styles.member}>
      <Text style={styles.name}>{t(`workspace.team.status.${task.status}`)}</Text>
      <Text style={styles.meta} numberOfLines={3}>
        {task.prompt}
      </Text>
      <Text style={styles.meta} selectable>
        {task.result}
      </Text>
      {task.status === "uncertain" && (
        <Button size="xs" variant="ghost" onPress={refresh}>
          {t("workspace.team.checkTask")}
        </Button>
      )}
    </View>
  );
}

export function TeamMemberCard({ member }: { member: TeamMember }) {
  const context = useWorkspaceTeam()!;
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ member: TeamMember; team: WorkspaceTeam } | null>(null);
  const team = context.team!;
  const task = team.tasks.findLast((entry) => entry.memberId === member.id);
  const openEditor = useStableEvent(() => setEditing({ member, team }));
  const closeEditor = useStableEvent(() => setEditing(null));
  return (
    <View style={styles.card} testID={`team-member-card-${member.agentId}`}>
      <Button
        variant="ghost"
        size="xs"
        onPress={openEditor}
        testID="team-member-configure"
        style={styles.aliasButton}
        accessibilityLabel={`@${member.alias}`}
      >
        <Text numberOfLines={1}>@{member.alias}</Text>
      </Button>
      {task && (
        <Text style={styles.meta} numberOfLines={1}>
          {t(`workspace.team.status.${task.status}`)}
        </Text>
      )}
      {editing && <MemberEditor key={editing.member.id} {...editing} onClose={closeEditor} />}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  aliasButton: { maxWidth: 160, flexShrink: 1 },
  editor: { gap: 16, paddingBottom: 16 },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  member: { gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.border },
  name: { color: theme.colors.foreground, fontSize: 13 },
  section: { color: theme.colors.foreground, fontWeight: "600", fontSize: 13 },
  meta: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
  error: { color: theme.colors.destructive, fontSize: 12 },
}));
