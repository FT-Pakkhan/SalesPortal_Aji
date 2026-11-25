# SAP line field U_SalesPrice ("Sales Price"): the Export Unit Price of a sales document line (Sales Type EXPORT),
# Float / Price, on the marketing document rows (set on RDR1, SAP puts it on all of them: QUT1, RDR1, INV1, RIN1, ...).
# Added through the SAP DI API, with the portal's General Settings > SAP DI API log-on. Already there = left alone,
# so it can be run again.
#
# Run in a 64-bit PowerShell on the portal server, after hours, with all users logged out of SAP:
#   powershell -ExecutionPolicy Bypass -File .\sap-salesprice-udf.ps1                       (the portal's database from portal.env)
#   powershell -ExecutionPolicy Bypass -File .\sap-salesprice-udf.ps1 -PortalDb AJI_Portal  (one company of several)
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
$sapDb = [string]$s.SapCompanyDB
Write-Host "Portal database $PortalDb - SAP company $sapDb on $($s.SapServer)"

# ---- What is there now ----
$have = (Query $sapDb "SELECT COUNT(*) AS N FROM CUFD WHERE TableID = 'RDR1' AND AliasID = 'SalesPrice'").Rows[0].N -gt 0
Write-Host "  U_SalesPrice on the document rows: $(if ($have) { 'there - nothing to do' } else { 'to add' })"
if ($have -or $Check) { if ($Check) { Write-Host 'Check only: nothing changed.' }; return }

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

# ---- DI API: add U_SalesPrice ----
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
    $md = $company.GetBusinessObject(152)   # oUserFields
    try {
      $md.TableName = 'RDR1'
      $md.Name = 'SalesPrice'
      $md.Description = 'Sales Price'
      $md.Type = 4          # db_Float
      $md.SubType = 80      # st_Price
      if ($md.Add() -ne 0) { throw "Adding U_SalesPrice: $($company.GetLastErrorDescription())" }
      Write-Host '  added U_SalesPrice' -ForegroundColor Green
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($md); [GC]::Collect(); [GC]::WaitForPendingFinalizers() }
  } finally { $company.Disconnect() }
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($company) }
Write-Host 'Done. Users can log on to SAP again.'
