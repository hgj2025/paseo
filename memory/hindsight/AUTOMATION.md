# Paseo 自动项目记忆 MVP

## 结论与范围

采用 Paseo 原生生命周期插件，不修改核心源码，不代理 WebSocket，不改模型执行器，不需要重启 daemon。运行版本实际提供 `before agent.create` 和 `agent.turn_ended`，插件支持热安装/禁用。

本次只准备对 `experience-project` 及其子目录开启，使用独立 bank `paseo-auto-mvp`。不回填历史，不采集其他项目，不采集子代理，不默认接入 devbox。安装启用尚待用户明确确认持续收集范围。

## 数据流

1. 新会话创建 → 根据真实 cwd 匹配项目白名单 → Hindsight 项目检索 → 将最多 3500 字符的证据内容及固定说明加入该会话 system prompt。2.5 秒超时或服务不可用时保持原始创建请求，记录失败，不阻止创建。
2. 轮次结束 → 从完整 timeline 中截取最新用户消息及最终助手文本；排除思考和原始工具输出 → 有限长度截断与基础密钥模式脱敏 → 写入本地 SQLite 队列和检查点。助手输出标为自报，不当作独立验证证据。
3. 后台队列 → 向 Hindsight 提交带稳定 operation ID 的异步 retain → 轮询操作完成 → 自动提炼事实、整合 observation。成功后清空本地队列正文，只保留去重元数据。
4. 进程重载后 → 继续处理 SQLite 中尚未完成的队列。相同事件重复送达不产生新任务。

存储：`~/.local/share/paseo-hindsight/automation/state.sqlite`；状态：同目录 `status.json`；模型处理：已安装的本机 Trae 适配服务，随后由 Trae 模型服务推理。基础脱敏不是完整 DLP，不能保证发现所有敏感信息。

## 大量会话与长会话

- 跨会话经验放在同一项目 bank；原始会话身份保留，避免每次启动加载整个聊天历史。
- 新上下文只装入有预算的检索结果；不会把逐条历史摘要无限追加进 system prompt。
- 检查点保存最近最多 8 轮、总计不超过 16000 字符，包含用户输入、助手最终报告、来源轮次和结果状态。它是近期恢复材料，不是已经验证无损的完整任务交接。
- 发现至少 3 条已完成压缩标记时，记录 `handoff_recommended`，提示检查点可用。本 MVP 不自动创建接班执行器、不切换会话、不发送 `/compact`。

记忆插件可以改善跨会话复用和恢复成本，但不会直接缩短已有模型上下文或消除侧栏会话数量。当前继续使用执行器原生压缩。

## 下一阶段：可靠的自动接班

需要以稳定的用户可见会话承载多个执行阶段：先生成包含当前目标、有效约束、任务状态、仓库版本与验证证据的交接快照；核对执行器空闲、审批、团队任务与回报；创建并校验新执行器；再按 revision 和历史游标原子更新执行绑定。失败保持旧绑定，可回滚。

Paseo 已有 `configure_execution` 和部分状态检查，可作为实现基础。当前插件事件无法提供原子的“只在仍空闲时切换”操作，也没有每条用户消息发送前钩子。要把新执行器启动、历史展示、摘要注入与原子切换完整做成自动流程，需要继续验证这些接口；必要时只补充通用生命周期接口和交接 API，不把 Hindsight 存储、模型调用和提炼规则写进核心。

## 验证与部署

隔离测试使用临时目录和 mock HTTP 服务，覆盖项目/符号链接隔离、只采集最新公开轮次、去重、预算限制、基础脱敏、启动注入、故障降级、队列重载恢复。不采集真实项目数据。

```sh
node --test memory/hindsight/automation-plugin/core.test.mjs memory/hindsight/automation-plugin/lifecycle.test.mjs
python3 memory/hindsight/install-automation.py \
  --project-root "$HOME/.local/share/paseo-hindsight/experience-project" \
  --bank paseo-auto-mvp
```

最后一条只显示计划。明确确认收集范围后，再用同一命令加 `--enable` 安装。需先创建对应 Hindsight bank 并开启 observations、auto consolidation 和 shared observation scope。

禁用后停止监听未来事件：`paseo plugin disable hindsight-project-memory`。已保存的本地队列与记忆保留，不自动删除。

注意生命周期事件是 best effort，没有自动回放。插件未启用期间或事件送达前 daemon 崩溃的轮次，当前不会自动补采；一旦写入本地 SQLite 的任务可恢复。这一界限不能表述成端到端 exactly-once。
