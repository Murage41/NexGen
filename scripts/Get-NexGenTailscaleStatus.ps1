param(
  [int]$Port = 3001
)

$ErrorActionPreference = "SilentlyContinue"

function Resolve-Tailscale {
  $command = Get-Command "tailscale.exe" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $defaultPath = "C:\Program Files\Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $defaultPath) { return $defaultPath }

  return $null
}

$tailscale = Resolve-Tailscale
if (-not $tailscale) {
  Write-Host "Tailscale is not installed or tailscale.exe is not in PATH."
  Write-Host "Install: https://tailscale.com/docs/install/windows"
  exit 1
}

Write-Host "Tailscale"
try {
  & $tailscale version | Select-Object -First 1
} catch {
  Write-Host "Version check failed."
}

$statusRaw = & $tailscale status --json 2>$null
if (-not $statusRaw) {
  Write-Host "`nStatus"
  & $tailscale status
  exit 0
}

$status = $statusRaw | ConvertFrom-Json
$self = $status.Self

Write-Host "`nDevice"
[pscustomobject]@{
  HostName = $self.HostName
  DNSName = if ($self.DNSName) { $self.DNSName.TrimEnd(".") } else { "" }
  Online = $self.Online
  TailscaleIPs = ($self.TailscaleIPs -join ", ")
} | Format-List

Write-Host "NexGen URLs"
$names = @()
if ($self.DNSName) { $names += $self.DNSName.TrimEnd(".") }
if ($self.HostName) { $names += $self.HostName }
foreach ($name in ($names | Select-Object -Unique)) {
  Write-Host "  http://$name`:$Port/mobile"
}
foreach ($ip in $self.TailscaleIPs) {
  if ($ip -like "*:*") { continue }
  Write-Host "  http://$ip`:$Port/mobile"
}

Write-Host "`nLocal backend health"
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5 |
    ConvertTo-Json -Depth 4
} catch {
  Write-Host "Backend is not responding on http://127.0.0.1:$Port/api/health"
}
