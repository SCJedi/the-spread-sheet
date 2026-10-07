<#
  Starts a local dev server on an empty database, or stops one, and refuses to report "ready" unless
  the server on that port is the one it just started and its database is genuinely empty.

  Why: a dev server left running keeps its port and its data. A later test then talks to the old
  server and fails in confusing ways ("join code is not right", internal D1 errors, stale weeks).
  This script frees the port first, checks it is free, and verifies the database is empty.

  Usage:
    powershell -File scripts/fresh-dev.ps1 -Port 8788                   # fresh normal install
    powershell -File scripts/fresh-dev.ps1 -Port 8790 -Config wrangler.demo.toml -Demo
    powershell -File scripts/fresh-dev.ps1 -Port 8791 -Vars "RECOVERY_PIN:4321"
    powershell -File scripts/fresh-dev.ps1 -Port 8788 -Stop             # stop it and confirm the port is free
#>
param(
  [Parameter(Mandatory = $true)][int]$Port,
  [string]$Config = 'wrangler.toml',
  [string[]]$Vars = @(),
  [switch]$Demo,
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$state = Join-Path ([IO.Path]::GetTempPath()) "spread-sheet-dev-$Port"
$log = "$state.log"

function Stop-Port([int]$p) {
  foreach ($c in @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) {
    # Kill the whole wrangler tree (node -> workerd), not just the process holding the socket.
    $id = $c.OwningProcess; $top = $id
    for ($i = 0; $i -lt 6; $i++) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
      if (-not $proc) { break }
      if ($proc.CommandLine -match 'wrangler') { $top = $id }
      $id = $proc.ParentProcessId
    }
    # Children may already be exiting; taskkill's complaints about them are harmless, so run it through cmd quietly.
    cmd.exe /c "taskkill /PID $top /T /F >nul 2>&1" | Out-Null
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "Port $p is still in use after stopping its processes. Free it by hand before testing."
}

Stop-Port $Port
if ($Stop) { "STOPPED port $Port (free)"; exit 0 }

if (Test-Path $state) { Remove-Item -Recurse -Force $state }
$varArgs = ($Vars | ForEach-Object { "--var $_" }) -join ' '
$cmd = "cd /d `"$root`" && npx wrangler dev -c $Config --port $Port --persist-to `"$state`" $varArgs > `"$log`" 2>&1"
Start-Process -FilePath cmd.exe -ArgumentList '/c', $cmd -WindowStyle Hidden | Out-Null

$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { Start-Sleep -Milliseconds 700 }
}
if (-not $ok) { throw "Server on port $Port did not start. Log: $log" }

$s = Invoke-RestMethod "http://127.0.0.1:$Port/api/state" -TimeoutSec 30
if (-not $Demo -and -not $s.league.needs_setup) { throw "Port $Port answered with a database that already has players: not the fresh server. Log: $log" }
if ($Demo -and -not $s.league.demo) { throw "Port $Port is not running in demo mode. Log: $log" }
"READY port $Port, fresh database, week $($s.league.current_week). Log: $log"
