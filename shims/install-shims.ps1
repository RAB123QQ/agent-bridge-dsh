<#
  install-shims.ps1 -- installs the abg / dsh / chromium Windows shims from
  the *.template files in this directory into a real bin directory on PATH
  (default: %USERPROFILE%\.bun\bin, bun's default install location).

  What it does, per shim:
    - abg.cmd / abg.ps1   : replace %ADAPTER_PATH% with the agentbridge-dsh
                             bin\abg-dsh path (given via -AdapterPath, or
                             $env:AGENTBRIDGE_DSH_DIR\bin\abg-dsh).
    - chromium.cmd        : replace %CHROME_EXE% with an auto-detected
                             chrome.exe/chromium.exe (or -ChromeExe).
    - dsh.cmd             : replace %NODE_EXE% and %DSH_BIN_JS% with an
                             auto-detected node.exe and the newest
                             @deepseek-ai/dsh install found in the npm/npx
                             caches (or -NodeExe / -DshBinJs).

  Every shim is optional -- pass -Shims to install only a subset, e.g.
  -Shims abg.cmd,abg.ps1 if you don't need the dsh/chromium ones.

  Usage:
    ./install-shims.ps1
    ./install-shims.ps1 -BinDir 'C:\tools\bin' -AdapterPath 'C:\src\agentbridge-dsh\bin\abg-dsh'
    ./install-shims.ps1 -Shims abg.cmd,abg.ps1,chromium.cmd

  Parameters:
    -BinDir <path>       target directory for installed shims
                         (default: $env:USERPROFILE\.bun\bin)
    -AdapterPath <path>  agentbridge-dsh bin\abg-dsh path
                         (default: $env:AGENTBRIDGE_DSH_DIR\bin\abg-dsh)
    -ChromeExe <path>    chrome/chromium executable for chromium.cmd
                         (default: auto-detect)
    -NodeExe <path>      node.exe for dsh.cmd (default: auto-detect via `where`)
    -DshBinJs <path>     path to @deepseek-ai/dsh/lib/bin.js for dsh.cmd
                         (default: auto-detect from npm/npx caches)
    -Shims <string[]>    which templates to install
                         (default: all four: abg.cmd, abg.ps1, dsh.cmd, chromium.cmd)
#>
param(
    [string]$BinDir = '',
    [string]$AdapterPath = '',
    [string]$ChromeExe = '',
    [string]$NodeExe = '',
    [string]$DshBinJs = '',
    [string[]]$Shims = @('abg.cmd', 'abg.ps1', 'dsh.cmd', 'chromium.cmd')
)

$ErrorActionPreference = 'Stop'
$templateDir = $PSScriptRoot
if (-not $templateDir) { $templateDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

if (-not $BinDir) { $BinDir = Join-Path $env:USERPROFILE '.bun\bin' }
if (-not (Test-Path -LiteralPath $BinDir)) {
    Write-Host "Creating bin directory: $BinDir"
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}

function Find-OnPath([string]$name) {
    $out = & where.exe $name 2>$null
    if (-not $out) { return $null }
    foreach ($line in ($out -split "`r?`n")) {
        $t = $line.Trim()
        if ($t -and (Test-Path -LiteralPath $t)) { return $t }
    }
    return $null
}

function Resolve-AdapterPath([string]$override) {
    if ($override) { return $override }
    if ($env:AGENTBRIDGE_DSH_DIR) { return (Join-Path $env:AGENTBRIDGE_DSH_DIR 'bin\abg-dsh') }
    return $null
}

function Resolve-ChromeExe([string]$override) {
    if ($override -and (Test-Path -LiteralPath $override)) { return $override }
    if ($env:DSH_CHROME_EXE -and (Test-Path -LiteralPath $env:DSH_CHROME_EXE)) { return $env:DSH_CHROME_EXE }
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    $onPath = Find-OnPath 'chrome.exe'
    if ($onPath) { return $onPath }
    $onPath = Find-OnPath 'chromium.exe'
    if ($onPath) { return $onPath }
    return $null
}

function Resolve-NodeExe([string]$override) {
    if ($override -and (Test-Path -LiteralPath $override)) { return $override }
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

function Resolve-DshBinJs([string]$override) {
    if ($override -and (Test-Path -LiteralPath $override)) { return $override }
    # 1) global npm install
    $globalBin = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh\lib\bin.js'
    if (Test-Path -LiteralPath $globalBin) { return $globalBin }
    # 2) newest entry in the npx cache
    $cacheRoot = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
    if (Test-Path $cacheRoot) {
        $found = Get-ChildItem $cacheRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $bin = Join-Path $_.FullName 'node_modules\@deepseek-ai\dsh\lib\bin.js'
            if (Test-Path $bin) { Get-Item $bin }
        } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Install-Shim([string]$templateName, [hashtable]$replacements) {
    $srcPath = Join-Path $templateDir $templateName
    if (-not (Test-Path -LiteralPath $srcPath)) {
        Write-Warning "Template not found, skipping: $srcPath"
        return
    }
    $destName = $templateName -replace '\.template$', ''
    $destPath = Join-Path $BinDir $destName
    $content = Get-Content -LiteralPath $srcPath -Raw
    foreach ($key in $replacements.Keys) {
        $value = $replacements[$key]
        if (-not $value) {
            Write-Warning "$destName : could not resolve $key, leaving placeholder in place - edit $destPath by hand or re-run with the matching -Parameter."
            continue
        }
        $content = $content.Replace($key, $value)
    }
    Set-Content -LiteralPath $destPath -Value $content -Encoding ASCII -NoNewline
    Write-Host "Installed: $destPath"
}

foreach ($shim in $Shims) {
    switch ($shim) {
        'abg.cmd' {
            $adapter = Resolve-AdapterPath $AdapterPath
            Install-Shim 'abg.cmd.template' @{ '%ADAPTER_PATH%' = $adapter }
        }
        'abg.ps1' {
            $adapter = Resolve-AdapterPath $AdapterPath
            Install-Shim 'abg.ps1.template' @{ '%ADAPTER_PATH%' = $adapter }
        }
        'chromium.cmd' {
            $chrome = Resolve-ChromeExe $ChromeExe
            Install-Shim 'chromium.cmd.template' @{ '%CHROME_EXE%' = $chrome }
        }
        'dsh.cmd' {
            $node = Resolve-NodeExe $NodeExe
            $bin = Resolve-DshBinJs $DshBinJs
            Install-Shim 'dsh.cmd.template' @{ '%NODE_EXE%' = $node; '%DSH_BIN_JS%' = $bin }
        }
        default {
            Write-Warning "Unknown shim name: $shim (expected one of abg.cmd, abg.ps1, dsh.cmd, chromium.cmd)"
        }
    }
}

Write-Host ''
Write-Host "Done. Make sure $BinDir is on your PATH."
