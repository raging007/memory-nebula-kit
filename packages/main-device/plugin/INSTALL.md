# 在另一台电脑安装「记忆星图」

这个插件是本地 bundle（没有发布到 npm），所以另一台电脑装的是**同一份文件夹**。两台设备之间同步的是数据，不是代码。

## 0. 前置

- 另一台电脑已装 DeepSeek Harness 桌面版，并**登录同一个 DeepSeek 账号**（设置 → 账号）。面板里显示「账号已绑定」才算对；否则两台会按 `local` 合并，任何设备只要连到同一个同步文件夹都会并进来。
- 两台机器的 DSH 版本尽量一致（会话日志是 `session.v4` 格式；跨大版本时只同步记忆，别导入会话）。

## 1. 把插件文件夹拷过去

把整个 `memory-nebula` 目录（或 `memory-nebula-0.1.0.zip` 解压后的目录）放到一个固定位置，例如：

```
D:\DeepSeek work\memory-nebula
```

不要放进 `$DSH_HOME`（`...\DeepSeek-dsh`）里面，也不要只拷 `memories.json`——那是数据，不是插件。

## 2. 安装

在那台电脑的 DSH 里新开一个会话，把下面这句话发给它（把路径换成实际路径）：

> 把本地目录 `D:\DeepSeek work\memory-nebula` 安装成插件：用 plugin_manager 的 install_bundle，装完告诉我 fiberPhase 是不是 active。

它会做三件事：把目录 link 进当前 profile、把 `dsh-memory-nebula` 加进 bundle 列表、加载插件。装完通常立即生效；如果左栏没出现星图图标，重启一次 DSH 并刷新页面（Ctrl+R）。

> 也可以在「插件」页面的安装入口里试本地目录路径；不同版本 UI 支持程度不一样，用上面这句最稳。

> **没把 zip 拷过来？** 如果这台机器之前已经配好同步文件夹、且另一台开了「插件包随同步夹」，插件代码会在 `同步文件夹\plugins\memory-nebula\` 里。把它整个复制到本机固定目录（别直接从云盘目录 link，云盘同步会动文件），再用上面那句话装。目录里的 `INSTALL-FROM-HERE.md` 也是同样的步骤。

## 2b. 方案 B：挂 GitHub 私库（不拷文件）

前提：GitHub 账号；两台机器都装了 git（Windows 可 `winget install Git.Git`）。

1. **授权**（两台各一次）：
   ```powershell
   gh auth login            # 选 GitHub.com → HTTPS → 浏览器授权
   gh auth setup-git        # 让 git 用 gh 的凭据
   ```
   没有 gh 的话，用 git 凭据管理器保存一个 PAT 也可以。

2. **建两个私有仓库**（只有一个 GitHub 账号也能建）：
   - `dsh-memory-nebula`：放插件代码（本目录）；
   - `dsh-memory-data`：放同步数据（记忆快照、会话归档）。
   数据仓库必须私有——里面是记忆明文。

3. **推代码库**（在本目录）：
   ```powershell
   gh repo create dsh-memory-nebula --private --source . --push
   ```

4. **服务器上装插件**：新会话里让 agent 执行
   > 用 plugin_manager 的 install_bundle，target 是 `github:raging007/dsh-memory-nebula`
   装完重启 DSH、刷新页面。

5. **两台都 clone 数据仓库**，放在固定目录（别放 `$DSH_HOME`）：
   ```powershell
   git clone https://github.com/raging007/dsh-memory-data.git C:\dsh\memory-data
   ```

6. **面板设同步**：两台「记忆星图 → 跨设备」里，同步文件夹都填上面这个 clone 的路径，打开「同步已开启」「git 自动同步」和「配置随同步」，再点「立即同步」。之后每轮自动 `pull → 合并/写入 → commit → push`，预算/老化这些设置也会通过 `config/desired.json` 自动收敛。

7. 可选：把「插件包随同步夹」也打开，代码会进 `plugins/memory-nebula/`，服务器以后更新时从同一仓库拉即可。

> 注意：git 通道每个设备只写自己的快照文件，冲突很少；如果两台同时改**同一个**版本号的文件（比如同时更新插件包），`pull --rebase` 可能报冲突，此时同步会停下并报错，不会丢已合并的记忆。会话归档会让数据仓库变大，C 盘/仓库空间紧张就把「会话归档」设为不导出。

## 3. 确认装好了

- 左栏图标栏出现「记忆星图」；
- 点开 →「跨设备」，能看到设备名和「账号已绑定」；
- 随便聊一句「记住：……」再让它 `memory_search` 一下，能查到。

## 4. 开启同步（两台都要做）

打开「记忆星图 → 跨设备」：

1. **同步文件夹**：两台填**同一个云盘目录**的本地路径，例如
   - A 机：`C:\Users\你\OneDrive\dsh-memory`
   - B 机：`C:\Users\你\OneDrive\dsh-memory`
   （路径可以不同，指向同一个云盘文件夹即可；不要填 `$DSH_HOME` 内部）
2. 打开「同步已开启」，点「立即同步」。
3. 可选：打开「配置随同步」，两台的可移植设置（预算、老化、同步节奏）会通过 `config/desired.json` 自动对齐。
4. 在 A 上记一条新记忆，等云盘同步完成，B 上再点「立即同步」，「记忆」页签里应该能看到。

不想用云盘，也可以走局域网直连：

- B 机「对端设备」里填 A 机的地址 `http://192.168.x.x:<DSH 端口>` 和 A 面板里显示的**同步令牌**（反过来也填一遍就是双向）；
- A 机防火墙放行该端口；
- 这条通道不需要云盘，但要求两台机器在同一网络、且 A 机开着 DSH。

## 5. 会话怎么办

- **导出**是自动的：空闲超过 3 分钟的会话日志会归档到 `同步文件夹\sessions\<设备ID>\`；
- **导入**是手动的：另一台点「导入其他设备的会话」，只补本地没有的会话，**不会覆盖**已有会话；导入后**重启 DSH** 才会出现在侧栏；
- 正在写的会话不会被导出（避免拷到半截日志），等它空闲后再同步一次即可。

## 6. 插件清单

每份快照带 bundle 名称和版本。同步后「上次同步」里会显示对端缺哪些插件、本机缺哪些——**只提示，不自动安装**。两台想保持一致，就在缺的那台上各自装。

## 注意

- 同步令牌等于密码，别发到公开地方；换设备或怀疑泄露就在面板里换一个（改 `memories.json` 的 `settings.sync.token` 不方便，建议后续做成按钮）。
- 同一条记忆两边同时改，按 `rev` 高者胜（后改的覆盖先改的），不会合并两段文字。
- 运行中不要手改 `memories.json`，会被内存里的状态覆盖；要批量导入用面板或工具。
- 每个设备各有一份 `memories.json`，同步是合并，不是覆盖；卸载插件不会删数据。
