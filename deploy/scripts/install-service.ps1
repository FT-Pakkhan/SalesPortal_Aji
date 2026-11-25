# Installs the AJI Sales Portal to start with Windows and restart if it stops: a scheduled task that runs
# start-portal.ps1 at startup (no extra software needed). Run in PowerShell "as Administrator".
#   .\install-service.ps1                                    runs as SYSTEM (local folders, SQL login in portal.env)
#   .\install-service.ps1 -RunAsUser DOMAIN\svc_portal       runs as that account (needed when attachment / report
#                                                            folders are network shares); asks for its password
param(
  [string]$TaskName = 'AJI Sales Portal',
  [string]$RunAsUser = 'SYSTEM'
)
$ErrorActionPreference = 'Stop'
$principalCheck = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script in PowerShell "as Administrator".' }

$root = Split-Path $PSScriptRoot -Parent
$start = Join-Path $PSScriptRoot 'start-portal.ps1'
if (-not (Test-Path (Join-Path $root 'portal.env'))) { throw "portal.env not found in $root - copy portal.env.example to portal.env and fill it in first" }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed (or not on the PATH). Install Node.js 24 LTS (64-bit) first.' }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$start`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
# Restart every minute if it stops; never time out; one copy only
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 9999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

if ($RunAsUser -eq 'SYSTEM') {
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'AJI Sales Portal (Node.js) - see scripts\start-portal.ps1' -Force | Out-Null
} else {
  $cred = Get-Credential -UserName $RunAsUser -Message "Password of $RunAsUser (the account that runs the portal)"
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User $cred.UserName `
    -Password $cred.GetNetworkCredential().Password -RunLevel Highest -Description 'AJI Sales Portal (Node.js) - see scripts\start-portal.ps1' -Force | Out-Null
}
Write-Host "Scheduled task '$TaskName' installed (runs as $RunAsUser at startup)."

Start-ScheduledTask -TaskName $TaskName
# Wait until the portal answers (the first start can take a few seconds)
$port = (Get-Content (Join-Path $root 'portal.env') | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1) -replace '^\s*PORT\s*=\s*', ''
if (-not $port) { $port = '3000' }
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep 2
  try { $null = Invoke-WebRequest "http://127.0.0.1:$port/login" -UseBasicParsing -TimeoutSec 10; $ok = $true } catch {}
}
if ($ok) { Write-Host "The portal is running: http://127.0.0.1:$port" -ForegroundColor Green }
else { Write-Host "The portal did not answer on port $port yet - see the newest file in $root\logs" -ForegroundColor Yellow }
