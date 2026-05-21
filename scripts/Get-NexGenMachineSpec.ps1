$ErrorActionPreference = "SilentlyContinue"

function Format-Bytes {
  param([double]$Bytes)
  if ($Bytes -ge 1TB) { return "{0:N2} TB" -f ($Bytes / 1TB) }
  if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
  if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
  return "{0:N0} bytes" -f $Bytes
}

function Get-CommandVersion {
  param([string]$Command, [string[]]$Arguments = @("--version"))
  $cmd = Get-Command $Command -ErrorAction SilentlyContinue
  if (-not $cmd) { return "not installed" }
  try {
    return (& $Command @Arguments 2>$null | Select-Object -First 1)
  } catch {
    return "installed, version check failed"
  }
}

$computer = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$bios = Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$drives = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 }
$network = Get-NetIPConfiguration |
  Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq "Up" } |
  ForEach-Object {
    [PSCustomObject]@{
      Adapter = $_.InterfaceAlias
      IPv4 = ($_.IPv4Address.IPAddress -join ", ")
      Gateway = ($_.IPv4DefaultGateway.NextHop -join ", ")
    }
  }

$spec = [ordered]@{
  GeneratedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  ComputerName = $env:COMPUTERNAME
  CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  Manufacturer = $computer.Manufacturer
  Model = $computer.Model
  SerialNumber = $bios.SerialNumber
  Windows = "$($os.Caption) $($os.Version) build $($os.BuildNumber)"
  Architecture = $os.OSArchitecture
  CPU = $cpu.Name
  CPUCores = $cpu.NumberOfCores
  CPULogicalProcessors = $cpu.NumberOfLogicalProcessors
  RAM = Format-Bytes $computer.TotalPhysicalMemory
  Node = Get-CommandVersion "node"
  Npm = Get-CommandVersion "npm"
  Git = Get-CommandVersion "git"
  Ngrok = Get-CommandVersion "ngrok" @("version")
  Drives = @(
    foreach ($drive in $drives) {
      [PSCustomObject]@{
        Drive = $drive.DeviceID
        Size = Format-Bytes $drive.Size
        Free = Format-Bytes $drive.FreeSpace
      }
    }
  )
  Network = @($network)
}

$spec | ConvertTo-Json -Depth 6
