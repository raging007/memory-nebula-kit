# DeepSeek Memory Nebula · Server install

[中文](INSTALL.md) | **English**

A server is a **joiner**: it does not publish settings; it pulls the main device's memories and `config/desired.json`, applies them on the first sync, and keeps session archives off so the repository stays small.

## 0. Requirements

- Windows + DSH desktop 0.2.x;
- **signed in to the same DeepSeek account as the main device** (otherwise merges are refused or one-way);
- `git`; for the private data repository `gh` logged in: `gh auth login` + `gh auth setup-git`;
- network access to github.com (only needed for sync, not for install);
- a C:-only server is fine.

## 1. Get the data repository URL

It looks like `https://github.com/<main-account>/dsh-memory-data.git`; the main account must have added you as a collaborator, or you use the same GitHub account.
Do **not** create a new data repository here, and never copy the main device's `memories.json`.

## 2. Run bootstrap

Extract this package to `C:\dsh\server` (or any stable folder) and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dsh\server\bootstrap.ps1 `
  -Role server `
  -DataRepo https://github.com/<main-account>/dsh-memory-data.git
```

Expect: `{"ok":true,"role":"server","pluginDir":"C:\\dsh\\plugins\\memory-nebula","dataDir":"C:\\dsh\\memory-data",...}`.
On `clone-failed`, check the URL, collaborator access, and `gh auth status`.

## 3. Install the plugin

Ask the agent in a DSH session to run:

```json
{ "action": "install_bundle", "target": "C:\\dsh\\plugins\\memory-nebula" }
```

Expect `application: "applied"`. If the icon is missing, restart DSH and press Ctrl+R.

## 4. Configure sync (one time)

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

Expect:

```json
{
  "git":    { "ok": true, "pulled": true, "committed": true, "pushed": true },
  "config": { "ok": true, "applied": true, "version": <main-version>, "from": "<main-device>" },
  "folder": { "ok": true }
}
```

- `config.applied=true` means the main device's budgets/decay/sync rhythm are now local;
- `pulled=false` on the first run is fine when there is no upstream yet;
- `git.ok=false` + `could not read Username`: run `gh auth setup-git` and restart DSH.

## 5. Verify

```powershell
$state = (Invoke-WebRequest -UseBasicParsing -Uri "$env:DSH_WEB_URL/memory-nebula/api/state").Content | ConvertFrom-Json
$state.account                     # non-empty, same account as the main device
$state.prompt.sections             # >= 1
$state.stats.total                 # matches the main device
$state.configVersion               # equals the published config version
$state.settings.decay.afterDays    # matches the main device
$state.settings.sync.syncConfig    # True
```

| Item | Expected |
| --- | --- |
| Left-rail "记忆星图" | present |
| Memory count | same as the main device |
| `configVersion` | equal to `config/desired.json`'s `version` |
| Budgets / decay | same as the main device |
| `git -C C:\dsh\memory-data status -sb` | `## main...origin/main` with no ahead marker |

## 6. Later

After the main device changes budgets, decay or sync rhythm, the server applies them within 15 minutes. Portable settings changed locally also sync back with the newer version winning. `folder`, peers, tokens and the enable switches never overwrite each other.
