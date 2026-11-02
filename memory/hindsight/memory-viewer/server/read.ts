import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const base = "http://127.0.0.1:8888/v1/default/banks";
export async function readMemory(input) {
  const get = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok)
      throw new Error(`记忆服务返回 ${response.status}，请检查 Hindsight 是否运行。`);
    return response.json();
  };
  if (input.action === "banks") {
    let automation = { enabled: false, note: "未配置自动采集；当前页面仅查看已有记忆。" };
    const folder = path.join(homedir(), ".local/share/paseo-hindsight/automation");
    try {
      const status = JSON.parse(await readFile(path.join(folder, "status.json"), "utf8"));
      automation = {
        enabled: null,
        note: "以下为自动化插件最后写入的状态，不代表当前运行状态。",
        updatedAt: status.updatedAt,
        jobs: status.jobs,
      };
    } catch (error) {
      if (error.code !== "ENOENT") automation.note = "自动化状态暂时不可读。";
    }
    return {
      data: await get(
        base +
          "?" +
          new URLSearchParams({
            limit: "100",
            offset: String(input.offset ?? 0),
            ...(input.query ? { q: input.query } : {}),
          }),
      ),
      automation,
    };
  }
  if (!input.bank) throw new Error("请选择项目记忆库。");
  const prefix = base + "/" + encodeURIComponent(input.bank);
  if (input.action === "detail") {
    if (!input.id) throw new Error("请选择一条记忆。");
    return { data: await get(prefix + "/memories/" + encodeURIComponent(input.id)) };
  }
  const params = new URLSearchParams({ limit: "30", offset: String(input.offset ?? 0) });
  if (input.query) params.set("q", input.query);
  if (input.type) params.set("type", input.type);
  const [items, stats] = await Promise.all([
    get(prefix + "/memories/list?" + params),
    get(prefix + "/stats"),
  ]);
  return { data: { ...items, stats } };
}
