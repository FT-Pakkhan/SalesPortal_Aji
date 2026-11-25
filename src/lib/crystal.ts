import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { portalDbLogon } from './db';
import { ValidationError } from './errors';
import { sapDatabase } from './sapDb';
import type { DbLogon } from './generalSettings';

// Crystal Reports files (.rpt) are run by the SAP Crystal Reports runtime for .NET Framework, a Windows component
// Node can't load. A short Windows PowerShell script (which runs on .NET Framework) opens the report, logs its tables
// on to the database, sets its parameters and exports a PDF. The database password and the parameter values go to
// the script on its standard input, never on the command line.
//   Print layouts: the document's DocEntry goes into the layout's DocKey@ parameter (as SAP B1 layouts do).
//   Reports:       the values the user filled in go into the report's own parameters.

/** A report can take a while (database, many lines); give up after this */
const TIMEOUT_MS = 120_000;

const ENGINE = 'CrystalDecisions.CrystalReports.Engine, Version=13.0.4000.0, Culture=neutral, PublicKeyToken=692fbea5521e1304';
const SHARED = 'CrystalDecisions.Shared, Version=13.0.4000.0, Culture=neutral, PublicKeyToken=692fbea5521e1304';

/**
 * The PowerShell script: open $p.path as $rpt, run `action` (which sets $result = @{ success = ...; ... }), close.
 * Set-Logon: every table of the report and its subreports gets this server and login.
 *   Portal connection: a table designed on the portal database stays on it (a report may read both); any other
 *     database becomes the SAP company database, as SAP B1 does with its own reports (they are often designed on
 *     another company, e.g. a test copy); none = the portal's.
 *   SAP connection ($p.allToSap, a report set to use the SAP DI API setting): every table reads the SAP company database.
 */
const scriptFor = (action: string) => String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$rpt = $null
$result = $null
try {
  Add-Type -AssemblyName '${ENGINE}'
  Add-Type -AssemblyName '${SHARED}'
  $rpt = New-Object CrystalDecisions.CrystalReports.Engine.ReportDocument
  $rpt.Load($p.path)

  function Set-Logon($report) {
    foreach ($table in $report.Database.Tables) {
      $logOn = $table.LogOnInfo
      $conn = $logOn.ConnectionInfo
      $conn.ServerName = $p.server
      if ($p.user) { $conn.IntegratedSecurity = $false; $conn.UserID = $p.user; $conn.Password = $p.password }
      else { $conn.IntegratedSecurity = $true }
      if ($p.allToSap) { $conn.DatabaseName = $p.sapDatabase }
      elseif (-not $conn.DatabaseName) { $conn.DatabaseName = $p.database }
      elseif ($conn.DatabaseName -ne $p.database) { $conn.DatabaseName = $p.sapDatabase }
      $table.ApplyLogOnInfo($logOn)
    }
  }
${action}
} catch {
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  $result = @{ success = $false; message = $e.Message }
} finally {
  if ($rpt) { $rpt.Close(); $rpt.Dispose() }
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 6))
`;

/**
 * Which database login a report uses: the portal's (default), or another one for all its tables — the SAP company
 * database from General Settings > SAP DI API (Report Settings: Use SAP DB Connection)
 */
export type ReportConnection = { kind: 'PORTAL' } | { kind: 'SAP'; logon: DbLogon };

/** What the script gets to log the report's tables on */
async function logonFor(connection: ReportConnection) {
  if (connection.kind === 'SAP') {
    const { server, database, user, password } = connection.logon;
    return { server, database, user, password, sapDatabase: database, allToSap: true };
  }
  return { ...(await portalDbLogon()), sapDatabase: sapDatabase(), allToSap: false };
}

/** Run `action` on the report at `rptPath` with `data` ($p.data); returns what it put in $result */
async function runCrystal<T extends { success: boolean; message: string }>(
  rptPath: string,
  action: string,
  data: unknown,
  connection: ReportConnection = { kind: 'PORTAL' }
): Promise<T> {
  // Worked out first: the current company's databases (the script runs outside this request)
  const logon = await logonFor(connection);
  return new Promise<T>((resolve, reject) => {
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
      reject(new ValidationError(`The report took more than ${TIMEOUT_MS / 1000} seconds`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const out = stdout.trim().replace(/^﻿/, '');
      if (!out) {
        reject(new Error(stderr.trim() || 'The report gave no result'));
        return;
      }
      try {
        resolve(JSON.parse(out) as T);
      } catch {
        reject(new Error(`The report gave an unreadable result: ${out.slice(0, 300)}`));
      }
    });
    child.stdin.end(JSON.stringify({ path: rptPath, data, ...logon }), 'utf8');
  });
}

/** Export the report to a temporary PDF with `action` (which writes to $p.data.out), read it and delete the file */
async function exportPdf(
  rptPath: string,
  action: string,
  data: Record<string, unknown>,
  failure: string,
  connection: ReportConnection = { kind: 'PORTAL' }
): Promise<Buffer> {
  const out = path.join(os.tmpdir(), `portal-report-${randomUUID()}.pdf`);
  try {
    const result = await runCrystal<{ success: boolean; message: string }>(rptPath, action, { ...data, out }, connection);
    if (!result.success) throw new ValidationError(`${failure}: ${result.message}`);
    return await readFile(out);
  } finally {
    await unlink(out).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Print layouts

const PRINT_LAYOUT = String.raw`
  $param = $rpt.DataDefinition.ParameterFields | Where-Object { $_.Name -eq 'DocKey@' } | Select-Object -First 1
  if (-not $param) {
    $result = @{ success = $false; message = 'This layout has no DocKey@ parameter to receive the document' }
  } else {
    Set-Logon $rpt
    foreach ($sub in $rpt.Subreports) { Set-Logon $sub }
    # DocKey@ is a number in SAP B1 layouts; a text parameter gets the DocEntry as text
    $value = if ($param.ParameterValueKind -eq [CrystalDecisions.Shared.ParameterValueKind]::StringParameter) { [string]$p.data.docEntry } else { [int]$p.data.docEntry }
    $rpt.SetParameterValue('DocKey@', $value)
    $rpt.ExportToDisk([CrystalDecisions.Shared.ExportFormatType]::PortableDocFormat, $p.data.out)
    $result = @{ success = $true; message = '' }
  }
