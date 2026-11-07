[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DataRepo,
  [string]$DataDir = 'C:\dsh\memory-data',
  [string]$PluginDir = 'C:\dsh\plugins\memory-nebula',
  [ValidateSet('main', 'server')][string]$Role = 'main'
)

# Prepares one machine for the memory-nebula plugin: clones (or updates) the private data
# repository and lays the plugin package down in a stable, user-writable directory.
# It never edits the DSH profile and never installs the plugin itself; installation stays an
# explicit plugin_manager call by the agent.
#
# Output: one ASCII JSON line. Exit codes: 0 ok, 2 no-git, 4 clone/pull, 6 plugin-missing, 7 copy.

$ErrorActionPreference = 'Continue'

function Emit([bool]$ok, [hashtable]$payload) {
  $payload['ok'] = $ok
  $payload | ConvertTo-Json -Compress -Depth 6
  if ($ok) { exit 0 } else { exit 1 }
}

try {
  if ([string]::IsNullOrWhiteSpace($DataRepo)) {
    Emit $false @{ error = 'bad-args'; hint = 'Pass -DataRepo https://github.com/<you>/dsh-memory-data.git' }
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Emit $false @{ error = 'no-git'; hint = 'Install Git for Windows (winget install --id Git.Git -e), then reopen the shell.' }
  }

  $authOk = $true
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    $authOk = $false
  }
  else {
    & gh auth status 2>&1 | Out-Null
    $authOk = ($LASTEXITCODE -eq 0)
  }

  $dataParent = Split-Path -Parent $DataDir
  if (-not (Test-Path $dataParent)) { New-Item -ItemType Directory -Path $dataParent -Force -ErrorAction Stop | Out-Null }

  if (Test-Path (Join-Path $DataDir '.git')) {
    & git -C $DataDir pull --rebase --autostash 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Emit $false @{ error = 'pull-failed'; dataDir = $DataDir; hint = 'Fix the git error in the data directory (or delete it and rerun to clone again).' }
    }
  }
  elseif (Test-Path $DataDir) {
    Emit $false @{ error = 'not-a-repo'; dataDir = $DataDir; hint = 'The target exists but is not a git clone; move it away and rerun.' }
  }
  else {
    & git clone $DataRepo $DataDir 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Emit $false @{ error = 'clone-failed'; dataDir = $DataDir; hint = 'Check the repository URL, network access to github.com, and gh auth (private repo).' }
    }
  }

  $source = Join-Path $PSScriptRoot 'plugin'
  if (-not (Test-Path (Join-Path $source 'package.json'))) {
    Emit $false @{ error = 'plugin-missing'; source = $source; hint = 'Keep bootstrap.ps1 next to the plugin directory.' }
  }

  try {
    $pluginParent = Split-Path -Parent $PluginDir
    if (-not (Test-Path $pluginParent)) { New-Item -ItemType Directory -Path $pluginParent -Force -ErrorAction Stop | Out-Null }
    if (Test-Path $PluginDir) {
      Copy-Item -Path (Join-Path $source '*') -Destination $PluginDir -Recurse -Force -ErrorAction Stop
    }
    else {
      Copy-Item -Path $source -Destination $PluginDir -Recurse -Force -ErrorAction Stop
    }
  }
  catch {
    Emit $false @{ error = 'copy-failed'; pluginDir = $PluginDir; hint = 'Choose a user-writable location, e.g. -PluginDir "$env:USERPROFILE\dsh\plugins\memory-nebula".'; detail = $_.Exception.Message }
  }

  if (-not (Test-Path (Join-Path $PluginDir 'package.json'))) {
    Emit $false @{ error = 'copy-failed'; pluginDir = $PluginDir; hint = 'The plugin directory exists but package.json is missing.' }
  }

  $head = ''
  if (Test-Path (Join-Path $DataDir '.git')) {
    $head = ((& git -C $DataDir log --oneline -1 2>$null) -join ' ').Trim()
  }

  $sessions = if ($Role -eq 'server') { 'off' } else { 'export' }
  $patch = @{
    enabled         = $true
    folder          = $DataDir
    git             = $true
    sharePackage    = $true
    syncConfig      = $true
    sessions        = $sessions
    intervalMinutes = 15
    plugins         = $true
  }

  Emit $true @{
    role = $Role
    pluginDir = $PluginDir
    dataDir = $DataDir
    dshUrl = $env:DSH_WEB_URL
    dataHead = $head
    githubAuth = $authOk
    configPatch = $patch
    next = 'Call plugin_manager install_bundle with pluginDir, then POST /memory-nebula/api/sync action=settings with configPatch and action=run.'
  }
}
catch {
  Emit $false @{ error = 'unexpected'; detail = $_.Exception.Message }
}
