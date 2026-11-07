# 主设备安装（memory-nebula main device）

主设备是**配置和记忆的源头**：它把自己的可移植设置发布到 `config/desired.json`，其它设备拉取后自动应用。

## 0. 前置

- Windows + DSH 桌面版 0.2.x；
- 已登录 DeepSeek 账号（服务器要用同一个）；
- `git`；私有仓库还需要 `gh` 且已登录：`gh auth login` + `gh auth setup-git`；
- 能访问 github.com。

## 1. 建一个**私有**数据仓库（一次）

数据仓里是记忆明文，**必须私有**：

```powershell
gh repo create dsh-memory-data --private --add-readme
git clone https://github.com/<你的账号>/dsh-memory-data.git C:\Users\$env:USERNAME\dsh\memory-data
```

> 也可以让 `bootstrap.ps1` 替你 clone，只要仓库已经存在。下面的 `<你的账号>` 换成 GitHub 用户名。

## 2. 跑 bootstrap

把本目录解压到 `C:\dsh\main`（或任意固定位置），执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dsh\main\bootstrap.ps1 `
  -Role main `
  -DataRepo https://github.com/<你的账号>/dsh-memory-data.git
```

期望输出一行 JSON：`{"ok":true,"role":"main","pluginDir":"C:\\dsh\\plugins\\memory-nebula","dataDir":"C:\\dsh\\memory-data",...}`。
`ok=false` 时按 `error` 停下：`no-git` / `clone-failed`（多为 URL 或授权问题）/ `not-a-repo` / `copy-failed`。

## 3. 安装插件

在 DSH 会话里让 agent 执行：

```json
{ "action": "install_bundle", "target": "C:\\dsh\\plugins\\memory-nebula" }
```

期望 `application: "applied"`。没出现左栏图标就重启 DSH 并刷新页面。

## 4. 配置同步（一次）

用宿主地址 `$env:DSH_WEB_URL`（没有就用应用窗口地址栏的 URL），在 PowerShell 里：

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
    sessions        = 'export'
    intervalMinutes = 15
    plugins         = $true
  }
} | ConvertTo-Json -Depth 5
Invoke-WebRequest -UseBasicParsing -Uri $base -Method POST -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($settings)) | Out-Null

$run = Invoke-WebRequest -UseBasicParsing -Uri $base -Method POST -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes('{"action":"run"}'))
($run.Content | ConvertFrom-Json).report | ConvertTo-Json -Depth 6
```

期望 `report.config.published = true`（第一次发布本机配置）或 `unchanged`（数据仓已有配置且版本相同）。

## 5. 验收

```powershell
$status = (Invoke-WebRequest -UseBasicParsing -Uri "$env:DSH_WEB_URL/memory-nebula/api/sync").Content | ConvertFrom-Json
$status.status | Select-Object enabled,folder,git,sharePackage,syncConfig,intervalMinutes
```

| 项 | 期望 |
| --- | --- |
| 左栏「记忆星图」 | 出现 |
| `status.git` / `sharePackage` / `syncConfig` | 都是 True |
| `folder` | `C:\dsh\memory-data` |
| `git -C C:\dsh\memory-data log --oneline -3` | 出现 `memory sync` 提交 |
| `config/desired.json` | 有 `version` / `from` / `patch` |

## 6. 下一步

服务器上用 `memory-nebula-server` 包，`-DataRepo` 填同一个仓库地址，其余按它自己的 INSTALL.md 做。
