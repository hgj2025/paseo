# 官方差异与 Antigravity ACP 接入

核对日期：2026-11-25。官方基线是 `7d425b2efedd303c868cc7f688fc46c46e100c54`；统计可能随后续提交变化。

## 整体合并评估

当前工程声明版本 0.11.2，官方声明版本 0.17.4。比较前的本地 HEAD 是 `6ffd0e047fdab8f50b3e5f6490b6c8b585612a8c`。

- 分叉基点：`e5124b039ab20755ac97ee207d03ca9903e5cfb7`（2026-10-15）。
- 官方独有提交 936 个；本地独有提交 31 个。
- 两端快照差异按 `git diff --no-renames --shortstat` 计 5444 个文件；包含翻译、图片、原生依赖及增删文件，不等于需要手工修改 5444 处。
- `git merge-tree --write-tree --name-only HEAD upstream/main` 模拟发现 82 个冲突文件。它只覆盖已提交内容，不包括本地未提交源码和未跟踪文件。
- 本次开始时的未提交 tracked 文件中，73 个也被官方修改；不代表每个必然文本冲突，但不能直接覆盖。

整体可以合并，但需要专门的迁移和验收。当前工作区不适合直接 merge 或 reset；本轮没有实际合并 main，也没有新建分支。

| 高影响区域                   | 需要保留及验证的定制行为                             |
| ---------------------------- | ---------------------------------------------------- |
| App 输入框、路由、布局、侧栏 | 跨 host 选模型、会话绑定、草稿升级、分屏和 host 切换 |
| 时间线与消息渲染             | home 外部历史对齐、工具终态、长会话及切换性能        |
| Server / Protocol / Client   | 自定义团队和协作桥、旧 App 与远端 daemon 的兼容      |
| Provider 与插件 SDK          | Claude/Codex/ACP 接口和生命周期，配置及权限          |
| Desktop / 原生依赖 / 构建    | 安装产物、启动环境、Android 和 Electron 回归         |

后续整体迁移应先把定制源码按功能整理成可复现提交并备份本地配置，再在用户同意的隔离环境中合并。分阶段解决依赖、服务端、客户端和 UI 冲突；以真实跨 host 工作流验收，不以编译通过代替发布验证。

## 本轮定向接入

采用官方内置 Provider 路线，不安装 lefos13 社区插件：

`antigravity` → `runAcpProvider` → `agy acp --disable-telemetry`。

移植官方 `68cfad2c8a482bc9fc8901d8bdd9d9395cc56f8e` 的迁移设计，并以本次官方基线补入通用 ACP 的长历史回放、后台工具终态、取消、模型思考选项和工具呈现实现及测试。

入口为 `plugins/antigravity-provider/server/provider.ts`。共享实现位于 `packages/plugin/src/server/acp.ts` 与 `acp-internal/`。技能分类新增可选 ProviderCommand.kind，并沿现有 server listCommands 映射传递。服务端模型映射同时采用官方逻辑：显式声明自身思考选项的模型不继承全局默认档位。没有整体替换消息协议或团队运行时。

保留本分支 ProviderRegistration 接口；官方新版的安装更新界面不在本轮移植范围。官方的账号 quota source 也不在本轮范围，不应把会话接入描述成已接入 agy 用量。

旧 stream-json persistence 的 conversationId 和带 effort 后缀模型选择按官方逻辑迁移。新连接使用 ACP 权限与历史，不再用旧 NDJSON 驱动。Full access 仍按官方默认启用；需要逐项批准时选择 Default。

## 验证证据及发布边界

- 本机 `agy --version` 为 1.5.17。
- 真实 ACP 初始化成功，未发送模型提示或执行工具。
- 真实 catalog 返回 11 个模型及各模型思考档位，包含无思考选项的 Orchestrator；权限目录返回 Default / Accept edits / Auto / Plan / Full access。
- 自动化测试使用协议 fake，不能证明真实模型生成、远程 host、全部 MCP 服务均已端到端验收。
- 开发源码构建与当前运行的 Daemon 是两回事。发布时核对实际 PASEO_HOME、命令覆盖、运行中任务；不要中断已有任务。
- 每个执行 agy 的 host 都需安装 CLI、完成该环境登录，并更新对应 Daemon。App 继续使用现有通用 Provider UI。

使用方式见 [支持的 Provider](../../public-docs/supported-providers.md#antigravity)。

## 本机安装验收（2026-11-25）

已定向更新实际运行目录的 SDK ACP 文件、内置 Antigravity Provider 及命令/模型映射，保留其他发布文件。备份位于本机 `$PASEO_HOME/backups/antigravity-acp-20261125`，未写入仓库。

确认本机 24 条未归档会话没有运行中任务后，通过现有 restartServer 接口重启。最终正式 Daemon 报告 Antigravity available，App 使用的 listProviderModels 接口返回 11 个模型；4 个没有思考选项的模型不再继承全局 High。

SDK 类型检查、内置插件类型检查、完整 server/CLI 构建通过。相关自动测试为 ACP 117、Antigravity 14、Provider runtime 40，共 171 项通过；另有 lint 和差异空白检查。尚未发送真实模型提示、调用真实工具或升级远端 host；这些不能据此描述为已验收。
