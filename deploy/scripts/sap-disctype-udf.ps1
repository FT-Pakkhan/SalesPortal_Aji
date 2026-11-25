# SAP Discount Type fields: the one marketing-document field U_DiscType ("Discount Type") becomes five,
# U_DiscType1 .. U_DiscType5 ("Discount Type 1" .. "Discount Type 5"), Alphanumeric 50, linked to UDT DISCOUNTTYPE.
# SAP can't rename a field, so U_DiscType is removed and the five are added (through the SAP DI API, with the portal's
# General Settings > SAP DI API log-on). Fields already there are left alone, so it can be run again.
# U_DiscType is only removed when no SAP document has a value in it; otherwise the script stops and says where.
#
# Run in a 64-bit PowerShell on the portal server, after hours, with all users logged out of SAP:
#   powershell -ExecutionPolicy Bypass -File .\sap-disctype-udf.ps1                 (the portal's database from portal.env)
#   powershell -ExecutionPolicy Bypass -File .\sap-disctype-udf.ps1 -PortalDb AJI_Portal   (one company of several)
#   add -Check to only see what would be done
# Passwords are never shown.
param([string]$EnvFile, [string]$PortalDb, [switch]$Check)
$ErrorActionPreference = 'Stop'

# ---- portal.env (on the server) or .env.local (development) ----
if (-not $EnvFile) {
  $root = Split-Path $PSScriptRoot -Parent
  $EnvFile = @((Join-Path $root 'portal.env'), (Join-Path (Split-Path $root -Parent) '.env.local'), (Join-Path $root '.env.local')) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $EnvFile -or -not (Test-Path $EnvFile)) { throw 'portal.env not found - give it with -EnvFile' }
$cfg = @{}
foreach ($line in Get-Content $EnvFile) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith('#') -or $t.IndexOf('=') -lt 1) { continue }
  $cfg[$t.Substring(0, $t.IndexOf('=')).Trim()] = $t.Substring($t.IndexOf('=') + 1).Trim().Trim('"').Trim("'")
}
if (-not $PortalDb) { $PortalDb = $cfg['DB_DATABASE'] }
if (-not $PortalDb) { throw 'Give the company''s portal database with -PortalDb' }
$sqlServer = $cfg['DB_SERVER']; if ($cfg['DB_PORT'] -and $cfg['DB_PORT'] -ne '1433') { $sqlServer = "$sqlServer,$($cfg['DB_PORT'])" }

function Query([string]$database, [string]$sql) {
  $cs = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $cs['Data Source'] = $sqlServer; $cs['Initial Catalog'] = $database; $cs['User ID'] = $cfg['DB_USER']; $cs['Password'] = $cfg['DB_PASSWORD']
  $conn = New-Object System.Data.SqlClient.SqlConnection $cs.ConnectionString
  try {
    $conn.Open()
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
    $table = New-Object System.Data.DataTable
    $table.Load($cmd.ExecuteReader())
    return , $table
  } finally { $conn.Dispose() }
}

