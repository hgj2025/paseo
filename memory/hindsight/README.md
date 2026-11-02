# Hindsight memory integration

统一维护 Paseo 的 Hindsight 记忆能力：

| 目录/文件                                   | 职责                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `compose.yaml`                              | 官方 Hindsight 1.1.0 ARM64 镜像，固定 digest；本机 PostgreSQL 和 embedding |
| `trae-bridge.py`                            | 本机 Trae CLI 的非流式 Chat Completions 适配服务                           |
| `configure.py`、`install-bridge-service.py` | 私有配置初始化及 macOS 登录服务                                            |
| `memory-viewer/`                            | Paseo 侧栏「项目记忆」只读页面                                             |
| `automation-plugin/`                        | 原生生命周期插件：自动保存、启动召回、持久队列与检查点                     |
| `install-automation.py`                     | 展示限定项目的启用计划；只有 `--enable` 才安装                             |
| `paseo-demo.mjs`                            | 创建和验收两个共用项目记忆的 Paseo 会话                                    |

## 安装与运行

要求：macOS Apple Silicon、Node 24、Docker/OrbStack、Paseo CLI，以及已登录的 `traecli`。以下命令在 Paseo 仓库根目录执行：

```sh
python3 memory/hindsight/configure.py
python3 memory/hindsight/install-bridge-service.py
docker compose -f memory/hindsight/compose.yaml up -d
```

配置位于 `~/.local/share/paseo-hindsight/`，不会覆盖现有配置。模型默认 `GPT-5.5`；按实际 Trae 模型目录调整配置和环境文件。模型推理经 Trae 服务处理，本地存储不代表完全本地推理。CLI 每次调用有额外上下文、token 与延迟开销；适配器不是完整的 OpenAI API 实现。

- 管理面板：<http://127.0.0.1:9999>
- 健康检查：<http://127.0.0.1:8888/health>
- PostgreSQL：Docker volume `paseo-hindsight-data`
- 模型缓存：Docker volume `paseo-hindsight-model-cache`
- Trae 适配器：`127.0.0.1:18889`，使用生成的本机 bearer key

`host.docker.internal` 访问本机回环服务已在 OrbStack 验证；其他 Docker 实现需另行确认，不应直接把适配器暴露到公网。首次启动会下载多语言 embedding 模型。

## Paseo 页面

```sh
paseo plugin install "$PWD/memory/hindsight/memory-viewer"
```

需要 Paseo 设置中的「Enable plugins」开关。该开关会启用所有已配置且未禁用的插件，修改前应检查列表。页面只有读取能力，没有自动采集或模型调用。详见 [查看器说明](memory-viewer/README.md)。

插件修改后：`paseo plugin reload hindsight-memory-viewer`。插件直接指向本仓库目录时，无需维护第二份源码。

## 自动化 MVP

详见 [方案与边界](AUTOMATION.md)。自动化插件尚未启用；安装查看器不代表同意采集。明确确认项目范围与处理去向后才执行启用步骤。

```sh
python3 memory/hindsight/install-automation.py --project-root /absolute/project --bank project-bank
node --test memory/hindsight/automation-plugin/core.test.mjs memory/hindsight/automation-plugin/lifecycle.test.mjs
```

第一条只展示计划。项目 bank 需要预先配置。插件只捕获启用后送达的事件，没有历史自动补采或无损自动换执行器能力。

## 体验会话

`node memory/hindsight/paseo-demo.mjs status` 读取私有状态目录。`PASEO_CLI_ROOT` 可指定含 `dist/utils/client.js` 的 Paseo CLI 安装根目录；默认使用本机 private release。`HINDSIGHT_STATE_DIR` 可覆盖体验状态目录。

本机已有的演示状态已保留，仍指向原来的体验工作区，便于继续使用已验证的 A/B 会话。历史测试证据留在原工作区的 `.local/hindsight/`，不入库。

## 停止与数据

```sh
docker compose -f memory/hindsight/compose.yaml stop
launchctl bootout "gui/$(id -u)/local.paseo.hindsight-trae"
```

停止或重建容器不删除数据库。不要在保留数据时执行 volume 删除。源码、插件与运行数据分开管理；密钥、数据库、状态文件和会话内容不得提交。
