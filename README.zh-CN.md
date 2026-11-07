# DeepSeek 记忆星图 · Memory nebula

[English](README.md) | **中文**

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的跨设备长期记忆插件。分「主设备」和「服务器」两个安装包：主设备负责产出记忆与配置，服务器加入后自动跟进。记忆数据放在你自己的**私有** GitHub 仓库里，通过 git 同步；这个公开仓库只放插件与安装脚本，不含任何个人数据。

- 模糊检索、按需注入，不把整库塞进上下文；
- 核心 / 重要 / 普通 / 淡化四层，重要记忆永不淡化；
- 默认 100 / 200 / 300 / 600 天逐级精简与遗忘（可在面板改）；
- 记忆星图可视化、记忆管理、注入预览、跨设备同步；
- 预算、老化、同步节奏等可移植配置会随同步自动对齐。

## 两个包分别装

主设备（先装）：

```powershell
New-Item -ItemType Directory C:\dsh\main -Force | Out-Null
gh release download v0.2.0 -R raging007/memory-nebula-kit -p 'memory-nebula-main-device.zip' -D C:\dsh --clobber
Expand-Archive C:\dsh\memory-nebula-main-device.zip C:\dsh\main -Force
gh repo create dsh-memory-data --private --add-readme
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dsh\main\bootstrap.ps1 -Role main -DataRepo https://github.com/<你的账号>/dsh-memory-data.git
```

服务器（后装，`-DataRepo` 填主设备建的那个私有仓库）：

```powershell
New-Item -ItemType Directory C:\dsh\server -Force | Out-Null
gh release download v0.2.0 -R raging007/memory-nebula-kit -p 'memory-nebula-server.zip' -D C:\dsh --clobber
Expand-Archive C:\dsh\memory-nebula-server.zip C:\dsh\server -Force
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dsh\server\bootstrap.ps1 -Role server -DataRepo https://github.com/<你的账号>/dsh-memory-data.git
```

两个脚本都会打印一行 JSON，`ok:true` 时继续；把 `pluginDir` 交给 DSH 里的 agent：

> 用 plugin_manager 的 install_bundle 安装 `C:\dsh\plugins\memory-nebula`，装完告诉我 fiberPhase 是不是 active。

然后按各自包里的 `INSTALL.md` 配置同步（一次）。没有 `gh` 的话，到 Releases 页面手动下载 zip 解压，命令同理。

## 它怎么工作

```
主设备 DSH ── 插件 ── 记忆库(本机) ──┐
                                  ├─ 私有数据仓 dsh-memory-data（git）
服务器 DSH ── 插件 ── 记忆库(本机) ──┘
```

- 每台设备的记忆都存在本机 `DSH_HOME/memory-nebula/memories.json`；
- 同步时每台设备写一份自己的快照到数据仓，`pull → 合并 → commit → push`；
- 合并按记录版本（`rev`）走，删除用墓碑传播，不需要常开服务器；
- 可移植配置走 `config/desired.json`，版本新的一方胜，另一方应用但不回写，不会来回覆盖；
- `folder`、对端地址、同步令牌、开关这些本机项**不参与**配置同步。

## 怎么用

安装并配置同步后，刷新页面（Ctrl+R），左栏出现「记忆星图」：

| 页签 | 作用 |
| --- | --- |
| 星图 | 按层级分布的星图，核心金色光晕、淡化变暗；滚轮缩放、拖动平移、点击看详情 |
| 记忆 | 搜索、按层筛选、手动添加、编辑、设/取消核心、遗忘 |
| 跨设备 | 同步文件夹 / 对端地址、git 自动同步、插件包随同步夹、配置随同步、立即同步 |
| 注入 | 调注入预算与老化规则，实时预览「这一轮会注入什么、约多少 tokens」 |

模型侧有五个工具：`memory_save`、`memory_search`、`memory_get`、`memory_update`、`memory_forget`。你可以直接说「记住……」「以后回答先给结论」「忘掉那条关于 X 的」，它会按工具定义落库。

**分层与老化**：核心（置顶）与重要（重要度 ≥ 0.82 或反复被用到）不参与老化；普通记忆默认 100 天第一次精简、200 天二次、300 天只剩要点、再 600 天彻底清除；被检索/读取/注入会刷新「最近使用」。

更多细节见 [docs/usage.zh-CN.md](docs/usage.zh-CN.md)。

## 前置条件

- DSH 桌面版 **0.2.x**（Windows / macOS 均可，示例用 PowerShell）；
- `git`；私有仓库需要 `gh` 已登录（`gh auth login` + `gh auth setup-git`）；
- 主设备与服务器登录**同一个 DeepSeek 账号**；
- 数据仓保持**私有**——里面是记忆明文。

## 隐私

- 本仓库不含任何人的记忆、账号 ID、令牌或本机路径；
- 数据仓由每个使用者自己创建，权限自己掌握；
- 插件本身不保存 GitHub token，git 凭据走系统（`gh` 的 credential helper）；
- 卸载插件不会删除本机记忆；数据仓删了才是真的没了。

MIT License，见 [LICENSE](LICENSE)。
