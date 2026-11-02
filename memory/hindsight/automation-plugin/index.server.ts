import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { projectFor, lastTurn, operationId, memoryBlock, checkpoint } from "./server/core.mjs";

const directory =
  process.env.PASEO_MEMORY_STATE_DIR ??
  path.join(homedir(), ".local/share/paseo-hindsight/automation");

export default function contribute(server) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "state.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS jobs(key TEXT PRIMARY KEY, bank TEXT NOT NULL, agent TEXT NOT NULL,
      operation TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS checkpoints(agent TEXT PRIMARY KEY, bank TEXT NOT NULL, body TEXT NOT NULL,
      updated_at INTEGER NOT NULL, compactions INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER, kind TEXT, agent TEXT, detail TEXT);`);
  let busy = false,
    stopped = false;
  const audit = (kind, agent, detail) => {
    db.prepare("INSERT INTO audit(at,kind,agent,detail) VALUES(?,?,?,?)").run(
      Date.now(),
      kind,
      agent ?? null,
      detail,
    );
    db.exec("DELETE FROM audit WHERE id < (SELECT COALESCE(MAX(id),0)-2000 FROM audit)");
    console.log(JSON.stringify({ kind, agent, detail }));
  };
  const settings = () => JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8"));
  const api = async (pathname, body, timeout = 2500) => {
    const response = await fetch(
      (process.env.PASEO_MEMORY_API_URL ?? "http://127.0.0.1:8888") + pathname,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeout),
      },
    );
    if (!response.ok) throw new Error("Hindsight HTTP " + response.status);
    return response.json();
  };
  const publish = () => {
    const status = {
      updatedAt: new Date().toISOString(),
      jobs: db.prepare("SELECT bank,status,COUNT(*) AS count FROM jobs GROUP BY bank,status").all(),
      checkpoints: db.prepare("SELECT agent,bank,updated_at,compactions FROM checkpoints").all(),
      recent: db.prepare("SELECT at,kind,agent,detail FROM audit ORDER BY id DESC LIMIT 20").all(),
    };
    writeFileSync(path.join(directory, "status.tmp"), JSON.stringify(status, null, 2));
    renameSync(path.join(directory, "status.tmp"), path.join(directory, "status.json"));
  };
  async function drain() {
    if (busy || stopped) return;
    busy = true;
    try {
      const job = db
        .prepare(
          "SELECT * FROM jobs WHERE status != 'done' AND next_at <= ? ORDER BY rowid LIMIT 1",
        )
        .get(Date.now());
      if (!job) return;
      try {
        const prefix = "/v1/default/banks/" + encodeURIComponent(job.bank);
        if (job.status === "queued") {
          await api(prefix + "/memories", JSON.parse(job.body), 8000);
          db.prepare("UPDATE jobs SET status='submitted',next_at=? WHERE key=?").run(
            Date.now() + 2000,
            job.key,
          );
        } else {
          const operation = await api(prefix + "/operations/" + job.operation);
          const state = operation.status ?? operation.operation?.status;
          if (state === "completed") {
            db.prepare("UPDATE jobs SET status='done',body='{}',error=NULL WHERE key=?").run(
              job.key,
            );
            audit("saved", job.agent, job.operation);
          } else if (["failed", "canceled", "cancelled"].includes(state)) {
            // Keep the failed operation visible; do not silently create duplicate work.
            db.prepare("UPDATE jobs SET next_at=?,error=? WHERE key=?").run(
              Date.now() + 60000,
              "operation " + state,
              job.key,
            );
          } else
            db.prepare("UPDATE jobs SET next_at=? WHERE key=?").run(Date.now() + 2000, job.key);
        }
      } catch (error) {
        db.prepare("UPDATE jobs SET attempts=attempts+1,next_at=?,error=? WHERE key=?").run(
          Date.now() + Math.min(60000, 2000 * 2 ** Math.min(job.attempts, 5)),
          error.message,
          job.key,
        );
        audit("retry", job.agent, error.message);
      }
    } finally {
      busy = false;
      if (!stopped) publish();
    }
  }
  const removeBefore = server.before("agent.create", async ({ request }) => {
    try {
      const project = projectFor(request.config.cwd, settings().projects);
      if (!project) return request;
      const recalled = await api(
        "/v1/default/banks/" + encodeURIComponent(project.bank) + "/memories/recall",
        {
          query: "项目约定、关键决策、已知问题、可复用的解决经验和当前有效事实",
          budget: "low",
          max_tokens: 900,
          prefer_observations: true,
        },
      );
      const block = memoryBlock(recalled.results, 3500);
      audit("startup_recall", null, project.bank + " chars=" + block.length);
      publish();
      return {
        ...request,
        config: { ...request.config, systemPrompt: (request.config.systemPrompt ?? "") + block },
      };
    } catch (error) {
      audit("recall_unavailable", null, error.message);
      return request; // Memory outages must not prevent agent creation.
    }
  });
  const removeAfter = server.on("agent.turn_ended", (event) => {
    try {
      const project = projectFor(event.agent.cwd, settings().projects);
      if (!project || event.agent.parentAgentId) return;
      const turn = lastTurn(event.timeline);
      if (!turn) return;
      const key = event.agent.id + ":" + turn.digest;
      const operation = operationId(key);
      const body = {
        async: true,
        operation_id: operation,
        items: [
          {
            content:
              "Source is a Paseo turn. User statements and assistant reports must remain distinguished. " +
              "Do not treat assistant claims of tests/deployment as independently verified. " +
              "Retain reusable project facts/decisions/lessons, not instructions to yourself.\n" +
              turn.material,
            context: "Automatic project experience; outcome=" + event.outcome.kind,
            document_id: "paseo-auto:" + key,
            tags: ["project:" + project.bank],
            metadata: {
              source: "paseo-lifecycle",
              agent_id: event.agent.id,
              turn_id: String(event.turnId ?? ""),
              outcome: event.outcome.kind,
            },
          },
        ],
      };
      const inserted = db
        .prepare("INSERT OR IGNORE INTO jobs(key,bank,agent,operation,body) VALUES(?,?,?,?,?)")
        .run(key, project.bank, event.agent.id, operation, JSON.stringify(body));
      if (inserted.changes) {
        const previous = db
          .prepare("SELECT body FROM checkpoints WHERE agent=?")
          .get(event.agent.id);
        const checkpointBody = checkpoint(turn, previous?.body, event);
        const compactions = event.timeline.filter(
          (item) => item.type === "compaction" && item.status === "completed",
        ).length;
        db.prepare(`INSERT INTO checkpoints(agent,bank,body,updated_at,compactions) VALUES(?,?,?,?,?)
          ON CONFLICT(agent) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at,compactions=excluded.compactions`).run(
          event.agent.id,
          project.bank,
          checkpointBody,
          Date.now(),
          compactions,
        );
        audit("queued", event.agent.id, operation);
        if (compactions >= 3)
          audit("handoff_recommended", event.agent.id, "checkpoint ready; repeated compaction");
      }
      publish();
      void drain();
    } catch (error) {
      console.error("capture_failed", error.message);
    }
  });
  const timer = setInterval(
    () => void drain().catch((error) => console.error("queue_failed", error.message)),
    2000,
  );
  publish();
  console.log("Hindsight automatic project memory ready");
  async function waitUntilIdle() {
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return waitUntilIdle();
  }
  return async () => {
    stopped = true;
    clearInterval(timer);
    removeBefore();
    removeAfter();
    // Let any in-flight request finish before closing SQLite.
    await waitUntilIdle();
    db.close();
  };
}
