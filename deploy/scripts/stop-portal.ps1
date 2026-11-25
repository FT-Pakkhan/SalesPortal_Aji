# Stops the AJI Sales Portal (the scheduled task, then its Node.js process and what it started), e.g. before updating it.
# Start it again with:  Start-ScheduledTask -TaskName 'AJI Sales Portal'   (or restart Windows)
# Run in PowerShell "as Administrator".
param([string]$TaskName = 'AJI Sales Portal')
$root = Split-Path $PSScriptRoot -Parent

# The task first: stopped by hand it doesn't restart (stopping Node.js first would look like a crash and restart it)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName
  Write-Host "Scheduled task '$TaskName' stopped."
}

$all = @(Get-CimInstance Win32_Process)
$alive = @{}
foreach ($p in $all) { $alive[[int]$p.ProcessId] = $true }

# This folder's Node.js process (started by start-portal.ps1 with the full path of app\server.js) and the
# start-portal.ps1 window that runs it
$server = (Join-Path $root 'app\server.js').ToLower()
$start = (Join-Path $root 'scripts\start-portal.ps1').ToLower()
$nodes = @($all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($server) })
$starters = @($all | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($start) })

# What Node.js started: the DI API / Crystal Reports PowerShell runs (their working folder is app\, so one left
# running keeps app\ from being deleted) - its children, and runs left behind by an earlier stop (parent gone)
$nodeIds = @{}
foreach ($n in $nodes) { $nodeIds[[int]$n.ProcessId] = $true }
$children = @($all | Where-Object {
  $_.Name -eq 'powershell.exe' -and $_.CommandLine -and $_.CommandLine -like '*-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand*' -and
  ($nodeIds[[int]$_.ParentProcessId] -or -not $alive[[int]$_.ParentProcessId])
})

foreach ($p in @($nodes) + @($children) + @($starters)) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "Node.js processes stopped: $($nodes.Count)"
Write-Host "DI API / report runs stopped: $($children.Count)"
Write-Host "start-portal windows stopped: $($starters.Count)"
