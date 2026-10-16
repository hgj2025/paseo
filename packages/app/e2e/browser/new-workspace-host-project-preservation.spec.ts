import { expect, test as base } from "../support/fixtures";
import { openProjectDirectoryWithHosts } from "../support/helpers/project-grouping";
import { projectPlacementViewKey } from "../support/helpers/project-view-key";
import {
  type IsolatedHostDaemon,
  startIsolatedHostDaemon,
} from "../support/helpers/isolated-host-daemon";
import {
  expectNewWorkspaceProjectSelected,
  openGlobalNewWorkspaceComposer,
  selectNewWorkspaceHost,
  selectNewWorkspaceProject,
} from "../support/helpers/new-workspace";
import { connectSeedClient, type SeedDaemonClient } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { addConnectedHostsAndReload } from "../support/helpers/hosts";
import { switchWorkspaceViaSidebar } from "../support/helpers/workspace-ui";
import { createTempGitRepo } from "../support/helpers/workspace";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const PRIMARY_HOST_LABEL = "Primary host";
const SECONDARY_HOST_LABEL = "Secondary host";
const SHARED_PROJECT_NAME = "Paseo";
const SHARED_REMOTE_URL = "https://github.com/getpaseo/paseo.git";

interface CreatedProject {
  projectId: string;
  projectKey: string;
  workspaceId: string;
}

interface CrossHostProjectScenario {
  contextWorkspaceId: string;
  primarySharedWorkspaceId: string;
  selectedProjectViewKey: string;
  sharedProjectKey: string;
  secondaryHost: {
    serverId: string;
    label: string;
    port: number;
  };
}

async function createProject(
  client: SeedDaemonClient,
  input: { projectPath: string; projectName: string; workspaceName: string },
): Promise<CreatedProject> {
  const created = await client.createWorkspace({
    source: { kind: "directory", path: input.projectPath },
    title: input.workspaceName,
  });
  if (!created.workspace) {
    throw new Error(created.error ?? `Failed to create project ${input.projectName}`);
  }

  await client.renameProject(created.workspace.projectId, input.projectName);
  const listed = await client.listProjects();
  const project = listed.projects.find(
    (candidate) => candidate.projectId === created.workspace?.projectId,
  );
  if (!project?.projectKey) {
    throw new Error(`Created project ${created.workspace.projectId} has no project key`);
  }

  return {
    projectId: created.workspace.projectId,
    projectKey: project.projectKey,
    workspaceId: created.workspace.id,
  };
}

async function openNewWorkspaceFromContextProject(
  page: Parameters<typeof openProjectDirectoryWithHosts>[0],
  scenario: CrossHostProjectScenario,
): Promise<void> {
  await openProjectDirectoryWithHosts(page, {
    hosts: [scenario.secondaryHost],
    primaryLabel: PRIMARY_HOST_LABEL,
  });
  await expect(
    page.getByTestId(`sidebar-project-row-${scenario.selectedProjectViewKey}`),
  ).toBeVisible();
  await switchWorkspaceViaSidebar({
    page,
    serverId: getServerId(),
    workspaceId: scenario.contextWorkspaceId,
  });
  await openGlobalNewWorkspaceComposer(page);
  await expectNewWorkspaceProjectSelected(page, "Context project");
}

