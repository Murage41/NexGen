param(
  [string]$ServiceName = "NexGenBackend",
  [string]$HealthUrl = "http://127.0.0.1:3001/api/health",
  [string]$EnvFile = ""
)

$ErrorActionPreference = "SilentlyContinue"

$ProgramDataRoot = Join-Path $env:ProgramData "NexGen"
if (-not $EnvFile) { $EnvFile = Join-Path $ProgramDataRoot "backend.env" }

Write-Host "Service"
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  $service | Select-Object Name, Status, StartType | Format-Table -AutoSize
} else {
  Write-Host "Service $ServiceName is not installed."
}

Write-Host "`nBackend health"
try {
  Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5 | ConvertTo-Json -Depth 4
} catch {
  Write-Host "Backend is not responding at $HealthUrl"
}

Write-Host "`nEnvironment"
if (Test-Path -LiteralPath $EnvFile) {
  Get-Content -LiteralPath $EnvFile |
    Where-Object { $_ -match "^(NODE_ENV|HOST|PORT|NEXGEN_DATA_DIR|NEXGEN_MIGRATIONS_DIR|NEXGEN_MOBILE_DIST)=" }
} else {
  Write-Host "Environment file not found: $EnvFile"
}

Write-Host "`nLogs"
$logs = Join-Path $ProgramDataRoot "logs"
if (Test-Path -LiteralPath $logs) {
  Get-ChildItem -LiteralPath $logs -File | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
} else {
  Write-Host "Log directory not found: $logs"
}
