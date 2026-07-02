param(
  [string]$ServiceName = "NexGenBackend",
  [string]$NssmPath = ""
)

$ErrorActionPreference = "Stop"

function Resolve-Nssm {
  param([string]$RequestedPath)

  if ($RequestedPath) {
    if (-not (Test-Path -LiteralPath $RequestedPath)) {
      throw "NSSM was not found at $RequestedPath"
    }
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  $command = Get-Command "nssm.exe" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  throw "NSSM is required to remove the NexGen service. Install NSSM or pass -NssmPath C:\path\to\nssm.exe"
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
  Write-Host "Service $ServiceName is not installed."
  exit 0
}

if ($service.Status -ne "Stopped") {
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
}

$NssmExe = Resolve-Nssm $NssmPath
& $NssmExe remove $ServiceName confirm | Out-Null
Write-Host "Removed service: $ServiceName"
