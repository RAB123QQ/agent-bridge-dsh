#requires -Version 5.1
<#
.SYNOPSIS
  Install the dsh-pair-panel bundle into DSH profiles, and optionally write the
  agentbridge MCP configuration row, for BOTH the desktop app and `dsh web`.

.DESCRIPTION
  Supported DSH releases: 0.1.x and 0.2.x (verified on 0.2.1-rc.2).
  Profile targets:
    web      -> $DSH_HOME/profiles/web      (used by `dsh web` / `abg dsh --pair`)
    desktop  -> $DSH_HOME/profiles/desktop  (used by the DeepSeek Harness app)
    both     -> install into both profiles
  MCP layer:
    home     -> $DSH_HOME/cordis.patch.yml            (applies to every profile)
    profile  -> each installed profile's cordis.patch.yml
    none     -> do not touch MCP configuration

.PARAMETER Profile
  web | desktop | both (default: both)

.PARAMETER PluginPath
  Path to the dsh-pair-panel directory (default: <repo>/dsh-pair-panel)

.PARAMETER McpLayer
  home | profile | none (default: home)

.PARAMETER McpUrl
  MCP streamable-http endpoint (default: http://127.0.0.1:8765/mcp)

.PARAMETER AllowDesktopRunning
  Deprecated: installing into the desktop profile while the app runs is now the
  default (the Desktop CLI takes the profile write lock and the running app
  applies the change through HMR). Kept for backwards compatibility.

.PARAMETER RequireQuit
  Refuse to touch the desktop profile while DeepSeek Harness is running. Use
  this if you prefer the documented clean-install path (quit the app first).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install-dsh.ps1 -Profile both
#>
param(
  [ValidateSet('web', 'desktop', 'both')]
  [string]$Profile = 'both',
  [string]$PluginPath = '',
  [ValidateSet('home', 'profile', 'none')]
  [string]$McpLayer = 'home',
  [string]$McpUrl = 'http://127.0.0.1:8765/mcp',
  [switch]$AllowDesktopRunning,
  [switch]$RequireQuit,
  [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
if (-not $PluginPath) { $PluginPath = Join-Path $repoRoot 'dsh-pair-panel' }
$PluginPath = [System.IO.Path]::GetFullPath($PluginPath)
if (-not (Test-Path -LiteralPath (Join-Path $PluginPath 'package.json'))) {
  throw "dsh-pair-panel package.json not found under $PluginPath"
}

function Write-Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Warn([string]$text) { Write-Host "warning: $text" -ForegroundColor Yellow }

# ---- resolve DSH home ------------------------------------------------------
$dshHome = $env:DSH_HOME
if (-not $dshHome -or $dshHome.Trim() -eq '') { $dshHome = Join-Path $HOME '.dsh' }
$dshHome = [System.IO.Path]::GetFullPath($dshHome)
Write-Step "DSH_HOME = $dshHome"
if (-not (Test-Path -LiteralPath $dshHome)) {
  Write-Warn "DSH_HOME does not exist yet; open the DSH host once before installing."
}

# ---- resolve CLIs ----------------------------------------------------------
function Resolve-WebCli {
  if ($env:ABG_DSH_WEB_CLI) { return $env:ABG_DSH_WEB_CLI }
  $cmd = Get-Command dsh -ErrorAction SilentlyContinue
  if ($cmd) {
    if ($cmd.Source) { return $cmd.Source }
  }
  # Fall back to the npm global package entry through node.
  $npmRoot = Join-Path $env:APPDATA 'npm\node_modules'
  $binJs = Join-Path $npmRoot '@deepseek-ai\dsh\lib\bin.js'
  if (Test-Path -LiteralPath $binJs) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($node) { return "node `"$binJs`"" }
  }
  return $null
}

function Resolve-DesktopCli {
  if ($env:ABG_DSH_DESKTOP_CLI -and (Test-Path -LiteralPath $env:ABG_DSH_DESKTOP_CLI)) { return $env:ABG_DSH_DESKTOP_CLI }
  foreach ($base in @($env:LOCALAPPDATA, (Join-Path $env:USERPROFILE 'AppData\Local'))) {
    if (-not $base) { continue }
    $candidate = Join-Path $base 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Test-DesktopRunning {
  try {
    $p = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
    return [bool]$p
  } catch { return $false }
}

function Invoke-DshCli {
  param([string]$Cli, [string[]]$Arguments)
  $oldHome = $env:DSH_HOME
  $env:DSH_HOME = $dshHome
  try {
    if ($Cli -match '^(?i)node\s+"?([^"]+)"?$') {
      $binJs = $Matches[1]
      & node $binJs @Arguments | Out-Host
    } elseif ($Cli -match '^(?i)(node|bun)\s+"?([^"]+)"?$') {
      $exe = $Matches[1]
      $entry = $Matches[2]
      & $exe $entry @Arguments | Out-Host
    } else {
      & $Cli @Arguments | Out-Host
    }
    return $LASTEXITCODE
  } finally {
    $env:DSH_HOME = $oldHome
  }
}

# ---- install plugin into a profile ----------------------------------------
function Install-Profile([string]$name, [string]$cli) {
  if (-not $cli) { throw "No DSH CLI found for profile '$name'. Set ABG_DSH_WEB_CLI / ABG_DSH_DESKTOP_CLI." }
  $profileDir = Join-Path $dshHome "profiles\$name"
  if (-not (Test-Path -LiteralPath (Join-Path $profileDir 'package.json'))) {
    Write-Warn "profile '$name' is not initialized yet ($profileDir). DSH normally creates it on first use."
  }
  Write-Step "Installing $PluginPath into profile '$name' via: $cli"
  if ($WhatIfOnly) { Write-Host "  [what-if] $cli plugin --profile $name add `"$PluginPath`""; return $true }
  $code = Invoke-DshCli -Cli $cli -Arguments @('plugin', '--profile', $name, 'add', $PluginPath)
  if ($code -ne 0) {
    Write-Warn "plugin add for '$name' exited with code $code"
    return $false
  }
  # Confirm the bundle ended up in the profile manifest.
  $manifest = Join-Path $profileDir 'package.json'
  if (Test-Path -LiteralPath $manifest) {
    $json = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $bundles = @($json.dsh.profile.bundles)
    if ($bundles -contains '@dsh-external/dsh-client-ui-pair-panel') {
      Write-Host "  OK: bundle selected in $manifest"
    } else {
      Write-Warn "bundle not listed in $manifest — check the CLI output above."
    }
  }
  return $true
}

# ---- MCP patch layer -------------------------------------------------------
$mcpBlock = @"
- insert:
    - id: mcp-agentbridge
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: abg
        transport: streamable-http
        url: $McpUrl
        toolCallTimeoutMs: 300000
"@

function Add-McpRow([string]$patchFile) {
  if ($WhatIfOnly) { Write-Host "  [what-if] add mcp-agentbridge to $patchFile"; return }
  $dir = Split-Path -Parent $patchFile
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $existing = ''
  if (Test-Path -LiteralPath $patchFile) {
    $existing = Get-Content -LiteralPath $patchFile -Raw
    if ($existing -match 'mcp-agentbridge') {
      Write-Host "  OK: mcp-agentbridge already present in $patchFile"
      return
    }
    $backup = "$patchFile.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item -LiteralPath $patchFile -Destination $backup -Force
    Write-Host "  backup: $backup"
  }
  $trimmed = $existing.Trim()
  if ($trimmed -eq '' -or $trimmed -eq '[]') {
    $content = $mcpBlock + "`r`n"
  } else {
    $content = $existing.TrimEnd() + "`r`n`r`n" + $mcpBlock + "`r`n"
  }
  [System.IO.File]::WriteAllText($patchFile, $content, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "  OK: wrote mcp-agentbridge to $patchFile"
}

# ---- main ------------------------------------------------------------------
function Test-ProfileHasBundle([string]$name) {
  $manifest = Join-Path $dshHome "profiles\$name\package.json"
  if (-not (Test-Path -LiteralPath $manifest)) { return $false }
  try {
    $json = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    return (@($json.dsh.profile.bundles) -contains '@dsh-external/dsh-client-ui-pair-panel')
  } catch {
    return $false
  }
}

$targets = @()
if ($Profile -eq 'web' -or $Profile -eq 'both') { $targets += 'web' }
if ($Profile -eq 'desktop' -or $Profile -eq 'both') { $targets += 'desktop' }

$desktopRunning = Test-DesktopRunning
$installedTargets = @()
$failedTargets = @()
foreach ($target in $targets) {
  if ($target -eq 'desktop') {
    if (Test-ProfileHasBundle -name 'desktop') {
      Write-Host "  OK: pair-panel is already installed in the desktop profile"
      $installedTargets += 'desktop'
      continue
    }
    if ($desktopRunning -and $RequireQuit) {
      Write-Warn "DeepSeek Harness is running and -RequireQuit was set. Quit it fully, then re-run. Skipping desktop profile."
      $failedTargets += 'desktop'
      continue
    }
    if ($desktopRunning) {
      Write-Warn "DeepSeek Harness is running; installing into the desktop profile live through the Desktop CLI (the app applies it via HMR). If you prefer a clean install, quit the app and re-run with -RequireQuit."
    }
    $cli = Resolve-DesktopCli
    if (-not $cli) { Write-Warn "Desktop-shipped DSH CLI not found; set ABG_DSH_DESKTOP_CLI. Skipping desktop profile."; $failedTargets += 'desktop'; continue }
    if (Install-Profile -name 'desktop' -cli $cli) { $installedTargets += 'desktop' } else { $failedTargets += 'desktop' }
  } else {
    if (Test-ProfileHasBundle -name 'web') {
      Write-Host "  OK: pair-panel is already installed in the web profile"
      $installedTargets += 'web'
      continue
    }
    $cli = Resolve-WebCli
    if (-not $cli) { Write-Warn "No `dsh` CLI on PATH and npm global install not found; set ABG_DSH_WEB_CLI. Skipping web profile."; $failedTargets += 'web'; continue }
    if (Install-Profile -name 'web' -cli $cli) { $installedTargets += 'web' } else { $failedTargets += 'web' }
  }
}

if ($McpLayer -ne 'none') {
  Write-Step "MCP configuration (layer: $McpLayer)"
  if ($McpLayer -eq 'home') {
    Add-McpRow (Join-Path $dshHome 'cordis.patch.yml')
  } elseif ($installedTargets.Count -eq 0) {
    Write-Warn 'No profile was installed; skipping profile-layer MCP configuration.'
  } else {
    foreach ($target in $installedTargets) {
      Add-McpRow (Join-Path $dshHome "profiles\$target\cordis.patch.yml")
    }
  }
}

Write-Step 'Done'
if ($failedTargets.Count -gt 0) {
  Write-Warn "NOT fully installed. Failed/skipped profiles: $($failedTargets -join ', ')"
  Write-Host "Fix the warnings above and re-run this script (or use the app's Plugins page)."
  exit 2
}
Write-Host @"
Next steps:
  1. Start the agentbridge MCP adapter (it auto-detects the desktop app):
       abg dsh --pair <NAME>            # or: abg dsh mcp --mode channel --http-port 8765
     The panel/MCP tools need an agent-bridge pair: without a running pair the
     panel shows adapter-down/plain mode and mcp__abg__* tools stay unavailable.
  2. DSH host: a live profile applies the bundle through HMR; if you do not see
     the "Codex 面板" toggle in the session header yet, refresh the page (F5).
     After a full app restart the plugin is loaded at boot.
  3. For a `dsh web` deployment, same toggle in the session header after reload.
"@
