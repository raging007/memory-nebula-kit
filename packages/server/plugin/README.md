# 记忆星图 · dsh-memory-nebula

给 DeepSeek Harness 用的跨会话、跨设备长期记忆插件。核心取舍是**只让重要的记忆进入上下文**：分层、按需模糊检索、按字数预算注入，100 天后逐级精简，最后淡化。

## 组成

| 位置 | 作用 |
| --- | --- |
| 左侧栏 · 记忆星图 | 星图 / 记忆管理 / 跨设备 / 注入预览 四个页签 |
| 系统提示段 `memory-nebula` | 每轮注入「核心与重要」＋「与当前这句话相关」的记忆（有字数上限） |
| 五个工具 | `memory_save` `memory_search` `memory_get` `memory_update` `memory_forget` |
| HTTP 路由 `/memory-nebula/api/*` | 面板数据、注入预览、同步与对端传输 |

## 分层与老化

- **核心（core）**：置顶或 `pin=true`，永不淡化，始终注入，面板单独成组。
- **重要（important）**：重要度 ≥ 0.82 或反复被用到的记忆，同样不参与老化。
- **普通（normal）**：默认层。
  - 100 天后第一次精简（抽取式压缩到约 170 字）；
  - 200 天后二次精简（约 90 字）；
  - 300 天后只剩要点（进入 faded，正文清空，仍可被检索到）；
  - 再 600 天后彻底清除（留下墓碑，防止同步把旧记录带回来）。
- 被检索、被读取、被注入都会刷新「最近使用」，所以常用的记忆不会淡掉。

这些天数都能在「注入 → 老化规则」里改。

## 模糊检索与 token 预算

`memory_search` 和每轮注入用的都是同一套打分：中文二元组 + 英文词元、短语命中加成、标签加成，再乘层级权重、重要度与新鲜度。没有全量拼接：

- 注入块默认上限 900 字（约 900 tokens 的中文），核心层 380 字、相关层 460 字、最多 6 条；
- 「注入」页签可以实时看到某句话会注入什么、大概多少 tokens。

## 跨设备同步

同一账号（用 DSH 登录的账号 ID）下的设备共用一套记忆。两条通道可同时启用：

1. **同步文件夹**：填一个云盘 / Syncthing 目录，每台设备写一份 `memory-nebula.<账号>.<设备>.json`，读到别的设备快照就按记录合并（`rev` 高者胜，`updatedAt` 破平）。
2. **对端地址**：另一台设备填 `http://<局域网 IP>:<端口>` 加它的同步令牌，直接拉取 + 推送。传输接口只认同步令牌。
3. **git 仓库**：同步文件夹换成某个私有仓库的 clone（例如 `C:\Users\你\dsh-memory-data`），打开「git 自动同步」后，每次同步先 `git pull --rebase --autostash`，写完快照再 `git add/commit/push`。凭据用系统 git（`gh auth login` + `gh auth setup-git`），插件本身不保存任何 token。

同步范围：

- **记忆**：双向合并，删除用墓碑传播；
- **会话**：把 3 分钟没在写的会话日志（`session.v4.jsonl.zstd`）只读归档到同步文件夹的 `sessions/<设备>/`；「导入其他设备的会话」只补本地没有的会话，绝不覆盖，导入后**重启 DSH** 才会出现在侧栏；
- **插件清单**：每份快照带 bundle 名称与版本，面板显示「对端缺哪个插件 / 本机缺哪个」，不会自动安装；
- **配置（可选）**：打开「配置随同步」后，注入预算、老化天数、同步节奏通过 `config/desired.json` 双向收敛；`folder`、对端、令牌、开关这些本机项不参与，所以不会把一台机器的路径写到另一台上。
- **插件清单（可选）**：打开「插件清单随同步」后，每次同步把 bundle 列表、各插件行配置、MCP 名称和记忆设置写到 `config/plugins.json`；另一台的 agent 用 `tools/apply-plugins-manifest.ps1` 读取，按计划安装并在设置页应用配置。
- **插件包（可选）**：开启「插件包随同步夹」后，本插件的代码会复制到 `同步文件夹/plugins/memory-nebula/`，另一台可以直接从那里安装，不需要再拷 zip。别人的包不会被带走，也不会替对方安装。

## 安装方式

- 本地目录：把整个目录放到固定位置（如 `C:\dsh\plugins\memory-nebula`），用 `plugin_manager` 的 `install_bundle` 指向它；
- 同步文件夹：开启「插件包随同步夹」后，在另一台从 `同步文件夹/plugins/memory-nebula/` 复制到本机目录再安装；
- npm（发布后）：`install_bundle dsh-memory-nebula` 按名字安装，npm 会自动下载；
- git（GitHub 私库）：`install_bundle github:<你的账号>/dsh-memory-nebula`，要求该机器已经授权 GitHub（`gh auth login` 或 git 凭据管理器已保存 PAT/SSH key）。

## 数据位置

`$DSH_HOME/memory-nebula/`

- `memories.json`：记忆库（含设备 ID、账号 ID、同步令牌、本机设置）
- `sync-report.json`：最近一次同步结果

## 配置

插件的可调项写在「注入」页签（存在本机 `memories.json` 里，不写入 `cordis.patch.yml`）。行配置支持：

```yaml
- id: memory-nebula
  name: dsh-memory-nebula
  config:
    dataDir: 'D:\somewhere\memory-nebula'   # 自定义数据目录
    promptOrder: 58                          # 系统提示段顺序
    allowedHosts: ['192.168.1.5']            # 额外允许访问面板 API 的主机名
```

## 开发与自测

```powershell
node --check client.js
node test/smoke.mjs      # 存储、模糊检索、老化、合并、工具
node test/apply.mjs      # 用假 ctx 跑一遍 apply 与 HTTP 路由
node test/client.mjs     # 浏览器半侧的模块形状与星图布局
node test/sessions.mjs   # 会话归档 / 导入（临时 DSH_HOME）
```

安装：`plugin_manager install_bundle` 指向本目录。替换已安装版本后需要重启 DSH（或停用再启用该行）才会加载新的 Host 模块。

## 已知边界

- 压缩是抽取式的，不调用模型；很短的记忆不会被压缩（本来就没有可压的）。
- 星图最多布局 420 个点，更多记忆时按返回顺序截断。
- 会话导入需要重启；插件清单只做差异展示。
