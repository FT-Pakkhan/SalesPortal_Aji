# Checks that this server is ready for the AJI Sales Portal: 64-bit Windows / PowerShell, Node.js, portal.env,
# the portal and SAP databases, the SAP DI API, the Crystal Reports runtime and the web port.
# Run in a 64-bit PowerShell (the normal one). Passwords are never shown.
$root = Split-Path $PSScriptRoot -Parent
$failed = 0
function Result([string]$what, [bool]$ok, [string]$detail = '') {
  if ($ok) { Write-Host ('  OK    {0,-34} {1}' -f $what, $detail) -ForegroundColor Green }
  else { Write-Host ('  FAIL  {0,-34} {1}' -f $what, $detail) -ForegroundColor Red; $script:failed++ }
}

Write-Host "AJI Sales Portal - server check ($root)"

# ---- Windows / PowerShell ----
Result 'Windows 64-bit' ([Environment]::Is64BitOperatingSystem)
Result 'PowerShell 64-bit' ([Environment]::Is64BitProcess) 'the DI API and Crystal Reports are used from 64-bit PowerShell'

# ---- Node.js ----
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node) {
  $v = (& $node.Source --version).TrimStart('v')
  $major = [int]($v.Split('.')[0]); $minor = [int]($v.Split('.')[1])
  Result 'Node.js' (($major -gt 20) -or ($major -eq 20 -and $minor -ge 9)) "v$v (needs 20.9 or later; 24 LTS recommended)"
} else { Result 'Node.js' $false 'not installed or not on the PATH - install Node.js 24 LTS (64-bit)' }
Result 'Portal files (app\server.js)' (Test-Path (Join-Path $root 'app\server.js'))

# ---- portal.env ----
$envFile = Join-Path $root 'portal.env'
$cfg = @{}
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#') -or $t.IndexOf('=') -lt 1) { continue }
    $cfg[$t.Substring(0, $t.IndexOf('=')).Trim()] = $t.Substring($t.IndexOf('=') + 1).Trim().Trim('"').Trim("'")
  }
  Result 'portal.env' $true
  # Several companies (DB_COMMON): each company's database is in the ODBC table, its SAP database in its General Settings
  $multi = [bool]$cfg['DB_COMMON']
  $keys = if ($multi) { 'DB_SERVER', 'DB_COMMON', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET', 'SETTINGS_SECRET_KEY' } else { 'DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD', 'SAP_DB_NAME', 'JWT_SECRET', 'SETTINGS_SECRET_KEY' }
  foreach ($k in $keys) {
    Result "  $k" ([bool]$cfg[$k]) $(if ($cfg[$k]) { '' } else { 'empty' })
  }
  Result '  JWT_SECRET length' (($cfg['JWT_SECRET'] + '').Length -ge 32) 'at least 32 characters (scripts\new-secrets.ps1 makes one)'
  $keyOk = $false
  try { $keyOk = ([Convert]::FromBase64String($cfg['SETTINGS_SECRET_KEY'] + '')).Length -eq 32 } catch {}
  Result '  SETTINGS_SECRET_KEY format' $keyOk '32 bytes, base64'
  if (-not $multi) { Result '  SAP_DB_NAME format' (($cfg['SAP_DB_NAME'] + '') -match '^[A-Za-z0-9_-]+$') 'letters, digits, _ and - only' }
} else { Result 'portal.env' $false 'missing - copy portal.env.example to portal.env and fill it in' }

