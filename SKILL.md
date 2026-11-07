---
name: memory-nebula-kit
description: Use when installing the 记忆星图 (Memory nebula) cross-device memory plugin on a DeepSeek Harness machine, either as the main device that publishes settings or as a server that joins an existing private data repository. The kit contains role-specific installers, the plugin package, and verification steps.
---

# DeepSeek Memory Nebula kit

This repository ships two installers:

- `packages/main-device/` — the main device: creates or uses a private data repository and publishes settings;
- `packages/server/` — a server: joins the same data repository and applies the main device's config.

## Pick the role

- **Main device**: first install, or the machine that owns the memories and settings → use the main-device package.
- **Server**: a main device already exists and this machine only joins → use the server package with that device's private repository URL.

## Prerequisites (stop and report if missing)

- DSH desktop 0.2.x, signed in to a DeepSeek account (both machines must share it);
- `git`; for private repositories `gh` logged in (`gh auth login` + `gh auth setup-git`);
- Network access to github.com.

## Install

1. Download the matching zip from Releases and extract it (or use a local copy). The folder contains `bootstrap.ps1`, `plugin/`, `INSTALL.md`, `role.json`.
2. Run bootstrap:

   ```powershell
   # main device
   powershell -NoProfile -ExecutionPolicy Bypass -File <package>\bootstrap.ps1 -Role main -DataRepo <private-data-repo-url>
   # server
   powershell -NoProfile -ExecutionPolicy Bypass -File <package>\bootstrap.ps1 -Role server -DataRepo <private-data-repo-url>
   ```

   It clones or updates the data repository, copies the plugin to `C:\dsh\plugins\memory-nebula`, and prints one JSON line (`ok`, `pluginDir`, `dataDir`, `configPatch`).

3. Install with `plugin_manager`:

   ```json
   { "action": "install_bundle", "target": "C:\\dsh\\plugins\\memory-nebula" }
   ```

   Expect `application: "applied"`.

4. Follow section 4 of the package's `INSTALL.md` to configure `/memory-nebula/api/sync` and run one sync.

5. Verify: `/api/state` has a non-empty `account`, `prompt.sections >= 1`, `stats.total` matches the main device, and `configVersion` equals `config/desired.json`'s `version`.

## Notes

- The data repository **must stay private** (plaintext memories); this repository contains no personal data.
- Never copy the main device's `memories.json` to the server.
- If cloning the private repository fails, check the URL, collaborator access, and `gh auth status`.
- Do not edit the profile's `package.json` or `cordis.patch.yml` by hand.

---

# DeepSeek 记忆星图 安装包（中文）

本仓库提供两个安装包：

- `packages/main-device/`：主设备，创建/使用私有数据仓，发布配置；
- `packages/server/`：服务器，加入同一个数据仓，自动应用主设备配置。

**先确认角色**：第一次装或这台是记忆源头 → main-device；已有主设备、这台只是加入 → server，并拿到主设备的私有数据仓地址。

**前置**：DSH 0.2.x、两台登录同一个 DeepSeek 账号、`git`；私有仓还需要 `gh` 已登录（`gh auth login` + `gh auth setup-git`）。

**步骤**：

1. 从 Releases 下载对应 zip 解压（目录里应有 `bootstrap.ps1`、`plugin/`、`INSTALL.md`、`role.json`）；
2. 跑 `bootstrap.ps1 -Role main|server -DataRepo <私有数据仓 URL>`，它会 clone/更新数据仓并把插件铺到 `C:\dsh\plugins\memory-nebula`，输出一行 JSON；
3. 用 `plugin_manager` 的 `install_bundle` 装 `C:\dsh\plugins\memory-nebula`，期望 `applied`；
4. 按包内 `INSTALL.md` 第 4 节配置 `/memory-nebula/api/sync` 并 run 一次；
5. 验收：`/api/state` 的 `account` 非空、`prompt.sections >= 1`、`stats.total` 与主设备一致、`configVersion` 等于 `config/desired.json` 的 `version`。

**注意**：数据仓必须私有；不要把主设备的 `memories.json` 拷到服务器；不要手改 profile 的 `package.json` / `cordis.patch.yml`。
