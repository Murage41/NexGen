param(
  [switch]$WithTunnel = $true,
  [int]$DelaySeconds = 45
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StartScript = Join-Path $Root "scripts\Start-NexGenStationStack.ps1"
$TaskName = "NexGen ERP Station Stack"
$OldTaskName = "NexGen ERP Dev Stack"
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$TunnelArg = if ($WithTunnel) { " -WithTunnel" } else { "" }

$oldTask = Get-ScheduledTask -TaskName $OldTaskName -ErrorAction SilentlyContinue
if ($oldTask) {
  Unregister-ScheduledTask -TaskName $OldTaskName -Confirm:$false
  Write-Host "Removed old startup task: $OldTaskName"
}

$actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`"$TunnelArg"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
if ($DelaySeconds -gt 0) {
  $trigger.Delay = "PT${DelaySeconds}S"
}
$principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$description = "Starts NexGen backend, desktop dev server, and optional ngrok tunnel when the Windows user logs in. Mobile is served from the backend /mobile build."
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

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
Write-Host "Startup delay: $DelaySeconds seconds."
Write-Host "To start now: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Start-NexGenStationStack.ps1$TunnelArg"
Write-Host "To verify: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Get-NexGenStatus.ps1"
