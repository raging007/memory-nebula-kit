---
name: memory-nebula-kit
description: Use when installing the 记忆星图 (Memory nebula) cross-device memory plugin on a DeepSeek Harness machine, either as the main device that publishes settings or as a server that joins an existing private data repository. The kit contains role-specific installers, the plugin package, and verification steps.
---

# 安装记忆星图（主设备 / 服务器）

本仓库提供两个安装包：

- `packages/main-device/`：主设备，创建/使用私有数据仓，发布配置；
- `packages/server/`：服务器，加入同一个数据仓，自动应用主设备配置。

## 先确认角色

- **主设备**：你第一次装、或者这台是记忆和配置的源头 → 用 main-device 包。
- **服务器**：已经有一台主设备在用，这台只是加入 → 用 server 包，并拿到主设备的私有数据仓地址。

## 前置（不满足先停下）

- DSH 桌面版 0.2.x，登录 DeepSeek 账号（两台必须同账号）；
- `git`；私有仓库还需要 `gh` 已登录：`gh auth login` + `gh auth setup-git`；
- 能访问 github.com。

## 安装步骤

1. 从 Releases 下载对应 zip 并解压（或使用用户提供的本地包），目录里应有 `bootstrap.ps1`、`plugin/`、`INSTALL.md`、`role.json`。
2. 跑 bootstrap：

   ```powershell
   # 主设备
   powershell -NoProfile -ExecutionPolicy Bypass -File <包目录>\bootstrap.ps1 -Role main -DataRepo <私有数据仓 URL>
   # 服务器
   powershell -NoProfile -ExecutionPolicy Bypass -File <包目录>\bootstrap.ps1 -Role server -DataRepo <私有数据仓 URL>
   ```

   它会 clone/更新数据仓、把插件铺到 `C:\dsh\plugins\memory-nebula`，并打印一行 JSON（`ok`、`pluginDir`、`dataDir`、`configPatch`）。

3. 用 `plugin_manager` 安装：

   ```json
   { "action": "install_bundle", "target": "C:\\dsh\\plugins\\memory-nebula" }
   ```

   期望 `application: "applied"`。

4. 按对应包里的 `INSTALL.md` 第 4 节，把 `/memory-nebula/api/sync` 的 settings 配好并 run 一次。

5. 验收：`/api/state` 的 `account` 非空、`prompt.sections >= 1`、`stats.total` 与主设备一致、`configVersion` 等于 `config/desired.json` 的 `version`。

## 注意

- 数据仓**必须私有**（记忆明文）；本仓库不含任何人的数据；
- 不要把主设备的 `memories.json` 拷到服务器；
- 私有仓 clone 失败时优先检查仓库地址、协作者邀请和 `gh auth status`；
- 不要手改 profile 的 `package.json` / `cordis.patch.yml`。