`;

/** Run a Crystal Reports layout for one document (DocKey@ = docEntry) and return the PDF */
export function renderLayoutPdf(rptPath: string, docEntry: number): Promise<Buffer> {
  return exportPdf(rptPath, PRINT_LAYOUT, { docEntry }, 'The layout could not be printed');
}

// ---------------------------------------------------------------------------
// Reports

/** Parameter types the portal knows (FTS11RPT1.ParamType) */
export type ReportParamType = 'STRING' | 'INTEGER' | 'DECIMAL' | 'DATE' | 'DATETIME' | 'BOOLEAN';

/** A parameter as found in a .rpt file */
export interface RptParameter {
  /** Name as in the report, e.g. "Item@Select * from OITM" (SAP B1 style) or "FromDate" */
  name: string;
  /** The report's own prompt text, e.g. "Item No." */
  prompt: string;
  type: ReportParamType;
  multi: boolean;
  range: boolean;
  /** Used by the report (unused ones, e.g. SAP's Title_ / separator parameters, need no value) */
  inUse: boolean;
}

/**
 * Parameters of the main report a user can fill in. Left out: parameters of subreports that are linked to the main
 * report (Crystal fills them itself) and those of subreports in general (set through the main report's link).
 * Crystal's value kinds map to the portal's types; numbers and currency become DECIMAL.
 */
const READ_PARAMETERS = String.raw`
  $kinds = @{ StringParameter = 'STRING'; NumberParameter = 'DECIMAL'; CurrencyParameter = 'DECIMAL'; BooleanParameter = 'BOOLEAN'; DateParameter = 'DATE'; DateTimeParameter = 'DATETIME'; TimeParameter = 'DATETIME' }
  $list = @()
  foreach ($f in $rpt.DataDefinition.ParameterFields) {
    if ($f.ReportName -or $f.IsLinked()) { continue }
    $usage = [int]$f.ParameterFieldUsage2
    $list += @{
      name = $f.Name
      prompt = [string]$f.PromptText
      type = $kinds[[string]$f.ParameterValueKind]
      multi = [bool]$f.EnableAllowMultipleValue
      range = ([string]$f.DiscreteOrRangeKind -ne 'DiscreteValue')
      inUse = (($usage -band [int][CrystalDecisions.Shared.ParameterFieldUsage2]::InUse) -ne 0)
    }
  }
  $result = @{ success = $true; message = ''; parameters = $list }
