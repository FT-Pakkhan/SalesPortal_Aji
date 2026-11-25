import { spawn } from 'child_process';
import os from 'os';
import { ValidationError } from './errors';

// SAP Business One DI API (SAPbobsCOM, a Windows COM component) is called through a short PowerShell script:
// Node can't create COM objects itself. The connection details (passwords included) and the data go to the script on
// its standard input, never on the command line. The DI API on this server is 64-bit, as Node / powershell.exe are.
// Each call logs on, does one thing, and logs off. Calls run one at a time (each is a DI API session in SAP).

/** What the DI API needs to log on to a company */
export interface DiApiLogon {
  server: string;
  /** Code from FTS_vw_SvrTyp, e.g. MSSQL2019 */
  dbServerType: string;
  companyDB: string;
  useTrusted: boolean;
  dbUserName: string | null;
  dbPassword: string | null;
  userName: string;
  password: string;
  licenseServer: string | null;
  sldServer: string | null;
}

export interface DiApiTestResult {
  success: boolean;
  /** Connected: the company name and SAP version. Failed: DI API's own error code and message. */
  message: string;
  /** Seconds the log-on took */
  seconds: number;
}

/**
 * DI API's BoDataServerTypes numbers for FTS_vw_SvrTyp codes (read from the installed SAPbobsCOM100.dll —
 * note MSSQL2019 = 15 and MSSQL2022 = 17, the numbers aren't consecutive).
 */
const DB_SERVER_TYPES: Record<string, number> = {
  MSSQL2005: 4,
  MSSQL2008: 6,
  MSSQL2012: 7,
  MSSQL2014: 8,
  MSSQL2016: 10,
  MSSQL2017: 11,
  MSSQL2019: 15,
  MSSQL2022: 17,
};

/** Log-on can take a while (the license server is contacted); give up after this */
const TIMEOUT_MS = 120_000;

/**
 * The PowerShell script: log on with $p.logon, run `action` (PowerShell that uses $company and the data $d, and sets
 * $result = @{ success = ...; message = ...; ... }; Set-Udf fills a user-defined field), log off. A failed log-on gives success = $false with DI API's
 * error. Text in and out is UTF-8, so names with accents / Chinese characters arrive intact.
 */
const scriptFor = (action: string) => String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$d = $p.data
$company = $null
$result = $null
# Fill a user-defined field (e.g. U_PDocEntry) when the SAP company has it; a company without it is left alone.
# Alphanumeric / memo fields (types 0, 1) get text, the others a number.
function Set-Udf($fields, [string]$name, $value) {
  if ($null -eq $value -or [string]$value -eq '') { return }
  try { $f = $fields.Item($name) } catch { return }
  # Alpha / Memo: text; Float (amounts, quantities, prices, rates...): a decimal number; Numeric: a whole number
  if ([int]$f.Type -le 1) { $f.Value = [string]$value } elseif ([int]$f.Type -eq 4) { $f.Value = [double]$value } else { $f.Value = [int]$value }
}
try {
  $company = New-Object -ComObject SAPbobsCOM.Company
  $l = $p.logon
  $company.Server = $l.server
  $company.DbServerType = [int]$l.dbServerType
  $company.CompanyDB = $l.companyDB
  $company.UseTrusted = [bool]$l.useTrusted
  if (-not $l.useTrusted) {
    $company.DbUserName = [string]$l.dbUserName
    $company.DbPassword = [string]$l.dbPassword
  }
  $company.UserName = $l.userName
  $company.Password = $l.password
  if ($l.licenseServer) { $company.LicenseServer = $l.licenseServer }
  if ($l.sldServer) { $company.SLDServer = $l.sldServer }
  $code = $company.Connect()
  if ($code -ne 0) {
    $result = @{ success = $false; message = "Could not log on to SAP (DI API error $($code)): $($company.GetLastErrorDescription())" }
  } else {
    try {
${action}
    } finally {
      $company.Disconnect()
    }
  }
} catch {
  $result = @{ success = $false; message = "DI API: $($_.Exception.Message)" }
} finally {
  if ($company) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($company) }
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 5))
`;

/** DI API calls one after another: a new one waits for the one running */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Log on, run `action` with `data`, log off — in turn with any other DI API call. Returns what the action put in
 * $result (always with success and message).
 */
export function runDiApi<T extends { success: boolean; message: string }>(logon: DiApiLogon, action: string, data: unknown): Promise<T> {
  const dbServerType = DB_SERVER_TYPES[logon.dbServerType];
  if (dbServerType === undefined) return Promise.reject(new ValidationError(`DB Server Type ${logon.dbServerType} is not supported by DI API`));

  const run = () =>
    new Promise<T>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(scriptFor(action), 'utf16le').toString('base64')],
        // Working folder: temp, not the portal's app folder (a run left behind would keep it from being updated)
        { windowsHide: true, cwd: os.tmpdir() }
      );
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new ValidationError(`No answer from DI API after ${TIMEOUT_MS / 1000} seconds — check the servers and the license server`));
      }, TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', () => {
        clearTimeout(timer);
        const out = stdout.trim().replace(/^﻿/, '');
        if (!out) {
          reject(new Error(stderr.trim() || 'DI API gave no result'));
          return;
        }
        try {
          resolve(JSON.parse(out) as T);
        } catch {
          reject(new Error(`DI API gave an unreadable result: ${out.slice(0, 300)}`));
        }
      });
      child.stdin.end(JSON.stringify({ logon: { ...logon, dbServerType }, data }), 'utf8');
    });

  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** Try to log on to the SAP company through DI API with these details, and log off again */
export async function testDiApiConnection(logon: DiApiLogon): Promise<DiApiTestResult> {
  const started = Date.now();
  const result = await runDiApi<{ success: boolean; message: string }>(
    logon,
    String.raw`
      $result = @{ success = $true; message = "Connected to $($company.CompanyName) ($($company.CompanyDB)), SAP Business One version $($company.Version)" }
    `,
    null
  );
  return { success: result.success, message: result.message, seconds: Math.round((Date.now() - started) / 100) / 10 };
}
