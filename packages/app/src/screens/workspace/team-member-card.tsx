import { useSessionStore } from "@/stores/session-store";
import { ModelHostDirectoryBrowser } from "./model-host-directory-browser";
import { useHostFeature } from "@/runtime/host-features";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  executionMember,
  TeamAliasSchema,
  TeamPathContextSchema,
  type TeamMember,
  type WorkspaceTeam,
} from "@getpaseo/protocol/workspace-team";
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
  const supportsPaths = useHostFeature(context.ownerServerId, "teamPathContext");
  const runner = executionMember(member);
  const workingDirectory = useSessionStore(
    (state) => state.sessions[runner.serverId]?.agents.get(runner.agentId)?.cwd,
  );
  const directoryAnchor = useRef<View>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const openDirectory = useStableEvent(() => setDirectoryOpen(true));
  const [model] = useState(() =>
    createStore(() => ({
      alias: member.alias,
      repository:
        member.pathContext?.repository ??
        workingDirectory?.replace(/\/$/, "").split("/").at(-1) ??
        "",
      root: member.pathContext?.root ?? workingDirectory ?? "",
      role: member.role,
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
    const pathContext =
      supportsPaths && (form.repository.trim() || form.root.trim())
        ? TeamPathContextSchema.safeParse({
            repository: form.repository.trim(),
            root: form.root.trim(),
          })
        : null;
    if (pathContext && (!pathContext.success || !/^(?:\/|[A-Za-z]:[\\/])/.test(form.root.trim()))) {
      model.setState({ error: t("teamPathContext.invalid") });
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
        skills: member.skills,
        captain: form.captain,
        ...(pathContext?.success ? { pathContext: pathContext.data } : {}),
      });
      onClose();
    } catch (error) {
      model.setState({ error: String(error), pending: false });
    }
  });
  const setAlias = useStableEvent((alias: string) => model.setState({ alias }));
  const setRole = useStableEvent((role: string) => model.setState({ role }));
  const setRepository = useStableEvent((repository: string) => model.setState({ repository }));
  const setRoot = useStableEvent((root: string) => model.setState({ root }));
  const selectDirectory = useStableEvent((root: string) => {
    model.setState({
      root,
      ...(form.repository
        ? {}
        : { repository: root.replace(/\/$/, "").split("/").at(-1) || "repository" }),
    });
    setDirectoryOpen(false);
  });
  const makeCaptain = useStableEvent(() => model.setState({ captain: true }));
  return (
    <View style={styles.editor} testID="team-member-editor">
      <Text style={styles.meta}>
        @{member.alias} · {member.provider}
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
      {supportsPaths ? (
        <>
          <Field label={t("teamPathContext.repository")}>
            <FormTextInput
              size="sm"
              initialValue={form.repository}
              onChangeText={setRepository}
              maxLength={120}
              testID="team-member-repository"
            />
          </Field>
          <Field label={t("teamPathContext.root")}>
            <FormTextInput
              size="sm"
              initialValue={form.root}
              onChangeText={setRoot}
              maxLength={4096}
              testID="team-member-root"
            />
          </Field>
          <View ref={directoryAnchor}>
            <Button size="sm" variant="ghost" onPress={openDirectory}>
              {t("teamPathContext.choose")}
            </Button>
          </View>
          {directoryOpen && (
            <ModelHostDirectoryBrowser
              serverId={executionMember(member).serverId}
              hostLabel={executionMember(member).serverId}
              initialDirectory={form.root || undefined}
              anchorRef={directoryAnchor}
              busy={form.pending}
              onSelect={selectDirectory}
              onOpenChange={setDirectoryOpen}
            />
          )}
          <Text style={styles.meta}>{t("teamPathContext.hint")}</Text>
        </>
      ) : (
        <Text style={styles.meta}>{t("teamPathContext.updateHost")}</Text>
      )}
      {!team.sessionId && member.serverId === context.ownerServerId && (
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
    </View>
  );
}

export function TeamMemberCard({
  member,
  iconOnly = false,
}: {
  member: TeamMember;
  iconOnly?: boolean;
}) {
  const context = useWorkspaceTeam()!;
  const { t } = useTranslation();
  const team = context.team!;
  const task = team.tasks.findLast((entry) => entry.memberId === member.id);
  return (
    <View style={styles.card} testID={`team-member-card-${member.agentId}`}>
      {!iconOnly && <Text style={styles.meta}>@{member.alias}</Text>}
      {task && task.status !== "completed" && (
        <Text style={styles.meta} numberOfLines={1}>
          {t(`workspace.team.status.${task.status}`)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  aliasButton: { maxWidth: 160, flexShrink: 1 },
  editor: { gap: theme.spacing[4], padding: theme.spacing[4] },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  meta: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
  error: { color: theme.colors.destructive, fontSize: 12 },
}));
