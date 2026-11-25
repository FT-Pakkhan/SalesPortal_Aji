# Removes the AJI Sales Portal scheduled task (stops the portal first). The folder itself is left as it is.
# Run in PowerShell "as Administrator".
param([string]$TaskName = 'AJI Sales Portal')
& (Join-Path $PSScriptRoot 'stop-portal.ps1') -TaskName $TaskName
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Scheduled task '$TaskName' removed."
} else {
  Write-Host "No scheduled task '$TaskName'."
}
