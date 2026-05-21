param(
  [switch]$WithTunnel = $true
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StartScript = Join-Path $Root "scripts\Start-NexGenDevStack.ps1"
$TaskName = "NexGen ERP Dev Stack"
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$TunnelArg = if ($WithTunnel) { " -WithTunnel" } else { "" }

$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`"$TunnelArg"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$description = "Starts NexGen backend, desktop dev server, mobile dev server, and optional ngrok tunnel when the Windows user logs in."
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description $description `
  -Force | Out-Null

Write-Host "Installed startup task: $TaskName"
Write-Host "It will run when $CurrentUser logs in."
Write-Host "To start now: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Start-NexGenDevStack.ps1$TunnelArg"