const test = base.extend<{ crossHostProject: CrossHostProjectScenario }>({
  crossHostProject: async ({ page: _page }, provide) => {
    const secondaryDaemon: IsolatedHostDaemon = await startIsolatedHostDaemon(
      "new-workspace-project-preservation-secondary",
    );
    const contextRepo = await createTempGitRepo("new-workspace-context-");
    const primarySharedRepo = await createTempGitRepo("new-workspace-paseo-primary-", {
      originUrl: SHARED_REMOTE_URL,
    });
    const primaryDuplicateRepo = await createTempGitRepo("new-workspace-paseo-duplicate-", {
      originUrl: SHARED_REMOTE_URL,
    });
    const secondaryFallbackRepo = await createTempGitRepo("new-workspace-fallback-");
    const secondarySharedRepo = await createTempGitRepo("new-workspace-paseo-secondary-", {
      originUrl: SHARED_REMOTE_URL,
    });
    const primaryClient = await connectSeedClient();
    const secondaryClient = await connectSeedClient({ port: secondaryDaemon.port });
    const primaryProjects: CreatedProject[] = [];
    const secondaryProjects: CreatedProject[] = [];

    try {
      const contextProject = await createProject(primaryClient, {
        projectPath: contextRepo.path,
        projectName: "Context project",
        workspaceName: "Context workspace",
      });
      primaryProjects.push(contextProject);
      const primarySharedProject = await createProject(primaryClient, {
        projectPath: primarySharedRepo.path,
        projectName: SHARED_PROJECT_NAME,
        workspaceName: "Primary Paseo workspace",
      });
      primaryProjects.push(primarySharedProject);
      const primaryDuplicateProject = await createProject(primaryClient, {
        projectPath: primaryDuplicateRepo.path,
        projectName: "Paseo duplicate",
        workspaceName: "Duplicate Paseo workspace",
      });
      primaryProjects.push(primaryDuplicateProject);
      secondaryProjects.push(
        await createProject(secondaryClient, {
          projectPath: secondaryFallbackRepo.path,
          projectName: "Aardvark project",
          workspaceName: "Secondary fallback workspace",
        }),
      );
      const secondarySharedProject = await createProject(secondaryClient, {
        projectPath: secondarySharedRepo.path,
        projectName: SHARED_PROJECT_NAME,
        workspaceName: "Secondary Paseo workspace",
      });
      secondaryProjects.push(secondarySharedProject);

      if (
        primarySharedProject.projectKey !== primaryDuplicateProject.projectKey ||
        primarySharedProject.projectKey !== secondarySharedProject.projectKey
      ) {
        throw new Error("Expected the Paseo clones to have the same equivalence key");
      }

      await provide({
        contextWorkspaceId: contextProject.workspaceId,
        primarySharedWorkspaceId: primarySharedProject.workspaceId,
        selectedProjectViewKey: projectPlacementViewKey(
          getServerId(),
          primarySharedProject.projectId,
        ),
        sharedProjectKey: primarySharedProject.projectKey,
        secondaryHost: {
          serverId: secondaryDaemon.serverId,
          label: SECONDARY_HOST_LABEL,
          port: secondaryDaemon.port,
        },
      });
    } finally {
      for (const project of primaryProjects) {
        await primaryClient.removeProject(project.projectId).catch(() => undefined);
      }
      for (const project of secondaryProjects) {
        await secondaryClient.removeProject(project.projectId).catch(() => undefined);
      }
      await primaryClient.close().catch(() => undefined);
      await secondaryClient.close().catch(() => undefined);
      await contextRepo.cleanup().catch(() => undefined);
      await primarySharedRepo.cleanup().catch(() => undefined);
      await primaryDuplicateRepo.cleanup().catch(() => undefined);
      await secondaryFallbackRepo.cleanup().catch(() => undefined);
      await secondarySharedRepo.cleanup().catch(() => undefined);
      await secondaryDaemon.close().catch(() => undefined);
    }
  },
});