# ---- Several companies: the company list, then each company's databases ----
function Test-CompanyDb($server, $database, $user, $password) {
  $c = New-Object System.Data.SqlClient.SqlConnection "Server=$server;Database=$database;User ID=$user;Password=$password;Connect Timeout=10;TrustServerCertificate=True"
  try {
    $c.Open()
    $cmd = $c.CreateCommand()
    $cmd.CommandText = "SELECT CASE WHEN OBJECT_ID('FTS11OADM') IS NULL THEN 'NO-TABLES' ELSE ISNULL((SELECT TOP 1 CASE WHEN SapCompanyDB IS NULL OR SapCompanyDB = '' THEN '-' WHEN OBJECT_ID(QUOTENAME(SapCompanyDB) + '.dbo.OADM') IS NULL THEN '!' + SapCompanyDB ELSE SapCompanyDB END FROM FTS11OADM WHERE DocEntry = 1), '-') END"
    $r = [string]$cmd.ExecuteScalar()
    if ($r -eq 'NO-TABLES') { Result "  $database" $false 'connected, but the migrations have not been run (no FTS11OADM)' }
    elseif ($r -eq '-') { Result "  $database" $true 'connected; SAP Database not set yet (General Settings > SAP DI API)' }
    elseif ($r.StartsWith('!')) { Result "  $database" $false "connected; SAP Database $($r.Substring(1)) in its General Settings not found (or no access)" }
    else { Result "  $database" $true "connected, SAP company $r" }
  } catch {
    Result "  $database" $false $_.Exception.Message
  } finally { $c.Dispose() }
}

if ($multi -and $cfg['DB_SERVER']) {
  $server = if ($cfg['DB_PORT'] -and $cfg['DB_PORT'] -ne '1433') { "$($cfg['DB_SERVER']),$($cfg['DB_PORT'])" } else { $cfg['DB_SERVER'] }
  $conn = New-Object System.Data.SqlClient.SqlConnection "Server=$server;Database=$($cfg['DB_COMMON']);User ID=$($cfg['DB_USER']);Password=$($cfg['DB_PASSWORD']);Connect Timeout=10;TrustServerCertificate=True"
  try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT T0.[Database], T0.CompnyName, T0.[Server], T0.DBUserId, T0.DBPassword FROM ODBC T0 ORDER BY T0.CompnyName"
    $table = New-Object System.Data.DataTable
    $table.Load($cmd.ExecuteReader())
    Result 'Company list (ODBC)' ($table.Rows.Count -gt 0) "$server / $($cfg['DB_COMMON']): $($table.Rows.Count) company row(s)"
    foreach ($row in $table.Rows) {
      $own = ($row.DBUserId -isnot [DBNull]) -and $row.DBUserId
      $user = if ($own) { $row.DBUserId } else { $cfg['DB_USER'] }
      $password = if ($own) { [string]$row.DBPassword } else { $cfg['DB_PASSWORD'] }
      if ($password.StartsWith('v1:')) { Result "  $($row.Database)" $true 'password kept encrypted - checked when someone logs in to it'; continue }
      Test-CompanyDb $row.Server $row.Database $user $password
    }
  } catch {
    Result 'Company list (ODBC)' $false $_.Exception.Message
  } finally { $conn.Dispose() }
}

# ---- Databases (with the SQL login in portal.env) ----
if (-not $multi -and $cfg['DB_SERVER']) {
  $server = if ($cfg['DB_PORT'] -and $cfg['DB_PORT'] -ne '1433') { "$($cfg['DB_SERVER']),$($cfg['DB_PORT'])" } else { $cfg['DB_SERVER'] }
  $cs = "Server=$server;Database=$($cfg['DB_DATABASE']);User ID=$($cfg['DB_USER']);Password=$($cfg['DB_PASSWORD']);Connect Timeout=10;TrustServerCertificate=True"
  $conn = New-Object System.Data.SqlClient.SqlConnection $cs
  try {
    $conn.Open()
    Result 'Portal database connection' $true "$server / $($cfg['DB_DATABASE'])"
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT CASE WHEN OBJECT_ID('FTS11OADM') IS NULL THEN 0 ELSE 1 END"
    Result '  Portal tables' ([int]$cmd.ExecuteScalar() -eq 1) 'FTS11OADM found = the migrations have been run'
    $cmd.CommandText = "SELECT CASE WHEN DB_ID(@db) IS NULL THEN 0 WHEN OBJECT_ID(QUOTENAME(@db) + '.dbo.OADM') IS NULL THEN 1 ELSE 2 END"
    $null = $cmd.Parameters.AddWithValue('@db', $cfg['SAP_DB_NAME'] + '')
    $sap = [int]$cmd.ExecuteScalar()
    Result 'SAP company database' ($sap -eq 2) $(switch ($sap) { 0 { "$($cfg['SAP_DB_NAME']) not found (or no access for $($cfg['DB_USER']))" } 1 { "$($cfg['SAP_DB_NAME']) is not a SAP B1 company" } default { $cfg['SAP_DB_NAME'] } })
    $cmd.CommandText = "SELECT COUNT(*) FROM sys.sql_modules WHERE definition LIKE '%SBODemoGB%'"
    $demo = [int]$cmd.ExecuteScalar()
    $demoOk = ($cfg['SAP_DB_NAME'] -eq 'SBODemoGB') -or ($demo -eq 0)
    Result '  SAP database name in portal' $demoOk $(if ($demoOk) { '' } else { "still SBODemoGB in $demo object(s) - run database\set-sap-database.sql" })
  } catch {
    Result 'Portal database connection' $false $_.Exception.Message
  } finally { $conn.Dispose() }
}

