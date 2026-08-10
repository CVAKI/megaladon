# ═══════════════════════════════════════════════════════════════════════════════
#  Megaladon v4.0 — Windows PowerShell Installer
#  Installs Node.js (if needed), copies files, and registers `megaladon` globally.
#  Run as Administrator for system-wide install, or without for user-only.
#  Usage:  powershell -ExecutionPolicy Bypass -File install.ps1
# ═══════════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'

$SHARK  = "`e[38;2;255;200;60m"
$CORAL  = "`e[38;2;255;107;43m"
$KELP   = "`e[38;2;63;200;90m"
$REEF   = "`e[38;2;255;200;60m"
$DIM    = "`e[2m"
$BOLD   = "`e[1m"
$RESET  = "`e[0m"

# Enable VT/ANSI sequences on Windows 10+
try {
    $key = 'HKCU:\Console'
    Set-ItemProperty -Path $key -Name VirtualTerminalLevel -Value 1 -Type DWord -Force
} catch {}

function Write-Shark { param($msg) Write-Host "${SHARK}${BOLD}🦈 Megaladon${RESET}  ${DIM}${msg}${RESET}" }
function Write-Ok    { param($msg) Write-Host "  ${KELP}✔${RESET}  $msg" }
function Write-Warn  { param($msg) Write-Host "  ${REEF}⚠${RESET}  $msg" }
function Write-Err   { param($msg) Write-Host "  `e[38;2;248;81;73m✘${RESET}  $msg" }
function Write-Step  { param($msg) Write-Host "`n${CORAL}  ▸${RESET} $msg" }

Clear-Host
Write-Host ""
Write-Host "  ${SHARK}${BOLD}Megaladon v4.0${RESET}  ${DIM}Windows Installer${RESET}"
Write-Host "  ${DIM}─────────────────────────────────────────────${RESET}"
Write-Host ""

# ── 1. Check Node.js ───────────────────────────────────────────────────────────
Write-Step "Checking Node.js..."
$nodeOk = $false
try {
    $nodeVer = (node --version 2>$null)
    $major   = [int]($nodeVer -replace 'v(\d+).*','$1')
    if ($major -ge 18) {
        Write-Ok "Node.js $nodeVer detected"
        $nodeOk = $true
    } else {
        Write-Warn "Node.js $nodeVer is too old (need ≥ 18)"
    }
} catch {
    Write-Warn "Node.js not found"
}

if (-not $nodeOk) {
    Write-Step "Downloading Node.js LTS installer..."
    $nodeUrl = "https://nodejs.org/dist/lts/node-lts-x64.msi"
    $nodeMsi = "$env:TEMP\node-lts-x64.msi"
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        Write-Ok "Downloaded Node.js LTS"
        Write-Step "Installing Node.js (this may take a moment)..."
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn /norestart" -Wait
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path','User')
        $nodeVer = (node --version 2>$null)
        Write-Ok "Node.js $nodeVer installed"
    } catch {
        Write-Err "Could not install Node.js automatically."
        Write-Host "  Please install manually from https://nodejs.org and re-run this script."
        exit 1
    }
}

# ── 2. Determine install directory ────────────────────────────────────────────
Write-Step "Choosing install location..."
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    $installDir = "C:\Program Files\Megaladon"
    $binDir     = "C:\Program Files\Megaladon\bin"
    Write-Ok "System-wide install → $installDir"
} else {
    $installDir = "$env:LOCALAPPDATA\Megaladon"
    $binDir     = "$env:LOCALAPPDATA\Megaladon\bin"
    Write-Ok "User install → $installDir"
}

# ── 3. Copy files ─────────────────────────────────────────────────────────────
Write-Step "Copying Megaladon files..."
$srcDir = $PSScriptRoot
$dirs   = @('bin','lib')
foreach ($d in $dirs) {
    $dst = Join-Path $installDir $d
    if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
    Get-ChildItem -Path (Join-Path $srcDir $d) -File | ForEach-Object {
        Copy-Item $_.FullName -Destination $dst -Force
    }
}
# Copy package.json and README
foreach ($f in @('package.json','README.md')) {
    $src = Join-Path $srcDir $f
    if (Test-Path $src) { Copy-Item $src -Destination $installDir -Force }
}
Write-Ok "Files copied to $installDir"

# ── 4. npm install ────────────────────────────────────────────────────────────
Write-Step "Running npm install..."
Push-Location $installDir
try {
    npm install --omit=dev --quiet 2>&1 | Out-Null
    Write-Ok "Dependencies installed"
} catch {
    Write-Warn "npm install had issues — Megaladon uses only built-in modules, so this may be fine"
} finally {
    Pop-Location
}

# ── 5. Create launcher script ─────────────────────────────────────────────────
Write-Step "Creating launcher..."
$launcherDir = "$env:LOCALAPPDATA\Megaladon-launcher"
if (-not (Test-Path $launcherDir)) { New-Item -ItemType Directory -Path $launcherDir -Force | Out-Null }

$launcherCmd = @"
@echo off
node "$installDir\bin\meg.js" %*
"@
$launcherPs1 = @"
#!/usr/bin/env node
// Megaladon launcher
"@

$cmdPath = Join-Path $launcherDir "megaladon.cmd"
Set-Content -Path $cmdPath -Value $launcherCmd -Encoding ASCII
Write-Ok "Launcher created at $cmdPath"

# ── 6. Add to PATH ────────────────────────────────────────────────────────────
Write-Step "Adding to PATH..."
$target = if ($isAdmin) { 'Machine' } else { 'User' }
$currentPath = [System.Environment]::GetEnvironmentVariable('Path', $target)
if ($currentPath -notlike "*$launcherDir*") {
    [System.Environment]::SetEnvironmentVariable('Path', $currentPath + ';' + $launcherDir, $target)
    $env:Path += ';' + $launcherDir
    Write-Ok "PATH updated ($target)"
} else {
    Write-Ok "Already in PATH"
}

# ── 7. Done ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ${DIM}─────────────────────────────────────────────${RESET}"
Write-Host "  ${KELP}${BOLD}Installation complete!${RESET}"
Write-Host ""
Write-Host "  Start a new terminal and run:  ${SHARK}${BOLD}megaladon${RESET}"
Write-Host "  Or run now:                    ${SHARK}${BOLD}node `"$installDir\bin\meg.js`"${RESET}"
Write-Host ""
Write-Host "  ${DIM}Tip: megaladon --help  •  megaladon --reset  •  megaladon --version${RESET}"
Write-Host ""

# Offer to launch immediately
$launch = Read-Host "  Launch Megaladon now? [Y/n]"
if ($launch -eq '' -or $launch -match '^[Yy]') {
    Write-Host ""
    & node "$installDir\bin\meg.js"
}