`;

/** The parameters of a .rpt file, in the report's order */
export async function readReportParameters(rptPath: string): Promise<RptParameter[]> {
  const result = await runCrystal<{ success: boolean; message: string; parameters?: RptParameter[] | RptParameter }>(rptPath, READ_PARAMETERS, null);
  if (!result.success) throw new ValidationError(`The report could not be read: ${result.message}`);
  // ConvertTo-Json writes a list of one as a single object
  const params = result.parameters ?? [];
  return (Array.isArray(params) ? params : [params]).map((p) => ({ ...p, type: p.type ?? 'STRING' }));
}

/** One value of a parameter: a single value, or a From - To range (null = open end) */
export type ReportValue = string | number | boolean | { from: string | number | null; to: string | number | null };

/** A parameter value to pass: discrete values (several for a multi-value parameter) or ranges */
export interface ReportParamValue {
  name: string;
  values: ReportValue[];
}

/**
 * Set every parameter, then export. Values are converted to the report's own type for that parameter (dates come as
 * yyyy-MM-dd or yyyy-MM-ddTHH:mm). A range with an open end has no bound on that side; a range parameter left empty
 * gets one open range (everything). Parameters left without a value (left empty, or not in the settings, e.g. SAP's
 * unused Title_ ones): a text parameter gets an empty text, so the report doesn't stop to ask for it.
 */
const RUN_REPORT = String.raw`
  Set-Logon $rpt
  foreach ($sub in $rpt.Subreports) { Set-Logon $sub }

  function Convert-Value($field, $v) {
    switch ([string]$field.ParameterValueKind) {
      'StringParameter'   { return [string]$v }
      'NumberParameter'   { return [decimal]$v }
      'CurrencyParameter' { return [decimal]$v }
      'BooleanParameter'  { return [bool]$v }
      default {
        $s = [string]$v
        $fmt = if ($s.Length -gt 10) { 'yyyy-MM-ddTHH:mm' } else { 'yyyy-MM-dd' }
        return [datetime]::ParseExact($s, $fmt, [System.Globalization.CultureInfo]::InvariantCulture)
      }
    }
  }

  $given = @{}
  foreach ($prm in @($p.data.parameters)) {
    $field = $rpt.DataDefinition.ParameterFields | Where-Object { $_.Name -eq $prm.name -and -not $_.ReportName } | Select-Object -First 1
    if (-not $field) { throw "The report has no parameter $($prm.name); read the parameters from the report again in Report Settings" }
    $isRange = ([string]$field.DiscreteOrRangeKind -ne 'DiscreteValue')
    $vals = New-Object CrystalDecisions.Shared.ParameterValues
    foreach ($v in @($prm.values)) {
      if ($isRange) {
        $rv = New-Object CrystalDecisions.Shared.ParameterRangeValue
        if ($null -ne $v.from -and [string]$v.from -ne '') { $rv.StartValue = Convert-Value $field $v.from; $rv.LowerBoundType = [CrystalDecisions.Shared.RangeBoundType]::BoundInclusive }
        else { $rv.LowerBoundType = [CrystalDecisions.Shared.RangeBoundType]::NoBound }
        if ($null -ne $v.to -and [string]$v.to -ne '') { $rv.EndValue = Convert-Value $field $v.to; $rv.UpperBoundType = [CrystalDecisions.Shared.RangeBoundType]::BoundInclusive }
        else { $rv.UpperBoundType = [CrystalDecisions.Shared.RangeBoundType]::NoBound }
        [void]$vals.Add($rv)
      } else {
        $dv = New-Object CrystalDecisions.Shared.ParameterDiscreteValue
        $dv.Value = Convert-Value $field $v
        [void]$vals.Add($dv)
      }
    }
    if ($vals.Count -eq 0 -and $isRange) {
      $rv = New-Object CrystalDecisions.Shared.ParameterRangeValue
      $rv.LowerBoundType = [CrystalDecisions.Shared.RangeBoundType]::NoBound
      $rv.UpperBoundType = [CrystalDecisions.Shared.RangeBoundType]::NoBound
      [void]$vals.Add($rv)
    }
    if ($vals.Count -gt 0) { $field.ApplyCurrentValues($vals); $given[$prm.name] = $true }
  }

  foreach ($field in $rpt.DataDefinition.ParameterFields) {
    if ($field.ReportName -or $field.IsLinked() -or $given[$field.Name]) { continue }
    if ([string]$field.ParameterValueKind -eq 'StringParameter' -and [string]$field.DiscreteOrRangeKind -eq 'DiscreteValue') {
      $vals = New-Object CrystalDecisions.Shared.ParameterValues
      $dv = New-Object CrystalDecisions.Shared.ParameterDiscreteValue
      $dv.Value = ''
      [void]$vals.Add($dv)
      $field.ApplyCurrentValues($vals)
    }
  }

  $rpt.ExportToDisk([CrystalDecisions.Shared.ExportFormatType]::PortableDocFormat, $p.data.out)
  $result = @{ success = $true; message = '' }
`;

/** Run a report with these parameter values, logged on with `connection`, and return the PDF */
export function renderReportPdf(rptPath: string, parameters: ReportParamValue[], connection: ReportConnection = { kind: 'PORTAL' }): Promise<Buffer> {
  return exportPdf(rptPath, RUN_REPORT, { parameters }, 'The report could not be run', connection);
}