# ---- The SAP log-on from General Settings (passwords decrypted with SETTINGS_SECRET_KEY by Node, as the portal does) ----
$s = (Query $PortalDb 'SELECT SapServer, SapDbServerType, SapCompanyDB, SapUseTrusted, SapDbUserName, SapDbPassword, SapUserName, SapPassword, SapLicenseServer, SapSLDServer FROM FTS11OADM WHERE DocEntry = 1').Rows
if ($s.Count -eq 0) { throw "No General Settings in $PortalDb" }
$s = $s[0]
# Node gets the key and the stored values in an environment variable of this process only (not on a command line)
$decrypt = @'
const c = require('crypto');
try {
  const p = JSON.parse(process.env.FTS_DECRYPT_IN); const key = Buffer.from(p.key, 'base64');
  const out = p.values.map((v) => { if (!v) return null; const [, iv, tag, data] = v.split(':');
    const d = c.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'); });
  process.stdout.write(JSON.stringify(out));
} catch { process.stderr.write('Could not read the SAP passwords - check SETTINGS_SECRET_KEY'); process.exit(1); }
'@
$env:FTS_DECRYPT_IN = @{ key = $cfg['SETTINGS_SECRET_KEY']; values = @([string]$s.SapDbPassword, [string]$s.SapPassword) } | ConvertTo-Json -Compress
try { $plain = & node -e $decrypt | ConvertFrom-Json } finally { Remove-Item Env:FTS_DECRYPT_IN -ErrorAction SilentlyContinue }
if ($LASTEXITCODE -ne 0 -or -not $plain) { throw 'Could not read the SAP passwords from General Settings' }
$serverTypes = @{ MSSQL2005 = 4; MSSQL2008 = 6; MSSQL2012 = 7; MSSQL2014 = 8; MSSQL2016 = 10; MSSQL2017 = 11; MSSQL2019 = 15; MSSQL2022 = 17 }
$sapDb = [string]$s.SapCompanyDB
Write-Host "Portal database $PortalDb - SAP company $sapDb on $($s.SapServer)"

# ---- What is there now ----
$fields = Query $sapDb "SELECT AliasID, MIN(FieldID) AS FieldID, COUNT(*) AS Tables FROM CUFD WHERE TableID IN ('ORDR', 'OQUT') AND AliasID IN ('DiscType', 'DiscType1', 'DiscType2', 'DiscType3', 'DiscType4', 'DiscType5') GROUP BY AliasID"
$have = @{}; foreach ($r in $fields.Rows) { $have[[string]$r.AliasID] = [int]$r.FieldID }
$udt = (Query $sapDb "SELECT COUNT(*) AS N FROM OUTB WHERE TableName = 'DISCOUNTTYPE'").Rows[0].N
if ($udt -eq 0) { throw 'SAP has no user-defined table DISCOUNTTYPE - create it first (Tools > Customization Tools > User-Defined Tables - Setup)' }

$used = @()
if ($have.ContainsKey('DiscType')) {
  # Every SAP table that has U_DiscType: how many rows have a value
  $tables = Query $sapDb "SELECT DISTINCT c.TableID FROM CUFD c WHERE c.AliasID = 'DiscType' AND OBJECT_ID(c.TableID, 'U') IS NOT NULL"
  foreach ($r in $tables.Rows) {
    $n = (Query $sapDb "SELECT COUNT(*) AS N FROM [$($r.TableID)] WHERE ISNULL(U_DiscType, '') <> ''").Rows[0].N
    if ($n -gt 0) { $used += "$($r.TableID): $n" }
  }
}
Write-Host ('  U_DiscType: ' + $(if ($have.ContainsKey('DiscType')) { "there (FieldID $($have['DiscType'])), values: " + $(if ($used) { $used -join ', ' } else { 'none' }) } else { 'not there' }))
foreach ($i in 1..5) { Write-Host "  U_DiscType$($i): $(if ($have.ContainsKey("DiscType$i")) { 'there' } else { 'to add' })" }
if ($used) { throw "U_DiscType has values on SAP documents ($($used -join ', ')) - not removed. Ask your consultant before going on." }
if ($Check) { Write-Host 'Check only: nothing changed.'; return }

# ---- DI API: remove U_DiscType, add U_DiscType1..5 (marketing documents: set on ORDR, SAP puts it on all of them) ----
$company = New-Object -ComObject SAPbobsCOM.Company
try {
  $company.Server = [string]$s.SapServer
  $company.DbServerType = $serverTypes[[string]$s.SapDbServerType]
  $company.CompanyDB = $sapDb
  $company.UseTrusted = [bool]$s.SapUseTrusted
  if (-not $s.SapUseTrusted) { $company.DbUserName = [string]$s.SapDbUserName; $company.DbPassword = [string]$plain[0] }
  $company.UserName = [string]$s.SapUserName
  $company.Password = [string]$plain[1]
  if ($s.SapLicenseServer -isnot [DBNull] -and $s.SapLicenseServer) { $company.LicenseServer = [string]$s.SapLicenseServer }
  if ($s.SapSLDServer -isnot [DBNull] -and $s.SapSLDServer) { $company.SLDServer = [string]$s.SapSLDServer }
  if ($company.Connect() -ne 0) { throw "Could not log on to SAP: $($company.GetLastErrorDescription())" }
  try {
    function Release($o) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o); [GC]::Collect(); [GC]::WaitForPendingFinalizers() }
    if ($have.ContainsKey('DiscType')) {
      $md = $company.GetBusinessObject(152)   # oUserFields
      try {
        if (-not $md.GetByKey('ORDR', $have['DiscType'])) { throw 'U_DiscType not found by the DI API' }
        if ($md.Remove() -ne 0) { throw "Removing U_DiscType: $($company.GetLastErrorDescription())" }
        Write-Host '  removed U_DiscType' -ForegroundColor Green
      } finally { Release $md }
    }
    foreach ($i in 1..5) {
      if ($have.ContainsKey("DiscType$i")) { continue }
      $md = $company.GetBusinessObject(152)
      try {
        $md.TableName = 'ORDR'
        $md.Name = "DiscType$i"
        $md.Description = "Discount Type $i"
        $md.Type = 0          # db_Alpha
        $md.EditSize = 50
        $md.LinkedTable = 'DISCOUNTTYPE'
        if ($md.Add() -ne 0) { throw "Adding U_DiscType$($i): $($company.GetLastErrorDescription())" }
        Write-Host "  added U_DiscType$i" -ForegroundColor Green
      } finally { Release $md }
    }
  } finally { $company.Disconnect() }
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($company) }
Write-Host 'Done. Users can log on to SAP again.'
