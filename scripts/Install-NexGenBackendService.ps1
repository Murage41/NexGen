param(
  [string]$ServiceName = "NexGenBackend",
  [string]$NssmPath = "",
  [string]$DataDir = "",
  [string]$EnvFile = "",
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 3001,
  [string]$SessionSecret = "",
  [string]$DesktopKey = "",
  [switch]$Force,
  [switch]$Start
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendDir = Join-Path $Root "backend"
$ServerEntry = Join-Path $BackendDir "dist\index.js"
$MigrationsDir = Join-Path $BackendDir "dist\migrations"
$MobileDist = Join-Path $Root "mobile\dist"
$ProgramDataRoot = Join-Path $env:ProgramData "NexGen"
$Logs = Join-Path $ProgramDataRoot "logs"

if (-not $DataDir) { $DataDir = Join-Path $ProgramDataRoot "data" }
if (-not $EnvFile) { $EnvFile = Join-Path $ProgramDataRoot "backend.env" }

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

  throw "NSSM is required to install NexGen as a Windows service. Install NSSM or pass -NssmPath C:\path\to\nssm.exe"
}

function New-Secret {
  param([int]$Bytes = 32)

  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($buffer)
}

function Assert-ProductionBuild {
  if (-not (Test-Path -LiteralPath $ServerEntry)) {
    throw "Backend build not found at $ServerEntry. Run: cd backend; npm run build"
  }
  if (-not (Test-Path -LiteralPath $MigrationsDir)) {
    throw "Compiled migrations not found at $MigrationsDir. Run: cd backend; npm run build"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $MobileDist "index.html"))) {
    throw "Mobile build not found at $MobileDist. Run: npm run build:mobile"
  }
}

$NssmExe = Resolve-Nssm $NssmPath
$NodeExe = (Get-Command "node.exe" -ErrorAction Stop).Source
Assert-ProductionBuild

New-Item -ItemType Directory -Force -Path $ProgramDataRoot | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

if ((Test-Path -LiteralPath $EnvFile) -and -not $Force) {
  Write-Host "Using existing environment file: $EnvFile"
  Write-Host "Pass -Force to regenerate it."
} else {
  if (-not $SessionSecret) { $SessionSecret = New-Secret 32 }
  if (-not $DesktopKey) { $DesktopKey = New-Secret 24 }

  $envContent = @(
    "NODE_ENV=production",
    "HOST=$HostAddress",
    "PORT=$Port",
    "NEXGEN_DATA_DIR=$DataDir",
    "NEXGEN_MIGRATIONS_DIR=$MigrationsDir",
    "NEXGEN_MOBILE_DIST=$MobileDist",
    "SESSION_SECRET=$SessionSecret",
    "DESKTOP_KEY=$DesktopKey",
    "SESSION_TTL_HOURS=12",
    "LOGIN_MAX_ATTEMPTS=5",
    "LOGIN_WINDOW_MINUTES=15",
    "LOGIN_LOCK_MINUTES=15",
    "CORS_ORIGINS="
  )
  Set-Content -LiteralPath $EnvFile -Value $envContent -Encoding ASCII
  Write-Host "Wrote production environment file: $EnvFile"
}

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
  if (-not $Force) {
    throw "Service $ServiceName already exists. Pass -Force to replace it."
  }

  if ($existingService.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }
  & $NssmExe remove $ServiceName confirm | Out-Null
}

& $NssmExe install $ServiceName $NodeExe "dist/index.js" | Out-Null
& $NssmExe set $ServiceName AppDirectory $BackendDir | Out-Null
& $NssmExe set $ServiceName AppEnvironmentExtra "DOTENV_CONFIG_PATH=$EnvFile" | Out-Null
& $NssmExe set $ServiceName DisplayName "NexGen Backend" | Out-Null
& $NssmExe set $ServiceName Description "NexGen station backend API and local SQLite database service." | Out-Null
& $NssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $NssmExe set $ServiceName AppStdout (Join-Path $Logs "nexgen-backend.out.log") | Out-Null
& $NssmExe set $ServiceName AppStderr (Join-Path $Logs "nexgen-backend.err.log") | Out-Null
& $NssmExe set $ServiceName AppRotateFiles 1 | Out-Null
& $NssmExe set $ServiceName AppRotateOnline 1 | Out-Null
& $NssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null

Write-Host "Installed service: $ServiceName"
Write-Host "Backend: $ServerEntry"
Write-Host "Data: $DataDir"
Write-Host "Logs: $Logs"

if ($Start) {
  Start-Service -Name $ServiceName
  Write-Host "Started service: $ServiceName"
}