# ---- SAP DI API (64-bit, registered) ----
$di = [Type]::GetTypeFromProgID('SAPbobsCOM.Company')
Result 'SAP DI API (SAPbobsCOM)' ([bool]$di) $(if ($di) { '64-bit DI API registered' } else { 'not installed: install the 64-bit DI API of the same version as SAP B1' })

# ---- Crystal Reports runtime ----
# Loading the .NET part is not enough (the SAP B1 client installs it without the engine): a report object is created,
# which needs the full 64-bit runtime engine - the same step Print and Reports take.
try {
  Add-Type -AssemblyName 'CrystalDecisions.CrystalReports.Engine, Version=13.0.4000.0, Culture=neutral, PublicKeyToken=692fbea5521e1304'
  try {
    $rpt = New-Object CrystalDecisions.CrystalReports.Engine.ReportDocument
    $rpt.Dispose()
    Result 'Crystal Reports runtime' $true '13.0 (64-bit), engine OK'
  } catch {
    Result 'Crystal Reports runtime' $false 'the .NET part is there but the 64-bit runtime ENGINE does not start: install / Repair "SAP Crystal Reports runtime engine for .NET Framework (64-bit)" (CRRuntime_64bit_13_0_xx.msi), then restart the server'
    # The details, to tell a missing engine file from a damaged one
    $ex = $_.Exception; while ($ex.InnerException) { $ex = $ex.InnerException }
    Write-Host ('        error: {0}' -f $ex.Message) -ForegroundColor DarkGray
    $reg = Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\CLSID\{4DB2E2BB-78E6-4AEA-BEFB-FDAAB610FD1B}\InprocServer32' -ErrorAction SilentlyContinue
    if ($reg) { Write-Host ('        engine file: {0} (exists: {1})' -f $reg.'(default)', (Test-Path $reg.'(default)')) -ForegroundColor DarkGray }
    else { Write-Host '        engine file: not registered for 64-bit (the 64-bit runtime is not installed)' -ForegroundColor DarkGray }
    $keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'SAP Crystal Reports runtime*' } |
      ForEach-Object { Write-Host ('        installed: {0} {1}' -f $_.DisplayName, $_.DisplayVersion) -ForegroundColor DarkGray }
  }
} catch { Result 'Crystal Reports runtime' $false 'not installed: install "SAP Crystal Reports runtime engine for .NET Framework" 64-bit (CRRuntime_64bit_13_0_xx.msi)' }

# ---- Web port ----
$port = if ($cfg['PORT']) { [int]$cfg['PORT'] } else { 3000 }
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $ours = $owner -and $owner.CommandLine -and $owner.CommandLine.ToLower().Contains((Join-Path $root 'app\server.js').ToLower())
  Result "Port $port" $ours $(if ($ours) { 'used by this portal (running)' } else { "in use by $($owner.Name) - choose another PORT in portal.env" })
} else { Result "Port $port" $true 'free' }

Write-Host ''
if ($failed -eq 0) { Write-Host 'Everything is ready.' -ForegroundColor Green } else { Write-Host "$failed check(s) failed - fix them before starting the portal." -ForegroundColor Red }
