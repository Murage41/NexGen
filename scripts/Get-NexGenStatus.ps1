$ErrorActionPreference = "SilentlyContinue"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Host "Expected station mode ports: backend 3001, desktop 5173, ngrok inspector 4040."
Write-Host "Port 5174 is the mobile Vite dev server and is only expected in full dev mode.`n"

Write-Host "Startup tasks"
foreach ($TaskName in @("NexGen ERP Station Stack", "NexGen ERP Dev Stack")) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    [PSCustomObject]@{
      TaskName = $TaskName
      State = $task.State
      LastRunTime = $info.LastRunTime
      LastTaskResult = $info.LastTaskResult
      NextRunTime = $info.NextRunTime
    }
  }
}
Write-Host ""

Write-Host "Ports"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 3001, 4040, 5173, 5174 } |
  Select-Object LocalAddress, LocalPort, OwningProcess |
  Format-Table -AutoSize

Write-Host "`nProcesses"
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*$Root*") -or
    ($_.Name -eq "cmd.exe" -and $_.CommandLine -like "*$Root*") -or
    ($_.Name -eq "ngrok.exe" -and $_.CommandLine -like "*nexgen*") -or
    ($_.Name -like "electron*")
  } |
  Select-Object ProcessId, Name, CommandLine |
  Format-Table -AutoSize -Wrap

Write-Host "`nBackend health"
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/health" -TimeoutSec 5 |
    ConvertTo-Json -Depth 4
} catch {
  Write-Host "Backend is not responding on http://127.0.0.1:3001/api/health"
}

Write-Host "`nNgrok tunnel"
try {
  $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 5
  $tunnels.tunnels | Select-Object name, public_url, proto, @{Name = "addr"; Expression = { $_.config.addr } } |
    Format-Table -AutoSize
} catch {
  Write-Host "Ngrok inspector is not responding on http://127.0.0.1:4040"
}

Write-Host "`nRecent startup logs"
foreach ($LogName in @("nexgen-station-stack.log", "nexgen-dev-stack.log")) {
  $path = Join-Path $Root "logs\$LogName"
  if (Test-Path $path) {
    Write-Host "`n$LogName"
    Get-Content $path -Tail 25
  }
}
