$ErrorActionPreference = "Stop"

$TaskNames = @("NexGen ERP Station Stack", "NexGen ERP Dev Stack")
$removed = $false

foreach ($TaskName in $TaskNames) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed startup task: $TaskName"
    $removed = $true
  }
}

if (-not $removed) {
  Write-Host "No NexGen startup task found."
}
