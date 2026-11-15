import { watch, type FSWatcher } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { TeamDirectorySchema, type TeamDirectory } from "@getpaseo/protocol/team-directory";

/** One file, one configured owner. Replicas cannot replace an owner's local file. */
export class TeamDirectoryStore {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private watcher: FSWatcher | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private fingerprint: string | undefined;
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.watcher) {
      this.watcher = watch(this.home, { persistent: false }, (_event, filename) => {
        if (filename && filename.toString() !== "team-directory.json") return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          void this.changed();
        }, 75);
        this.debounce.unref();
      });
      // Surface watcher loss as an invalidation; reconnect establishes a fresh watcher.
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = undefined;
        for (const notify of this.listeners) notify();
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size) return;
      this.watcher?.close();
      this.watcher = undefined;
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = undefined;
      this.fingerprint = undefined;
    };
  }
  private async changed() {
    try {
      const fingerprint = JSON.stringify(await this.read());
      if (!this.listeners.size || fingerprint === this.fingerprint) return;
      this.fingerprint = fingerprint;
      for (const notify of this.listeners) notify();
    } catch {
      /* Partial or invalid local edits never replace valid replicas. */
    }
  }
  constructor(
    private readonly home: string,
    private readonly serverId: string,
  ) {}
  async read(): Promise<TeamDirectory | null> {
    try {
      return TeamDirectorySchema.parse(
        JSON.parse(await readFile(join(this.home, "team-directory.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Invalid team-directory.json; fix the directory file before synchronizing.", {
        cause: error,
      });
    }
  }
  receive(input: unknown): Promise<TeamDirectory> {
    const snapshot = TeamDirectorySchema.parse(input);
    if (new Set(snapshot.members.map((m) => m.id)).size !== snapshot.members.length)
      return Promise.reject(new Error("Duplicate team member ID."));
    const operation = this.tail.then(() => this.persist(snapshot));
    this.tail = operation.catch(() => {});
    return operation;
  }
  private async persist(snapshot: TeamDirectory): Promise<TeamDirectory> {
    const current = await this.read();
    if (snapshot.ownerHostId === this.serverId || current?.ownerHostId === this.serverId)
      throw new Error(
        "Edit the owner's team-directory.json locally; replicas cannot overwrite it.",
      );
    if (current && current.ownerHostId !== snapshot.ownerHostId)
      throw new Error(
        "Team directory owner differs; remove the old replica locally before changing owners.",
      );
    if (current && snapshot.revision < current.revision) return current;
    if (current && snapshot.revision === current.revision) {
      if (JSON.stringify(current) !== JSON.stringify(snapshot))
        throw new Error("Directory changed without increasing revision.");
      return current;
    }
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const temporary = join(this.home, `.team-directory.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, join(this.home, "team-directory.json"));
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return snapshot;
  }
}
const stores = new Map<string, TeamDirectoryStore>();
export function getTeamDirectoryStore(home: string, serverId: string) {
  let store = stores.get(home);
  if (!store) {
    store = new TeamDirectoryStore(home, serverId);
    stores.set(home, store);
  }
  return store;
}
