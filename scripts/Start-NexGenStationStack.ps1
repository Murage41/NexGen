param(
  [switch]$WithTunnel
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Logs = Join-Path $Root "logs"
$LogFile = Join-Path $Logs "nexgen-station-stack.log"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Test-PortListening {
  param([int]$Port)
  $connection = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port } |
    Select-Object -First 1
  return $null -ne $connection
}

if (Test-PortListening -Port 3001) {
  Write-Host "NexGen backend already appears to be running on port 3001."
  Write-Host "Use scripts\Get-NexGenStatus.ps1 for details, or scripts\Stop-NexGenLocal.ps1 before restarting."
  exit 0
}

$npmCommand = if ($WithTunnel) { "npm run station:tunnel" } else { "npm run station" }
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LogFile -Value "`n[$timestamp] Starting NexGen station stack: $npmCommand"

$cmdArgs = "/c cd /d `"$Root`" && $npmCommand >> `"$LogFile`" 2>&1"
Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -WindowStyle Hidden

Write-Host "NexGen station stack started in the background."
Write-Host "Log file: $LogFile"
Write-Host "Status: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Get-NexGenStatus.ps1"
