<#
  DSH + agentbridge-dsh launcher (launch-dsh.ps1)

  One-click launcher for the DeepSeek Harness (DSH) web GUI plus the
  agentbridge-dsh adapter (Codex peer bridge + MCP tools + dsh-pair-panel).

  What it does:
    1. Check whether the dsh web server is already running on 127.0.0.1:<Port>.
    2. If not, start it in the background (hidden window) and wait until ready.
    3. Check whether the agentbridge-dsh pair daemon's MCP adapter is already
       serving on <McpPort>. If not (and the pair control port is alive),
       start `abg dsh --pair <PairName>` in the background.
    4. Open the DSH app window (Chrome/Chromium as an --app= window).

  This script is meant to be launched by launch-dsh.vbs (hidden window, no
  console flash), which is what a desktop shortcut would point to.

  Server start strategy for dsh web:
    - Preferred: run the dsh CLI directly from a locally installed
      @deepseek-ai/dsh (global npm install, or the newest npx cache entry).
      This is offline and instant.
    - Fallback: `npx --yes @deepseek-ai/dsh web` (may need network on first use).

  Nothing in this file is machine-specific: every path is either resolved
  from an environment variable, auto-detected via `where`/well-known install
  locations, or passed in as a -Parameter. If something cannot be found, the
  script prints a clear error telling you which variable/parameter to set
  instead of silently guessing a hardcoded path.

  Parameters:
    -Port <int>          dsh web port (default 3080, or $env:DSH_PORT)
    -NoOpen               do not open the browser/app window after ready
    -NoStart              do not start anything; only report current status
    -WorkDir <path>       dsh web server working directory
                          (default: $env:DSH_WORKDIR, else $env:USERPROFILE)
    -PairDir <path>       agentbridge-dsh checkout directory
                          (default: $env:AGENTBRIDGE_DSH_DIR)
    -PairName <string>    agent-bridge pair name to bridge in
                          (default: $env:AGENTBRIDGE_DSH_PAIR)
    -ChromeAppId <string> installed Chrome PWA app id, for a chrome://apps
                          style window instead of a plain browser tab
                          (default: $env:DSH_CHROME_APP_ID, optional)
    -NodeExe <path>       node.exe to use (default: auto-detect via `where`)
    -ChromeExe <path>     chrome.exe / chrome_proxy.exe to use (auto-detect)
    -DshHome <path>       DSH_HOME env value for the server process
                          (default: $env:DSH_HOME, else "<USERPROFILE>\.dsh")

  Non-ASCII working directories:
  If your work directory contains non-ASCII characters (e.g. Chinese), do
  NOT type them directly into this file if you save it without a UTF-8 BOM
  -- Windows PowerShell 5.1 will misdecode a BOM-less UTF-8 file as
  ANSI/GBK and mangle the characters. Build the path from Unicode char
  codes instead, for example:
    $seg = [string][char]0x7535 + [string][char]0x8D5B   # -> "dian sai"
    $WorkDir = Join-Path $env:USERPROFILE ('Desktop\' + $seg)
  Pass the char-code-built value via -WorkDir, or set $env:DSH_WORKDIR from
  a launcher that is itself UTF-8 safe (e.g. the .vbs wrapper, or Git Bash).
#>
param(
    [int]$Port = 0,
    [switch]$NoOpen,
    [switch]$NoStart,
    [string]$WorkDir = '',
    [string]$PairDir = '',
    [string]$PairName = '',
    [string]$ChromeAppId = '',
    [string]$NodeExe = '',
    [string]$ChromeExe = '',
    [string]$DshHome = ''
)

$ErrorActionPreference = 'SilentlyContinue'

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

# ============================================================================
# CONFIG -- resolved once at the top. Every value here comes from an explicit
# -Parameter, an environment variable, or auto-detection. Nothing below this
# block should ever need editing for a specific machine.
# ============================================================================

if ($Port -le 0) {
    $Port = 3080
    if ($env:DSH_PORT) { [int]::TryParse($env:DSH_PORT, [ref]$Port) | Out-Null }
}
$url = "http://127.0.0.1:$Port"
$logFile = Join-Path $scriptDir 'launch-dsh.log'

function Write-Log([string]$msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Find-OnPath([string]$name) {
    # `where.exe` (not the where.exe-shadowing PS alias) returns every match,
    # one per line; take the first that actually exists.
    $out = & where.exe $name 2>$null
    if (-not $out) { return $null }
    foreach ($line in ($out -split "`r?`n")) {
        $t = $line.Trim()
        if ($t -and (Test-Path -LiteralPath $t)) { return $t }
    }
    return $null
}

function Resolve-NodeExe([string]$override) {
    if ($override -and (Test-Path -LiteralPath $override)) { return $override }
    if ($env:DSH_NODE_EXE -and (Test-Path -LiteralPath $env:DSH_NODE_EXE)) { return $env:DSH_NODE_EXE }
    $onPath = Find-OnPath 'node.exe'
    if ($onPath) { return $onPath }
    $candidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    return $null
}

function Resolve-ChromeExe([string]$override) {
    if ($override -and (Test-Path -LiteralPath $override)) { return $override }
    if ($env:DSH_CHROME_EXE -and (Test-Path -LiteralPath $env:DSH_CHROME_EXE)) { return $env:DSH_CHROME_EXE }
    # chrome_proxy.exe is what an installed PWA shortcut actually launches;
    # prefer it when present, otherwise fall back to plain chrome.exe.
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome_proxy.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome_proxy.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    $onPath = Find-OnPath 'chrome.exe'
    if ($onPath) { return $onPath }
    return $null
}

function Resolve-BunBin([string]$name) {
    # bun's default install location on Windows is %USERPROFILE%\.bun\bin.
    $home1 = Join-Path $env:USERPROFILE ".bun\bin\$name"
    if (Test-Path -LiteralPath $home1) { return $home1 }
    $onPath = Find-OnPath $name
    if ($onPath) { return $onPath }
    return $null
}

$nodeExe = Resolve-NodeExe $NodeExe
$chrome = Resolve-ChromeExe $ChromeExe

if (-not $WorkDir) { $WorkDir = if ($env:DSH_WORKDIR) { $env:DSH_WORKDIR } else { $env:USERPROFILE } }
if (-not $DshHome) { $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' } }
if (-not $PairDir) { $PairDir = $env:AGENTBRIDGE_DSH_DIR }
if (-not $PairName) { $PairName = $env:AGENTBRIDGE_DSH_PAIR }
if (-not $ChromeAppId) { $ChromeAppId = $env:DSH_CHROME_APP_ID }

$abgCmd = Resolve-BunBin 'abg.cmd'
$mcpPort = if ($env:AGENTBRIDGE_DSH_MCP_PORT) { [int]$env:AGENTBRIDGE_DSH_MCP_PORT } else { 8765 }
$ctlPort = if ($env:AGENTBRIDGE_DSH_CONTROL_PORT) { [int]$env:AGENTBRIDGE_DSH_CONTROL_PORT } else { 4512 }
$timeoutS = 120   # max seconds to wait for dsh web's first boot

# ============================================================================
# end CONFIG
# ============================================================================

function Test-PortListening([int]$port) {
    # Get-NetTCPConnection is CIM-backed and costs ~100-300ms per call because
    # it spins up a CIM provider every time; this runs on every poll below,
    # so use the direct P/Invoke table instead (~1ms).
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    foreach ($l in $listeners) { if ($l.Port -eq $port) { return $true } }
    return $false
}

function Test-HttpUp([string]$uri) {
    try {
        Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Is-ServerUp {
    # PowerShell's -or does not short-circuit, so write this as explicit
    # branches: skip the HTTP round-trip whenever the port check already
    # proves the server is up.
    if (Test-PortListening $Port) { return $true }
    return (Test-HttpUp $url)
}

function Test-PwaWindowOpen([string]$id) {
    if (-not $id) { return $false }
    # Get-Process is a cheap local process-table read; only pay for
    # Get-CimInstance (spins up the WMI provider host, ~150-400ms) when some
    # chrome/chrome_proxy process actually exists to inspect.
    if (-not (Get-Process -Name 'chrome', 'chrome_proxy' -ErrorAction SilentlyContinue)) { return $false }
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='chrome_proxy.exe'" -ErrorAction SilentlyContinue
        foreach ($p in $procs) {
            if ($p.CommandLine -and $p.CommandLine -like ('*--app-id=' + $id + '*')) {
                $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
                if ($proc -and $proc.MainWindowHandle -ne 0) { return $true }
            }
        }
    } catch {}
    return $false
}

function Resolve-DshCommand([int]$port) {
    if (-not $nodeExe) { return $null }
    $portFlag = if ($port -ne 3080) { ' --port ' + $port } else { '' }

    # Fast path: reuse the bin.js path found by a previous run instead of
    # rescanning the whole npm cache every launch. Self-heals if the
    # remembered file has since been removed.
    $pathCacheFile = Join-Path $scriptDir 'dsh-path.cache'
    if (Test-Path $pathCacheFile) {
        $cachedBin = Get-Content -Path $pathCacheFile -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cachedBin -and (Test-Path $cachedBin)) {
            Write-Log "Using cached dsh (dsh-path.cache): $cachedBin"
            return ('"{0}" "{1}" web{2}' -f $nodeExe, $cachedBin, $portFlag)
        }
    }

    # 1) global npm install: %APPDATA%\npm\node_modules\@deepseek-ai\dsh
    $globalBin = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\lib\bin.js'
    if (Test-Path -LiteralPath $globalBin) {
        Write-Log "Using global npm install: $globalBin"
        Set-Content -Path $pathCacheFile -Value $globalBin -Encoding ASCII
        return ('"{0}" "{1}" web{2}' -f $nodeExe, $globalBin, $portFlag)
    }

    # 2) npx cache: %LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\@deepseek-ai\dsh
    $cacheRoot = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
    $dshBins = @()
    if (Test-Path $cacheRoot) {
        $dshBins = @(Get-ChildItem $cacheRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $bin = Join-Path $_.FullName 'node_modules\@deepseek-ai\dsh\lib\bin.js'
                if (Test-Path $bin) { Get-Item $bin }
            } | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
    }
    if ($dshBins.Count -gt 0 -and $dshBins[0]) {
        $bin = $dshBins[0].FullName
        Write-Log "Using cached dsh (npx cache): $bin"
        Set-Content -Path $pathCacheFile -Value $bin -Encoding ASCII
        return ('"{0}" "{1}" web{2}' -f $nodeExe, $bin, $portFlag)
    }

    # 3) fallback: npx resolves @deepseek-ai/dsh (may need network first time)
    $npxPath = Find-OnPath 'npx.cmd'
    if (-not $npxPath) { return $null }
    Write-Log "Using npx fallback: $npxPath"
    return ('"{0}" --yes @deepseek-ai/dsh web{1}' -f $npxPath, $portFlag)
}

Write-Log '=================================================='
Write-Log "launch-dsh.ps1 started (port $Port)"

if (-not $nodeExe) {
    Write-Log 'ERROR: node.exe not found. Set -NodeExe, or $env:DSH_NODE_EXE, or install Node.js.'
    Write-Error 'node.exe not found. Pass -NodeExe <path>, set $env:DSH_NODE_EXE, or install Node.js so it is on PATH.'
    exit 1
}

$justStarted = $false
$dshNeedsWait = $false
if (Is-ServerUp) {
    Write-Log 'Server is already running - skipping start.'
} elseif ($NoStart) {
    Write-Log 'NoStart switch set - server is NOT running, not starting it.'
    exit 1
} else {
    $serverCmd = Resolve-DshCommand $Port
    if (-not $serverCmd) {
        Write-Log 'ERROR: could not locate the dsh CLI (no global install, no npx cache entry, and npx.cmd not found on PATH).'
        Write-Error 'Could not locate the dsh CLI. Install it with `npm install -g @deepseek-ai/dsh`, or ensure npx is on PATH.'
        exit 1
    }

    $env:DSH_HOME = $DshHome
    $env:npm_config_prefer_offline = 'true'
    if (-not (Test-Path $WorkDir)) { $WorkDir = $env:USERPROFILE }

    # Generate a tiny .cmd file that runs the server with output captured.
    # (Do NOT pass complex quoted strings through Start-Process -ArgumentList:
    # Windows PowerShell 5.1 mangles embedded quotes, so the server would
    # never start. A generated .cmd avoids all quoting issues.)
    $serverLog = Join-Path $scriptDir 'dsh-web.log'
    $cmdFile = Join-Path $scriptDir 'start-dsh-server.cmd'
    $cmdContent = '@echo off' + [Environment]::NewLine +
    $serverCmd + ' >> "%~dp0dsh-web.log" 2>&1' + [Environment]::NewLine
    Set-Content -Path $cmdFile -Value $cmdContent -Encoding ASCII
    Write-Log "Starting server (workdir: $WorkDir): $cmdContent"
    try {
        Start-Process -FilePath $cmdFile -WorkingDirectory $WorkDir -WindowStyle Hidden -ErrorAction Stop
    } catch {
        Write-Log "ERROR starting server: $($_.Exception.Message)"
        exit 1
    }
    $dshNeedsWait = $true
    $justStarted = $true
}

# Wait for the dsh server to come up (first boot can take a while). Poll at
# 200ms: the check itself is cheap (TCP connect, HTTP only as fallback) and
# a tighter interval shaves real time off a warm start.
if ($dshNeedsWait) {
    $deadline = (Get-Date).AddSeconds($timeoutS)
    $up = $false
    while ((Get-Date) -lt $deadline) {
        if (Is-ServerUp) { $up = $true; break }
        Start-Sleep -Milliseconds 200
    }
    if ($up) {
        Write-Log "Server is ready at $url"
    } else {
        Write-Log 'ERROR: server did not become ready in time. See dsh-web.log.'
        exit 1
    }
}

# --- agentbridge-dsh: keep the Codex peer side alive (panel + MCP tools) ---
# Optional: only attempted when both $PairDir and $PairName are configured.
# Requires the agent-bridge pair daemon to already be running (started once
# per boot from a terminal, e.g. `abg codex --pair <name>`); this launcher
# never starts the daemon itself.
if (-not $PairDir -or -not $PairName) {
    Write-Log 'agentbridge: skipped (set -PairDir/-PairName or $env:AGENTBRIDGE_DSH_DIR / $env:AGENTBRIDGE_DSH_PAIR to enable).'
} elseif (-not (Test-Path -LiteralPath $PairDir)) {
    Write-Log "agentbridge: ERROR PairDir not found: $PairDir"
} elseif (-not $abgCmd) {
    Write-Log 'agentbridge: ERROR abg.cmd not found (install agent-bridge, or set it up under %USERPROFILE%\.bun\bin).'
} else {
    $daemonUp = Test-PortListening $ctlPort
    $abgNeedsWait = $false
    if (-not $daemonUp) {
        Write-Log "agentbridge: pair daemon NOT running on control port $ctlPort - start it once per boot in a terminal: abg codex --pair $PairName"
    } elseif ($NoStart) {
        Write-Log 'agentbridge: NoStart switch set - not starting abg dsh (check only).'
    } elseif (Test-PortListening $mcpPort) {
        Write-Log "agentbridge: abg dsh already serving on port $mcpPort (skip)."
    } else {
        $abgLog = Join-Path $scriptDir 'abg-dsh.log'
        $abgCmdFile = Join-Path $scriptDir 'start-abg-dsh.cmd'
        $cmdContent = '@echo off' + [Environment]::NewLine +
        'cd /d "' + $PairDir + '"' + [Environment]::NewLine +
        '"' + $abgCmd + '" dsh --pair ' + $PairName + ' >> "' + $abgLog + '" 2>&1' + [Environment]::NewLine
        Set-Content -Path $abgCmdFile -Value $cmdContent -Encoding ASCII
        Write-Log "agentbridge: starting abg dsh --pair $PairName (detached): $cmdContent"
        try {
            Start-Process -FilePath $abgCmdFile -WorkingDirectory $PairDir -WindowStyle Hidden -ErrorAction Stop
        } catch {
            Write-Log "agentbridge: ERROR starting abg dsh: $($_.Exception.Message)"
        }
        $abgNeedsWait = $true
    }

    # Wait for abg dsh to come up. It has been booting in the background since
    # before the dsh wait above, so this usually resolves on the first check.
    if ($abgNeedsWait) {
        $mcpDeadline = (Get-Date).AddSeconds(30)
        $mcpUp = $false
        while ((Get-Date) -lt $mcpDeadline) {
            if (Test-PortListening $mcpPort) { $mcpUp = $true; break }
            Start-Sleep -Milliseconds 200
        }
        if ($mcpUp) { Write-Log "agentbridge: abg dsh ready on http://127.0.0.1:$mcpPort/mcp" }
        else { Write-Log 'agentbridge: abg dsh did not become ready in time; see abg-dsh.log' }
    }
}

# Small pause so the UI settles, but only right after a cold start - if the
# server was already up there is nothing to settle, so skip the wait.
if ($justStarted) { Start-Sleep -Seconds 2 }
if ($NoOpen) {
    Write-Log 'NoOpen switch set - not opening the browser window.'
} elseif (Test-PwaWindowOpen $ChromeAppId) {
    Write-Log 'DSH app window already open - skipping.'
} elseif ($chrome -and (Test-Path -LiteralPath $chrome)) {
    if ($ChromeAppId) {
        Write-Log 'Opening DSH app window (Chrome PWA).'
        Start-Process -FilePath $chrome -ArgumentList "--profile-directory=Default --app-id=$ChromeAppId"
    } else {
        Write-Log "Opening DSH app window (chrome --app=$url)."
        Start-Process -FilePath $chrome -ArgumentList "--app=$url"
    }
} else {
    Write-Log "Chrome not found - opening default browser at $url"
    Start-Process $url
}
Write-Log 'launch-dsh.ps1 finished.'
