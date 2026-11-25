# Builds the AJI Sales Portal for the server and puts everything to publish in one folder:
#   app\        the portal (Next.js standalone server: server.js + the node_modules it needs + public + static files)
#   scripts\    start / stop / install as a service / check the server / new secrets
#   iis\        web.config for IIS in front (HTTPS)
#   database\   migrations (001 ... in order), set-sap-database.sql, scripts\ (one-off server fixes) and
#               common\ (the company list database, for several companies)
#   docs\       User Guide and Deployment Guide
#   portal.env.example, RELEASE.txt
# portal.env and logs\ in the target folder are kept (they belong to the server).
#
#   .\scripts\build-release.ps1                                   -> D:\Portal Publish Folder\SalesPortal_Aji
#   .\scripts\build-release.ps1 -Target 'E:\Release\SalesPortal'
#   .\scripts\build-release.ps1 -SkipBuild                        (only re-assemble the last build)
param(
  [string]$Target = 'D:\Portal Publish Folder\SalesPortal_Aji',
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
Set-Location $project

if (-not $SkipBuild) {
  Write-Host 'Building (npm run build)...'
  # Tip: close the dev server (npm run dev) first if the build reports errors in .next\dev\types
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'The build failed - see the messages above.' }
}
$standalone = Join-Path $project '.next\standalone'
if (-not (Test-Path (Join-Path $standalone 'server.js'))) { throw 'No standalone build found (.next\standalone\server.js). Check output: "standalone" in next.config.ts.' }

New-Item -ItemType Directory -Force $Target | Out-Null
$app = Join-Path $Target 'app'

# ---- app\ : replaced completely ----
if (Test-Path $app) {
  # A running portal holds its files: stop it first
  $server = (Join-Path $app 'server.js').ToLower()
  if (Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($server) }) {
    throw "The portal in $Target is running - stop it first (scripts\stop-portal.ps1)."
  }
  Remove-Item $app -Recurse -Force
}
Write-Host "Copying the portal to $app ..."
robocopy $standalone $app /E /NFL /NDL /NJH /NJS /NP /XF '.env*' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the standalone build failed (robocopy $LASTEXITCODE)" }
robocopy (Join-Path $project 'public') (Join-Path $app 'public') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying public failed (robocopy $LASTEXITCODE)" }
robocopy (Join-Path $project '.next\static') (Join-Path $app '.next\static') /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying .next\static failed (robocopy $LASTEXITCODE)" }
# Never publish secrets: no .env files anywhere in app\
Get-ChildItem $app -Recurse -Force -Filter '.env*' | Remove-Item -Force

# ---- scripts, iis, database, docs, template ----
$deploy = Join-Path $project 'deploy'
foreach ($dir in 'scripts', 'iis') {
  robocopy (Join-Path $deploy $dir) (Join-Path $Target $dir) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying $dir failed (robocopy $LASTEXITCODE)" }
}
robocopy (Join-Path $project 'database\migrations') (Join-Path $Target 'database\migrations') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the migrations failed (robocopy $LASTEXITCODE)" }
# Several companies: the company list database (Portal_Sales_COMMON)
robocopy (Join-Path $project 'database\common') (Join-Path $Target 'database\common') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the company list scripts failed (robocopy $LASTEXITCODE)" }
Copy-Item (Join-Path $deploy 'database\*.sql') (Join-Path $Target 'database') -Force
$dbScripts = Join-Path $Target 'database\scripts'
if (Test-Path $dbScripts -PathType Leaf) { Remove-Item $dbScripts -Force }
robocopy (Join-Path $project 'database\scripts') $dbScripts /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the database scripts failed (robocopy $LASTEXITCODE)" }
Copy-Item (Join-Path $deploy 'portal.env.example') $Target -Force
New-Item -ItemType Directory -Force (Join-Path $Target 'docs') | Out-Null
Get-ChildItem (Join-Path $project 'docs') -File | Where-Object { $_.Extension -in '.docx', '.pdf' } | Copy-Item -Destination (Join-Path $Target 'docs') -Force

# ---- RELEASE.txt ----
$migrations = Get-ChildItem (Join-Path $project 'database\migrations') -Filter '*.sql' | Sort-Object Name
$version = (Get-Content (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
@(
  'AJI Sales Portal - release'
  "Built:            $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  "Version:          $version"
  "Node.js (build):  $(node --version)"
  "Last migration:   $($migrations[-1].Name)  (run every newer migration on the server's portal database)"
  ''
  'First install and updates: see docs\AJI Sales Portal - Deployment Guide.docx'
) | Set-Content (Join-Path $Target 'RELEASE.txt') -Encoding ASCII

$size = (Get-ChildItem $Target -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Release ready in {0} ({1:N0} MB)." -f $Target, $size) -ForegroundColor Green
if (-not (Test-Path (Join-Path $Target 'portal.env'))) { Write-Host 'On the server: copy portal.env.example to portal.env and fill it in.' }
