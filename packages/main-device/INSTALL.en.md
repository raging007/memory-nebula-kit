# Main device install (memory-nebula main device)

[中文](INSTALL.md) | **English**

The main device is the **source of memories and settings**: it publishes its portable settings to `config/desired.json`, and every other device applies them after pulling.

## 0. Requirements

- Windows + DSH desktop 0.2.x;
- signed in to a DeepSeek account (the server must use the same one);
- `git`; for a private repository, `gh` logged in: `gh auth login` + `gh auth setup-git`;
- network access to github.com.

## 1. Create one **private** data repository

The repository holds plaintext memories, so it **must be private**:

```powershell
gh repo create dsh-memory-data --private --add-readme
```

`bootstrap.ps1` clones it for you; `<your-account>` below is your GitHub username.

## 2. Run bootstrap

Extract this package to `C:\dsh\main` (or any stable folder) and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dsh\main\bootstrap.ps1 `
  -Role main `
  -DataRepo https://github.com/<your-account>/dsh-memory-data.git
```

Expect one JSON line: `{"ok":true,"role":"main","pluginDir":"C:\\dsh\\plugins\\memory-nebula","dataDir":"C:\\dsh\\memory-data",...}`.
On `ok=false`, stop and read `error`: `no-git` / `clone-failed` (usually URL or auth) / `not-a-repo` / `copy-failed`.

## 3. Install the plugin

In a DSH session, ask the agent to run:

```json
{ "action": "install_bundle", "target": "C:\\dsh\\plugins\\memory-nebula" }
```

Expect `application: "applied"`. If the left-rail icon is missing, restart DSH and refresh the page.

## 4. Configure sync (one time)

Use the host URL `$env:DSH_WEB_URL` (or the URL in the app window):

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

Expect `report.config.published = true` on the first run (or `unchanged` when the repository already has a config with the same version).

## 5. Verify

```powershell
$status = (Invoke-WebRequest -UseBasicParsing -Uri "$env:DSH_WEB_URL/memory-nebula/api/sync").Content | ConvertFrom-Json
$status.status | Select-Object enabled,folder,git,sharePackage,syncConfig,intervalMinutes
```

| Item | Expected |
| --- | --- |
| Left-rail "记忆星图" | present |
| `git` / `sharePackage` / `syncConfig` | all True |
| `folder` | `C:\dsh\memory-data` |
| `git -C C:\dsh\memory-data log --oneline -3` | a `memory sync` commit |
| `config/desired.json` | has `version` / `from` / `patch` |

## 6. Next

On the server use the `memory-nebula-server` package with the same `-DataRepo` URL, then follow its own `INSTALL.md`.
