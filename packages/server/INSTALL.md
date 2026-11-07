# DeepSeek 记忆星图 · 服务器安装

[English](INSTALL.en.md) | **中文**

服务器是**加入方**：它不发布配置，只拉取主设备的记忆与 `config/desired.json`，并在首次同步时自动应用。会话归档默认关闭，避免数据仓被日志撑大。

## 0. 前置

- Windows + DSH 桌面版 0.2.x；
- **登录与主设备同一个 DeepSeek 账号**（否则记忆合并会被拒绝或变单向）；
- `git`；读私有数据仓还需要 `gh` 且已登录：`gh auth login` + `gh auth setup-git`；
- 能访问 github.com（只影响同步，不影响安装）；
- 服务器只有 C 盘没问题。

## 1. 拿到主设备建好的数据仓地址

形如 `https://github.com/<主设备账号>/dsh-memory-data.git`，并且该账号已把你加为协作者，或你用同一个 GitHub 账号。
**不要**在这里新建数据仓，也不要复制主设备的 `memories.json`。

## 2. 跑 bootstrap

把本目录解压到 `C:\dsh\server`（或任意固定位置），执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dsh\server\bootstrap.ps1 `
  -Role server `
  -DataRepo https://github.com/<主设备账号>/dsh-memory-data.git
```

期望：`{"ok":true,"role":"server","pluginDir":"C:\\dsh\\plugins\\memory-nebula","dataDir":"C:\\dsh\\memory-data",...}`。
`clone-failed` 时检查仓库地址、是否被邀请为协作者、`gh auth status`。

## 3. 安装插件

在 DSH 会话里让 agent 执行：

```json
{ "action": "install_bundle", "target": "C:\\dsh\\plugins\\memory-nebula" }
```

期望 `application: "applied"`。左栏没有图标就重启 DSH + Ctrl+R。

## 4. 配置同步（一次）

```powershell
$base = "$env:DSH_WEB_URL/memory-nebula/api/sync"
$headers = @{ 'x-memory-nebula' = '1'; 'content-type' = 'application/json' }
$settings = @{
  action = 'settings'
  patch  = @{
    enabled         = $true
    folder          = 'C:\dsh\memory-data'
    git             = $true
    sharePackage    = $true
    syncConfig      = $true
    sessions        = 'off'
    intervalMinutes = 15
    plugins         = $true
  }
} | ConvertTo-Json -Depth 5
Invoke-WebRequest -UseBasicParsing -Uri $base -Method POST -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($settings)) | Out-Null

$run = Invoke-WebRequest -UseBasicParsing -Uri $base -Method POST -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes('{"action":"run"}'))
($run.Content | ConvertFrom-Json).report | ConvertTo-Json -Depth 6
```

期望：

```json
{
  "git":    { "ok": true, "pulled": true, "committed": true, "pushed": true },
  "config": { "ok": true, "applied": true, "version": <主设备的版本>, "from": "<主设备名>" },
  "folder": { "ok": true }
}
```

- `config.applied=true` 表示主设备的预算/老化/同步节奏已经写进本机；
- 第一次 `git.pulled` 可能因为没上游而为 false，不影响；
- `git.ok=false` + `could not read Username`：`gh auth setup-git`，重开 DSH。

## 5. 验收

```powershell
$state = (Invoke-WebRequest -UseBasicParsing -Uri "$env:DSH_WEB_URL/memory-nebula/api/state").Content | ConvertFrom-Json
$state.account                     # 非空，且与主设备同一账号
$state.prompt.sections             # >= 1
$state.stats.total                 # 与主设备一致（拉下来的记忆）
$state.configVersion               # 等于主设备发布的版本
$state.settings.decay.afterDays    # 与主设备一致
$state.settings.sync.syncConfig    # True
```

| 项 | 期望 |
| --- | --- |
| 左栏「记忆星图」 | 出现 |
| 记忆条数 | 与主设备一致 |
| `configVersion` | 等于 `config/desired.json` 的 `version` |
| 预算 / 老化 | 与主设备一致 |
| `git -C C:\dsh\memory-data status -sb` | `## main...origin/main` 且不带 ahead |

## 6. 以后

主设备改预算、老化、同步节奏后，服务器下一轮（15 分钟）自动应用；服务器本地改的也可移植设置会以版本较新的为准同步回去。`folder`、对端、令牌、开关不会互相覆盖。
