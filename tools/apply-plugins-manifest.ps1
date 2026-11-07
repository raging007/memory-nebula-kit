[CmdletBinding()]
param(
  [string]$Manifest = 'C:\dsh\memory-data\config\plugins.json',
  [string]$ProfileDir = $env:DSH_PROFILE_DIR,
  [string]$DshUrl = $env:DSH_WEB_URL,
  [switch]$ApplyMemory
)

# 读取主机导出的插件清单，算出这台机器还缺什么、怎么装、哪些配置需要应用。
# 本脚本不安装插件（安装必须由 DSH 里的 agent 调 plugin_manager），只生成可执行计划；
# 只有 -ApplyMemory 时才会通过记忆星图的 API 应用它的可移植设置。
#
# 输出一行 ASCII JSON。

$ErrorActionPreference = 'Continue'

function Out([hashtable]$payload) {
  $payload | ConvertTo-Json -Compress -Depth 10
  if ($payload['ok']) { exit 0 } else { exit 1 }
}

if (-not (Test-Path $Manifest)) {
  Out @{ ok = $false; error = 'no-manifest'; hint = "Missing $Manifest; run the exporter on the main device and sync." }
}
if ([string]::IsNullOrWhiteSpace($ProfileDir) -or -not (Test-Path (Join-Path $ProfileDir 'package.json'))) {
  Out @{ ok = $false; error = 'no-profile'; hint = 'Pass -ProfileDir or run inside a DSH shell with DSH_PROFILE_DIR set.' }
}

try {
  $doc = Get-Content $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Out @{ ok = $false; error = 'bad-manifest'; detail = $_.Exception.Message }
}

$profilePkg = Get-Content (Join-Path $ProfileDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$deps = @{}
if ($profilePkg.dependencies) { $profilePkg.dependencies.PSObject.Properties | ForEach-Object { $deps[$_.Name] = $_.Value } }
$bundles = @()
if ($profilePkg.dsh -and $profilePkg.dsh.profile -and $profilePkg.dsh.profile.bundles) { $bundles = @($profilePkg.dsh.profile.bundles) }
$installed = @{}
$deps.Keys | ForEach-Object { $installed[$_] = $true }
$bundles | ForEach-Object { $installed[$_] = $true }

$install = @()
$local = @()
$skip = @()
$already = @()
foreach ($bundle in @($doc.bundles)) {
  $name = [string]$bundle.name
  if ($bundles -contains $name) { $already += $name; continue }
  switch ([string]$bundle.source) {
    'shipped' { $already += $name }
    'npm' {
      $spec = [string]$bundle.spec
      $target = if ($spec -and $spec -notmatch '^(link|file|https?|git)') { "$name@$spec" } else { $name }
      $install += @{ name = $name; target = $target; source = 'npm' }
    }
    'link' {
      if ($bundle.transfer -eq 'data-repo') {
        $local += @{
          name = $name
          target = 'C:\dsh\plugins\memory-nebula'
          source = 'C:\dsh\memory-data\plugins\memory-nebula'
          note = 'Copy source -> target, then run plugin_manager install_bundle target.'
        }
      } else {
        $skip += @{ name = $name; reason = 'local/link package, not portable'; path = $bundle.path }
      }
    }
    default { $skip += @{ name = $name; reason = 'unknown source' } }
  }
}

$configs = @()
foreach ($row in @($doc.rows)) {
  if (-not $row.portableConfig) { continue }
  $config = $row.config
  if (-not $config) { continue }
  $keys = @($config.PSObject.Properties.Name)
  if ($keys.Count -eq 0) { continue }
  $configs += @{ id = $row.id; name = $row.name; config = $config; apply = 'settings-ui' }
}

$memory = $null
if ($doc.memory -and $doc.memory.settings) {
  $memory = @{
    declaredVersion = $doc.memory.version
    installed = [bool]($installed['dsh-memory-nebula'])
    settings = $doc.memory.settings
    applied = $false
  }
  if ($ApplyMemory -and $memory.installed) {
    if ([string]::IsNullOrWhiteSpace($DshUrl)) {
      $memory.error = 'no-dsh-url'
    } else {
      try {
        $body = @{ patch = $doc.memory.settings } | ConvertTo-Json -Depth 8
        $null = Invoke-RestMethod -Uri "$DshUrl/memory-nebula/api/settings" -Method Post -Headers @{ 'x-memory-nebula' = '1'; 'content-type' = 'application/json' } -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
        $state = Invoke-RestMethod -Uri "$DshUrl/memory-nebula/api/state" -TimeoutSec 15
        $memory.applied = $true
        $memory.configVersion = $state.configVersion
      } catch {
        $memory.error = $_.Exception.Message
      }
    }
  }
}

$next = @()
if ($install.Count -gt 0) { $next += 'Ask the DSH agent to run plugin_manager install_bundle for each item in install.' }
if ($local.Count -gt 0) { $next += 'Copy each local.source into local.target, then install_bundle the target.' }
if ($configs.Count -gt 0) { $next += 'Apply configs in the DSH Settings pages (they are user overrides; the UI is the supported editor).' }
if ($memory -and -not $memory.applied) { $next += 'Run this script again with -ApplyMemory -DshUrl <app url> to apply memory settings.' }

Out @{
  ok = $true
  profile = $profilePkg.name
  installedCount = $installed.Count
  install = $install
  local = $local
  skip = $skip
  already = $already
  configs = $configs
  memory = $memory
  next = $next
}
