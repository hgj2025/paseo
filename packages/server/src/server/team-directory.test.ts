import { rename, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TeamDirectoryStore } from "./team-directory.js";

const homes: string[] = [];
const directory = {
  ownerHostId: "owner",
  revision: 1,
  members: [{ id: "mac", name: "Home", hostId: "home", role: "member", skills: [] }],
};
async function fixture(serverId = "replica") {
  const home = await mkdtemp(join(tmpdir(), "paseo-directory-"));
  homes.push(home);
  return { home, store: new TeamDirectoryStore(home, serverId) };
}
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
describe("session-free shared member directory", () => {
  it("observes creation and atomic rename saves without polling, debounces and releases listeners", async () => {
    const { home, store } = await fixture();
    let changes = 0;
    const release = store.subscribe(() => {
      changes++;
    });
    try {
      await writeFile(join(home, "team-directory.json"), JSON.stringify(directory));
      await expect.poll(() => changes).toBe(1);
      await writeFile(join(home, "team-directory.json"), JSON.stringify(directory, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(changes).toBe(1);
      await writeFile(join(home, "replacement.tmp"), JSON.stringify({ ...directory, revision: 2 }));
      await rename(join(home, "replacement.tmp"), join(home, "team-directory.json"));
      await expect.poll(() => changes).toBe(2);
    } finally {
      release();
    }
    await writeFile(
      join(home, "team-directory.json"),
      JSON.stringify({ ...directory, revision: 3 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(changes).toBe(2);
  });
  it("stores private snapshots, survives restart and does not treat missing files as a team", async () => {
    const { home, store } = await fixture();
    expect(await store.read()).toBeNull();
    await store.receive(directory);
    expect(await new TeamDirectoryStore(home, "replica").read()).toEqual(directory);
    expect((await stat(join(home, "team-directory.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(home, "team-directory.json"), "utf8")).not.toMatch(
      /agentId|workspaceId|sessionId|tasks/,
    );
  });
  it("rejects session fields instead of persisting or silently stripping them", async () => {
    const { store } = await fixture();
    for (const key of ["agentId", "sessionId", "workspaceId", "tasks", "messages"]) {
      expect(() => store.receive({ ...directory, [key]: "secret" })).toThrow();
      expect(() =>
        store.receive({ ...directory, members: [{ ...directory.members[0], [key]: "secret" }] }),
      ).toThrow();
    }
    expect(await store.read()).toBeNull();
  });
  it("rejects duplicate IDs, conflicting owners and same-version edits; ignores old revisions", async () => {
    const { store } = await fixture();
    await expect(
      store.receive({ ...directory, members: [directory.members[0], directory.members[0]] }),
    ).rejects.toThrow("Duplicate");
    await store.receive(directory);
    await expect(
      store.receive({ ...directory, ownerHostId: "other", revision: 3 }),
    ).rejects.toThrow("owner differs");
    await expect(store.receive({ ...directory, members: [] })).rejects.toThrow("revision");
    expect(await store.receive({ ...directory, revision: 0 })).toEqual(directory);
    expect(await store.receive(directory)).toEqual(directory);
    await store.receive({ ...directory, revision: 2, members: [] });
    expect((await store.read())?.members).toEqual([]);
  });
  it("serializes concurrent updates and never overwrites an owner's local file", async () => {
    const { store } = await fixture();
    await Promise.all([store.receive({ ...directory, revision: 3 }), store.receive(directory)]);
    expect((await store.read())?.revision).toBe(3);
    const owner = await fixture("owner");
    await writeFile(join(owner.home, "team-directory.json"), JSON.stringify(directory));
    await expect(owner.store.receive({ ...directory, revision: 4 })).rejects.toThrow("locally");
    expect(await owner.store.read()).toEqual(directory);
  });
  it("does not replace a malformed file with an incoming snapshot", async () => {
    const { home, store } = await fixture();
    await writeFile(join(home, "team-directory.json"), "invalid");
    await expect(store.receive(directory)).rejects.toThrow("Invalid");
    expect(await readFile(join(home, "team-directory.json"), "utf8")).toBe("invalid");
  });
});