test.describe("New workspace host project preservation", () => {
  test.describe.configure({ timeout: 180_000 });

  test("cross-host split keeps messages, files, and restored sessions on their owning host", async ({
    page,
    crossHostProject,
  }, testInfo) => {
    page.setDefaultTimeout(15_000);
    const primary = await connectSeedClient();
    const secondary = await connectSeedClient({ port: crossHostProject.secondaryHost.port });
    const bridgeHome = await mkdtemp(join(tmpdir(), "cross-host-tools-"));
    try {
      const localWorkspace = (await primary.fetchWorkspaces()).entries.find(
        (w) => w.id === crossHostProject.contextWorkspaceId,
      )!;
      const remoteWorkspace = (await secondary.fetchWorkspaces()).entries.find(
        (w) => w.name === "Secondary Paseo workspace",
      )!;
      await writeFile(
        join(localWorkspace.workspaceDirectory, "scope-probe.txt"),
        "LOCAL_FILE_ONLY",
      );
      await writeFile(
        join(remoteWorkspace.workspaceDirectory, "scope-probe.txt"),
        "REMOTE_FILE_ONLY",
      );
      const local = await primary.createAgent({
        provider: "mock",
        cwd: localWorkspace.workspaceDirectory,
        workspaceId: localWorkspace.id,
        title: "Local coordinator",
        modeId: "load-test",
        model: "e2e-fast-stream",
        featureValues: { mockAssistantResponse: "LOCAL_ONLY_RESPONSE" },
      });
      const remote = await secondary.createAgent({
        provider: "mock",
        cwd: remoteWorkspace.workspaceDirectory,
        workspaceId: remoteWorkspace.id,
        title: "Remote collaborator",
        modeId: "load-test",
        model: "e2e-fast-stream",
        featureValues: { mockAssistantResponse: "REMOTE_ONLY_RESPONSE" },
      });
      await openProjectDirectoryWithHosts(page, {
        hosts: [crossHostProject.secondaryHost],
        primaryLabel: PRIMARY_HOST_LABEL,
      });
      await switchWorkspaceViaSidebar({
        page,
        serverId: getServerId(),
        workspaceId: localWorkspace.id,
      });
      await expect(
        page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true }),
      ).toHaveCount(1);
      await runWorkspaceActionFromCommandCenter(page, "Split pane right");
      await page
        .getByTestId("workspace-pane-choose-scope")
        .filter({ visible: true })
        .last()
        .click();
      await page
        .getByText("Secondary Paseo workspace", { exact: true })
        .filter({ visible: true })
        .last()
        .click();
      await expect(
        page.getByTestId("workspace-pane-scope-bar").filter({ visible: true }).last(),
      ).toContainText(SECONDARY_HOST_LABEL);
      await page
        .getByTestId("workspace-pane-choose-session")
        .filter({ visible: true })
        .last()
        .click();
      await page
        .getByText("Remote collaborator", { exact: true })
        .filter({ visible: true })
        .last()
        .click();
      const inputs = page
        .getByRole("textbox", { name: "Message agent..." })
        .filter({ visible: true });
      await expect(inputs).toHaveCount(2);
      await inputs.last().fill("Remote host routing probe");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .filter({ visible: true })
        .last()
        .click();
      await expect(page.getByText("REMOTE_ONLY_RESPONSE", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      expect(await primary.fetchAgent({ agentId: remote.id })).toBeNull();
      expect(await secondary.fetchAgent({ agentId: local.id })).toBeNull();
      await inputs.first().fill("Local host routing probe");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByText("LOCAL_ONLY_RESPONSE", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await page
        .getByTestId("workspace-pane-set-coordinator")
        .filter({ visible: true })
        .first()
        .click();
      await expect(
        page.getByTestId("workspace-pane-set-coordinator").filter({ visible: true }).first(),
      ).toHaveText("Coordinator");
      await page.getByTestId("workspace-pane-link-coordinator").filter({ visible: true }).click();
      await expect(
        page.getByText(new RegExp(`The user added this existing agent.*${remote.id}`)),
      ).toBeVisible();
      await primary.waitForFinish(local.id, 15_000);
      await writeFile(
        join(bridgeHome, "collaboration-hosts.json"),
        JSON.stringify({
          version: 1,
          hosts: [
            {
              id: crossHostProject.secondaryHost.serverId,
              label: SECONDARY_HOST_LABEL,
              command: [
                process.execPath,
                resolve(__dirname, "../../../cli/dist/index.js"),
                "--host",
                `127.0.0.1:${crossHostProject.secondaryHost.port}`,
              ],
            },
          ],
        }),
      );
      const { RemoteAgents } = await import(
        pathToFileURL(
          resolve(__dirname, "../../../server/dist/server/server/agent/remote-agents.js"),
        ).href
      );
      const bridge = new RemoteAgents(bridgeHome);
      const task = {
        callerId: local.id,
        hostId: crossHostProject.secondaryHost.serverId,
        agentId: remote.id,
        requestId: randomUUID(),
        prompt: "CLI cross-host delegation probe",
      };
      expect((await bridge.send(task)).state).toBe("acknowledged");
      expect(await bridge.wait(task.hostId, remote.id, 15)).toMatchObject({
        status: "idle",
        message: expect.stringContaining("REMOTE_ONLY_RESPONSE"),
      });
      expect((await bridge.send(task)).state).toBe("acknowledged");
      await expect(page.getByText("CLI cross-host delegation probe", { exact: true })).toHaveCount(
        1,
      );
      await addConnectedHostsAndReload(page, [crossHostProject.secondaryHost], {
        primaryLabel: PRIMARY_HOST_LABEL,
      });
      await expect(page.getByText("REMOTE_ONLY_RESPONSE", { exact: true }).last()).toBeVisible();
      await expect(page.getByText("LOCAL_ONLY_RESPONSE", { exact: true }).last()).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("cross-host-agents.png") });
      await page.getByTestId("workspace-new-tab-button").filter({ visible: true }).last().click();
      await page.getByTestId("workspace-new-tab-menu-files").click();
      await page.getByText("scope-probe.txt", { exact: true }).filter({ visible: true }).click();
      await expect(page.getByText("REMOTE_FILE_ONLY", { exact: true })).toBeVisible();
      await expect(page.getByText("LOCAL_FILE_ONLY", { exact: true })).toHaveCount(0);
      await page.getByTestId("workspace-new-tab-button").filter({ visible: true }).last().click();
      await page.getByTestId("workspace-new-tab-menu-terminal").click();
      await expect
        .poll(
          async () =>
            (
              await secondary.listTerminals(undefined, undefined, {
                workspaceId: remoteWorkspace.id,
              })
            ).terminals.length,
        )
        .toBe(1);
      expect((await primary.listTerminals()).terminals).toHaveLength(0);
      const terminals = (await secondary.listTerminals()).terminals;
      expect(terminals[0]?.cwd).toBe(remoteWorkspace.workspaceDirectory);
      await page.getByTestId("workspace-new-tab-button").filter({ visible: true }).last().click();
      await page.getByTestId("workspace-new-tab-menu-agent").click();
      const draft = page
        .getByRole("textbox", { name: "Message agent..." })
        .filter({ visible: true })
        .last();
      await draft.fill("Create this agent on the remote host");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .filter({ visible: true })
        .last()
        .click();
      await expect.poll(async () => (await secondary.fetchAgents()).entries.length).toBe(2);
      const created = (await secondary.fetchAgents()).entries.find(
        (entry) => entry.agent.id !== remote.id,
      )!.agent;
      expect(created.workspaceId).toBe(remoteWorkspace.id);
      expect(created.cwd).toBe(remoteWorkspace.workspaceDirectory);
      expect((await primary.fetchAgents()).entries).toHaveLength(1);
      await expect(
        page.getByTestId("workspace-pane-scope-bar").filter({ visible: true }).last(),
      ).toContainText(SECONDARY_HOST_LABEL);
    } finally {
      await primary.close();
      await secondary.close();
      await rm(bridgeHome, { recursive: true, force: true });
    }
  });

  test("keeps the equivalent project selected when one host has another clone", async ({
    page,
    crossHostProject,
  }) => {
    await openNewWorkspaceFromContextProject(page, crossHostProject);
    await selectNewWorkspaceProject(page, {
      projectKey: crossHostProject.sharedProjectKey,
      projectViewKey: crossHostProject.selectedProjectViewKey,
      projectDisplayName: SHARED_PROJECT_NAME,
    });
    await selectNewWorkspaceHost(page, SECONDARY_HOST_LABEL);

    await expectNewWorkspaceProjectSelected(page, SHARED_PROJECT_NAME);
  });

  test("keeps the active workspace project selected when switching hosts", async ({
    page,
    crossHostProject,
  }) => {
    await openProjectDirectoryWithHosts(page, {
      hosts: [crossHostProject.secondaryHost],
      primaryLabel: PRIMARY_HOST_LABEL,
    });
    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: crossHostProject.primarySharedWorkspaceId,
    });
    await openGlobalNewWorkspaceComposer(page);
    await expectNewWorkspaceProjectSelected(page, SHARED_PROJECT_NAME);

    await selectNewWorkspaceHost(page, SECONDARY_HOST_LABEL);

    await expectNewWorkspaceProjectSelected(page, SHARED_PROJECT_NAME);

    await addConnectedHostsAndReload(page, [crossHostProject.secondaryHost], {
      primaryLabel: PRIMARY_HOST_LABEL,
    });
    await expectNewWorkspaceProjectSelected(page, SHARED_PROJECT_NAME);
    await selectNewWorkspaceHost(page, SECONDARY_HOST_LABEL);

    await expectNewWorkspaceProjectSelected(page, SHARED_PROJECT_NAME);
  });
});
