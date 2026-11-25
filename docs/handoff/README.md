# Paseo 工程交接

核对日期：2026-11-25。本文是此定制工作区的接手入口；功能细节以链接到的主题文档和源码为准。

## 阅读顺序

1. [工程地图](repository-map.md)：定位包和功能入口。
2. [开发与验证](development.md)：隔离开发环境、构建与测试。
3. [部署与待办](deployment-status.md)：区分源码、安装产物和各 host 状态。
4. 阅读仓库根目录 [AGENTS.md](../../AGENTS.md)、[CLAUDE.md](../../CLAUDE.md) 的当前开发约束。

## 文档导航

| 主题           | 文档                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| 架构与模型     | [架构](../architecture.md)、[数据模型](../data-model.md)                                                           |
| Agent 与消息   | [生命周期](../agent-lifecycle.md)、[时间线同步](../timeline-sync.md)                                               |
| 跨 host 与团队 | [分屏与执行绑定](../cross-host-panes.md)、[权限](../permissions.md)                                                |
| 会话管理       | [归档和定期清理](../session-management.md)                                                                         |
| 扩展           | [插件](../plugins.md)、[Provider](../providers.md)、[自定义 Provider](../custom-providers.md)                      |
| 前端           | [设计](../design.md)、[路由](../expo-router.md)、[文件抽屉](../explorer-sidebar.md)                                |
| 性能           | [消息渲染](../agent-stream-performance.md)、[文件监听](../file-observation.md)、[终端](../terminal-performance.md) |
| 验证与发布     | [测试](../testing.md)、[QA](../qa.md)、[发布](../release.md)、[Android](../android.md)                             |

## 工作区交付边界

本轮开始时所在分支为 `codex/privacy-hardening`，HEAD 为 `50a8b59a58eb0626d0dbdeafa7a686924cc4158a`。远端 origin 是 `hgj2025/paseo`，upstream 是 `getpaseo/paseo`。

当时有 204 项 Git 状态记录，其中 106 项为未跟踪条目；目录条目可包含多个文件。这是一次性盘点，不是提交后的实时计数。交接文档提交不包含全部工作区源码。接手前必须重新运行 `git status --short` 和 `git diff --stat`，不能认为拉取远端就拥有本机所有功能。

本地构建目录、测试附件和运行配置不要批量提交。交接源码时另行按功能核对依赖、测试和敏感内容。不要执行 `git add .` 将整个工作区混入提交。
