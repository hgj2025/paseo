# 工程地图

工程是 npm workspaces 的 TypeScript 单仓。当前本机路径为 `/Users/bytedance/code/github/paseo`；路径仅用于定位本机，不是其他设备的安装要求。

## 包边界

| 目录                              | 职责                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| `packages/app`                    | Expo / React Native 共享界面，供手机、Web 和 Electron 使用 |
| `packages/desktop`                | Electron 外壳、窗口、桌面集成及安装包                      |
| `packages/server`                 | Daemon、Agent 生命周期、历史、文件和终端服务               |
| `packages/client`                 | App 与 CLI 使用的 Daemon SDK                               |
| `packages/protocol`               | 消息 Schema、校验与共享模型                                |
| `packages/cli`                    | 命令行及 Daemon 管理                                       |
| `packages/relay`                  | 跨网络连接中继                                             |
| `packages/plugin`                 | 插件开发接口                                               |
| `plugins`                         | 内置扩展，含账号用量来源及 Provider                        |
| `plugin-examples`                 | 插件示例，含 checked-cli                                   |
| `packages/highlight`              | 代码高亮支持                                               |
| `packages/expo-two-way-audio`     | 原生双向音频模块                                           |
| `packages/website`、`public-docs` | 官网及用户文档                                             |
| `docs`、`scripts`                 | 内部文档及开发、构建辅助脚本                               |

## 请求方向

App → Client SDK → WebSocket（直连或中继）→ 对应 host 的 Daemon → Provider / CLI。

中继连通不等于目标 Daemon 在线；本机 SDK 请求成功也不能证明另一 host 的会话已经同步。排查需分别核对连接、目标 Agent、原生历史和 App 的订阅状态。

## 定制功能入口

以下路径均相对仓库根目录，部分源码仍在未提交工作区中，参见[部署与待办](deployment-status.md)。

| 功能               | 路径                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| 侧栏会话、状态灯   | `packages/app/src/components/sidebar/`                                              |
| 会话布局与分屏     | `packages/app/src/stores/conversation-layout.ts`、`workspace-layout-store.ts`       |
| host 连接与诊断    | `packages/app/src/runtime/`、`hosts/`、`connection-diagnostics/`                    |
| 时间线及长会话提示 | `packages/app/src/timeline/`、`agent-stream/`、`history-health/`                    |
| 文件抽屉           | `packages/app/src/file-explorer/`、`file-pane/`、`panels/files-panel.tsx`           |
| 批量及定期归档     | `packages/app/src/session-management/`                                              |
| 用量界面           | `packages/app/src/usage/`                                                           |
| Claude 用量采集    | `plugins/claude-usage-source/`                                                      |
| 外部历史监听       | `packages/server/src/server/agent/persisted-history-observer.ts`                    |
| 生命周期与历史替换 | `packages/server/src/server/agent/agent-manager.ts`                                 |
| Claude 历史解析    | `packages/server/src/server/agent/providers/claude/`                                |
| 跨 host 协作桥     | App 的 `runtime/collaboration-bridge.ts`、Server 的 `agent/collaboration-bridge.ts` |

文件名是导航入口，不代表对应改动已经发布。主题设计和限制应维护在原有主题文档，避免在交接文档复制一套实现说明。
