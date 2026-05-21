$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*$Root*") -or
    ($_.Name -eq "cmd.exe" -and $_.CommandLine -like "*$Root*") -or
    ($_.Name -eq "ngrok.exe" -and $_.CommandLine -like "*nexgen*")
  }

if (-not $processes) {
  Write-Host "No local NexGen node/ngrok processes found."
  exit 0
}

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

$processes | Select-Object ProcessId, Name, CommandLine
Write-Host "Stopped local NexGen processes."
