# 开发与验证

完整设置以 [development.md](../development.md) 为准；Node 版本查看根目录 `.tool-versions`。

## 启动

在仓库根目录安装依赖，分别在终端运行所需服务：

```bash
npm ci
npm run dev:server
npm run dev:app
npm run dev:desktop
```

`npm run dev` 只启动开发 Daemon，不会同时启动全部界面。

| 环境         | 默认位置                                             |
| ------------ | ---------------------------------------------------- |
| 开发 Daemon  | `127.0.0.1:6768`，当前 checkout 的 `.dev/paseo-home` |
| 开发 Web     | `localhost:8081`                                     |
| 桌面开发前端 | `8082` 至 `8089` 中第一个可用端口                    |
| 正式 Daemon  | 默认端口 `6767`、数据目录 `~/.paseo`                 |

仓库的 `npm run cli -- ...` 默认连接开发数据目录。排查正式环境前先确认实际 endpoint 和 PASEO_HOME；不要把开发环境结果当正式结果。

## 构建和检查

```bash
npm run build:server
npm run build:app-deps
npm run typecheck --workspace=@getpaseo/app
npm run test --workspace=@getpaseo/app -- <测试文件>
npm run lint -- <修改文件>
npm run format:files -- <修改文件>
npm run build:desktop
```

这些命令从仓库根目录执行。按修改范围选择测试；不要为文档改动跑完整功能测试。Server、Client 或 Protocol 类型过期时，先构建依赖声明，避免用临时类型断言掩盖旧产物。

修改 Protocol 前阅读[兼容规则](../protocol-compatibility.md)、[RPC 命名](../rpc-namespacing.md)及[校验生成](../protocol-validation.md)。客户端与各 host 可能版本不同，新功能需要能力判断。

## 排障证据

- 记录 App 入口、host、会话 ID、时间和构建版本。
- 区分连接断开、Agent 状态错误、历史缺失和界面渲染停顿。
- Daemon 日志位于实际 `$PASEO_HOME/daemon.log`；分享前裁剪并去除凭据和用户内容。
- 原生 Claude / Codex 历史和 Paseo 时间线是不同数据源；只读核对后再决定是否需要重建视图。
- 避免为了诊断重放历史工具调用或向用户会话发送测试消息。

## 交付前

检查 Git 差异、执行相关测试，记录检查的范围与失败。源码提交成功、构建成功、安装成功、界面验收成功是四个不同结论，应分别报告。
