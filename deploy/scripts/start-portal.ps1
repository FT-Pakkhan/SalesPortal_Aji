# Starts the AJI Sales Portal: loads portal.env, then runs the portal (app\server.js) with Node.js.
# Run by the "AJI Sales Portal" scheduled task (install-service.ps1); can also be run by hand to test.
# Output goes to logs\portal-YYYYMMDD.log. When Node.js stops, this script ends with its exit code, so the task
# restarts it.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root 'portal.env'
if (-not (Test-Path $envFile)) { throw "portal.env not found in $root - copy portal.env.example to portal.env and fill it in" }

# KEY=VALUE lines; # comments and empty lines skipped; surrounding quotes removed
foreach ($line in Get-Content $envFile) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith('#')) { continue }
  $i = $t.IndexOf('=')
  if ($i -lt 1) { continue }
  $name = $t.Substring(0, $i).Trim()
  $value = $t.Substring($i + 1).Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}
if (-not $env:PORT) { $env:PORT = '3000' }
if (-not $env:HOSTNAME) { $env:HOSTNAME = '127.0.0.1' }
$env:NODE_ENV = 'production'

$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ('portal-{0:yyyyMMdd}.log' -f (Get-Date))
# Logs older than 30 days are removed
Get-ChildItem $logs -Filter 'portal-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue

$node = (Get-Command node.exe -ErrorAction Stop).Source
$app = Join-Path $root 'app'
Set-Location $root  # app\server.js moves into app\ itself
Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Starting AJI Sales Portal on http://$($env:HOSTNAME):$($env:PORT) (Node.js $(& $node --version))"
$ErrorActionPreference = 'Continue'
# Full path of server.js: stop-portal.ps1 finds this folder's portal by it
& $node (Join-Path $app 'server.js') 2>&1 | ForEach-Object { Add-Content $log "$_" }
$code = $LASTEXITCODE
Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') AJI Sales Portal stopped (exit code $code)"
exit $(if ($code) { $code } else { 1 })
