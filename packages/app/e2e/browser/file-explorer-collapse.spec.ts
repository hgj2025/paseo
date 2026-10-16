import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import {
  collapseFolder,
  expandFolder,
  expectExplorerEntryHidden,
  expectExplorerEntryVisible,
  expectFileTabOpen,
  openFileExplorer,
  openFileFromExplorer,
} from "../support/helpers/file-explorer";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

let workspace: SeededWorkspace;

test.beforeAll(async () => {
  workspace = await seedWorkspace({
    repoPrefix: "file-explorer-collapse-",
    repo: {
      files: [
        { path: "assets/logo.png", content: "image bytes for explorer e2e\n" },
        { path: "docs/guide.md", content: "# Guide\n" },
      ],
    },
  });
  for (const [name, branch] of [
    ["mock_platform", "fix/consul_bug"],
    ["ip", "feature/cards"],
  ] as const) {
    const cwd = path.join(workspace.repoPath, name);
    await mkdir(cwd);
    execFileSync("git", ["init", "-b", branch], { cwd, stdio: "ignore" });
  }
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("File explorer collapse", () => {
  test("shows branches on repository roots and updates them on refresh", async ({
    page,
  }, testInfo) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);
    const tree = page.getByTestId("file-explorer-tree-scroll");
    await expect(tree.getByText("fix/consul_bug", { exact: true })).toBeVisible();
    await expect(tree.getByText("feature/cards", { exact: true })).toBeVisible();
    await expandFolder(page, "docs");
    await expectExplorerEntryVisible(page, "guide.md");
    await expect(tree.locator('[data-testid$="-branch"]')).toHaveCount(2);
    execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/codex/venv-owner-cards-20261016"], {
      cwd: path.join(workspace.repoPath, "mock_platform"),
    });
    await page.getByTestId("files-refresh").click();
    const branch = tree.getByText("codex/venv-owner-cards-20261016", { exact: true });
    await expect(branch).toBeVisible();
    await expect(tree.getByText("fix/consul_bug", { exact: true })).toHaveCount(0);
    await branch.hover();
    await expect(page.getByText("codex/venv-owner-cards-20261016", { exact: true })).toHaveCount(2);
    const treeBounds = await tree.boundingBox();
    const lastRow = await tree.getByText("README.md", { exact: true }).boundingBox();
    expect(treeBounds).not.toBeNull();
    expect(lastRow).not.toBeNull();
    await page.screenshot({
      path: testInfo.outputPath("repository-branches.png"),
      clip: {
        x: treeBounds!.x,
        y: 0,
        width: treeBounds!.width,
        height: lastRow!.y + lastRow!.height + 32,
      },
    });
    await collapseFolder(page, "docs");
  });

  test("collapses an opened image file parent folder and still expands other folders", async ({
    page,
  }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);

    await expandFolder(page, "assets");
    await expectExplorerEntryVisible(page, "logo.png");

    await openFileFromExplorer(page, "logo.png");
    await expectFileTabOpen(page, "assets/logo.png");

    await collapseFolder(page, "assets");
    await expectExplorerEntryHidden(page, "logo.png");

    await expandFolder(page, "docs");
    await expectExplorerEntryVisible(page, "guide.md");
  });
});
