import type sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';

/** Series columns for the list (FTS11NNM1), with the document name from FTS_vw_ObjType */
export const SERIES_SELECT = `
  SELECT h.DocEntry, h.ObjType, v.Name AS ObjTypeName, h.Series, h.SeriesName, h.Prefix, h.Seq,
         h.[Length], h.Suffix, h.[Month], h.[Year], h.IsDefault, h.Active, h.IsManual
  FROM FTS11NNM1 h
  LEFT JOIN FTS_vw_ObjType v ON v.Code = h.ObjType`;

/** Longest number length allowed (the number is padded with zeros to this length) */
const MAX_LENGTH = 20;

/** Longest No. a user may key in on a manual series */
export const MANUAL_NO_MAX = 15;

/** Document types that can't have a manual series, and why */
const NO_MANUAL_OBJTYPES: Record<string, string> = {
  FTS11SCIN: 'This document is numbered on check in, without a Confirm, so its series cannot be Manual',
  FTS11OCRD: 'The No. of a Convert to Customer is its SAP BP Code, so its series cannot be Manual',
};

export interface DateNumberingFields {
  year: number;
  month: number;
  seq: number;
}

export interface SeriesFields {
  objType: string;
  series: string;
  seriesName: string | null;
  prefix: string | null;
  seq: number;
  length: number;
  suffix: string | null;
  month: boolean;
  year: boolean;
  isDefault: boolean;
  active: boolean;
  /** Manual series: the No. is keyed in on Confirm; Prefix / Suffix / Month / Year don't apply */
  isManual: boolean;
  /** Next numbers per year / month (FTS11NNM2); only their Seq can be changed */
  dates: DateNumberingFields[];
}

const optionalText = (value: unknown, label: string, max: number): string | null => {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer`);
  return text || null;
};

const wholeNumber = (value: unknown, label: string, min: number, max = 2147483647): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(
      max < 2147483647 ? `${label} must be a whole number from ${min} to ${max}` : `${label} must be a whole number of ${min} or more`
    );
  }
  return n;
};

/** Validate a create / update request body for a numbering series */
export function parseSeriesFields(body: Record<string, unknown>): SeriesFields {
  const objType = String(body.objType ?? '').trim();
  if (!objType) throw new ValidationError('Doc. Object Type is required');

  const series = String(body.series ?? '').trim();
  if (!series) throw new ValidationError('Series is required');
  if (series.length > 100) throw new ValidationError('Series must be 100 characters or fewer');

  const isManual = body.isManual === true;
  if (isManual && NO_MANUAL_OBJTYPES[objType]) throw new ValidationError(NO_MANUAL_OBJTYPES[objType]);
  // A manual series has no prefix / suffix / numbering by date (the user keys in the whole No.)
  const month = !isManual && body.month === true;
  const year = !isManual && body.year === true;
  // A monthly number restarts in every month of every year, so it needs the year too
  if (month && !year) throw new ValidationError('Tick Year as well when numbering by Month');

  const rawDates = Array.isArray(body.dates) ? body.dates : [];
  const dates = rawDates.map((row: Record<string, unknown>) => ({
    year: wholeNumber(row.year, 'Year', 1900, 9999),
    month: wholeNumber(row.month, 'Month', 0, 12),
    seq: wholeNumber(row.seq, 'Date Numbering Seq', 1),
  }));

  return {
    objType,
    series,
    seriesName: optionalText(body.seriesName, 'Series Name', 100),
    prefix: isManual ? null : optionalText(body.prefix, 'Prefix', 50),
    seq: wholeNumber(body.seq, 'Seq', 1),
    length: wholeNumber(body.length, 'Length', 1, MAX_LENGTH),
    suffix: isManual ? null : optionalText(body.suffix, 'Suffix', 50),
    month,
    year,
    isDefault: body.isDefault === true,
    active: body.active !== false,
    isManual,
    dates,
  };
}

/** ObjType must be one of the document types in FTS_vw_ObjType (a view can't carry a foreign key) */
export async function assertObjTypeExists(objType: string): Promise<void> {
  const found = await db.query(`SELECT Code FROM FTS_vw_ObjType WHERE Code = @objType`, [
    { name: 'objType', value: objType },
  ]);
  if (found.length === 0) throw new ValidationError('Doc. Object Type is not a valid document type');
}

/** A series code is unique within its document type; checked here for a friendly message (the table also enforces it) */
export async function assertSeriesAvailable(objType: string, series: string, excludeDocEntry?: number): Promise<void> {
  const existing = await db.query(
    `SELECT DocEntry FROM FTS11NNM1 WHERE ObjType = @objType AND Series = @series AND DocEntry <> @excludeDocEntry`,
    [
      { name: 'objType', value: objType },
      { name: 'series', value: series },
      { name: 'excludeDocEntry', value: excludeDocEntry ?? 0 },
    ]
  );
  if (existing.length > 0) throw new ValidationError('Series already exists for this document type');
}

/** Ticking Default on a series un-ticks it on the document type's other series */
export async function clearOtherDefaults(objType: string, docEntry: number, transaction: sql.Transaction): Promise<void> {
  await db.query(
    `UPDATE FTS11NNM1 SET IsDefault = 0 WHERE ObjType = @objType AND DocEntry <> @docEntry AND IsDefault = 1`,
    [
      { name: 'objType', value: objType },
      { name: 'docEntry', value: docEntry },
    ],
    transaction
  );
}

/** Save the Seq changed on the Date Numbering rows (rows themselves are added when documents are numbered) */
export async function saveDateNumbering(docEntry: number, dates: DateNumberingFields[], transaction: sql.Transaction): Promise<void> {
  for (const row of dates) {
    await db.query(
      `UPDATE FTS11NNM2 SET Seq = @seq WHERE DocEntry = @docEntry AND [Year] = @year AND [Month] = @month AND Seq <> @seq`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'year', value: row.year },
        { name: 'month', value: row.month },
        { name: 'seq', value: row.seq },
      ],
      transaction
    );
  }
}

// ---------------------------------------------------------------------------
// Numbering a document (Confirm / approval)
// ---------------------------------------------------------------------------

/** Where a document type keeps its No.: header table, column (DocNum; LeadCode on a lead) and names for messages */
export interface NumberedTable {
  table: string;
  column: string;
  /** e.g. "sales order" */
  label: string;
  /** What the No. is called; default "No." */
  noLabel?: string;
}

/** Prefix / suffix with [YYYY], [YY], [MM] replaced by the posting date */
const fillDateTokens = (text: string | null, date: Date) =>
  (text ?? '')
    .replace(/\[YYYY\]/gi, String(date.getFullYear()))
    .replace(/\[YY\]/gi, String(date.getFullYear()).slice(-2))
    .replace(/\[MM\]/gi, String(date.getMonth() + 1).padStart(2, '0'));

/**
 * Take the next number of a series for a posting date and move the series on by one.
 * Numbered by Month / Year: the FTS11NNM2 row of that year / month (added at 1 when it isn't there yet).
 * Otherwise the series' own Seq. Rows are locked until the transaction ends, so two users can't get the same number.
 */
export async function takeNextNumber(seriesDocEntry: number, postingDate: Date, transaction: sql.Transaction): Promise<string> {
  const seriesRows = await db.query<{
    Prefix: string | null;
    Suffix: string | null;
    Seq: number;
    Length: number;
    Month: boolean;
    Year: boolean;
    Active: boolean;
  }>(
    `SELECT Prefix, Suffix, Seq, [Length], [Month], [Year], Active
     FROM FTS11NNM1 WITH (UPDLOCK, HOLDLOCK)
     WHERE DocEntry = @series`,
    [{ name: 'series', value: seriesDocEntry }],
    transaction
  );
  const series = seriesRows[0];
  if (!series) throw new ValidationError('Series no longer exists');
  if (!series.Active) throw new ValidationError('Series is not active');

  let seq: number;
  if (series.Month || series.Year) {
    const year = postingDate.getFullYear();
    const month = series.Month ? postingDate.getMonth() + 1 : 0;
    const keyParams = [
      { name: 'series', value: seriesDocEntry },
      { name: 'year', value: year },
      { name: 'month', value: month },
    ];
    const dateRows = await db.query<{ Seq: number }>(
      `SELECT Seq FROM FTS11NNM2 WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @series AND [Year] = @year AND [Month] = @month`,
      keyParams,
      transaction
    );
    seq = dateRows[0]?.Seq ?? 1;
    if (dateRows.length === 0) {
      await db.query(
        `INSERT INTO FTS11NNM2 (DocEntry, [Year], [Month], Seq) VALUES (@series, @year, @month, @seq + 1)`,
        [...keyParams, { name: 'seq', value: seq }],
        transaction
      );
    } else {
      await db.query(
        `UPDATE FTS11NNM2 SET Seq = Seq + 1 WHERE DocEntry = @series AND [Year] = @year AND [Month] = @month`,
        keyParams,
        transaction
      );
    }
  } else {
    seq = series.Seq;
    await db.query(`UPDATE FTS11NNM1 SET Seq = Seq + 1 WHERE DocEntry = @series`, [{ name: 'series', value: seriesDocEntry }], transaction);
  }

  return `${fillDateTokens(series.Prefix, postingDate)}${String(seq).padStart(series.Length, '0')}${fillDateTokens(series.Suffix, postingDate)}`;
}

async function isManualSeries(seriesDocEntry: number, transaction?: sql.Transaction): Promise<boolean> {
  const rows = await db.query<{ IsManual: boolean }>(`SELECT IsManual FROM FTS11NNM1 WHERE DocEntry = @series`, [{ name: 'series', value: seriesDocEntry }], transaction);
  if (rows.length === 0) throw new ValidationError('Series no longer exists');
  return !!rows[0].IsManual;
}

/**
 * Another document of the type already has this No.: any that is no longer a draft (cancelled ones too) or a draft
 * waiting for approval (its No. is reserved). Other drafts may hold the same typed No. until one is confirmed.
 * The rows are locked until the transaction ends, so two confirms can't take the same No. at the same moment.
 */
async function numberTaken(target: NumberedTable, docEntry: number, no: string, transaction: sql.Transaction): Promise<boolean> {
  const rows = await db.query(
    `SELECT DocEntry FROM ${target.table} WITH (UPDLOCK, HOLDLOCK)
     WHERE ${target.column} = @no AND DocEntry <> @docEntry AND (DocStatus <> 'DRAFT' OR ApprStatus = 'PENDING')`,
    [
      { name: 'no', value: no },
      { name: 'docEntry', value: docEntry },
    ],
    transaction
  );
  return rows.length > 0;
}

/**
 * Save of a draft: on a manual series the No. typed in the No. field is kept as it is (checked only on Confirm); on
 * an automatic series a draft has no No. Documents past draft (or waiting for approval) are left alone.
 */
export async function saveDraftNumber(
  target: NumberedTable,
  docEntry: number,
  seriesDocEntry: number | null,
  keyedIn: unknown,
  transaction?: sql.Transaction
): Promise<void> {
  const manual = seriesDocEntry !== null && (await isManualSeries(seriesDocEntry, transaction));
  const no = manual ? String(keyedIn ?? '').trim() || null : null;
  // The column's own size (a Lead Code is 15): longer would fail in the database, so say it here
  if (no && no.length > MANUAL_NO_MAX) throw new ValidationError(`${target.noLabel ?? 'No.'} must be ${MANUAL_NO_MAX} characters or fewer`);
  await db.query(
    `UPDATE ${target.table} SET ${target.column} = @no
     WHERE DocEntry = @docEntry AND DocStatus = 'DRAFT' AND ISNULL(ApprStatus, '') <> 'PENDING'`,
    [
      { name: 'no', value: no },
      { name: 'docEntry', value: docEntry },
    ],
    transaction
  );
}

/**
 * Confirm, before the approval check: on a manual series the No. (sent with Confirm, else the one saved with the
 * draft) is checked (required, up to MANUAL_NO_MAX characters, not used by another document of the type) and kept
 * on the document, so it is reserved while the document waits for approval. On an automatic series a draft keeps no
 * No. (a No. typed while it was on a manual series is cleared); the No. is given when it opens (numberForOpen).
 */
export async function keepManualNumber(
  target: NumberedTable,
  docEntry: number,
  seriesDocEntry: number,
  keyedIn: unknown,
  transaction: sql.Transaction
): Promise<void> {
  const noLabel = target.noLabel ?? 'No.';
  const manual = await isManualSeries(seriesDocEntry, transaction);
  let typed = keyedIn;
  if (manual && typed === undefined) {
    const saved = await db.query<{ No: string | null }>(`SELECT ${target.column} AS [No] FROM ${target.table} WHERE DocEntry = @docEntry`, [
      { name: 'docEntry', value: docEntry },
    ], transaction);
    typed = saved[0]?.No;
  }
  const no = manual ? String(typed ?? '').trim() : null;
  if (manual) {
    if (!no) throw new ValidationError(`Key in the ${noLabel}: the series is Manual`);
    if (no.length > MANUAL_NO_MAX) throw new ValidationError(`${noLabel} must be ${MANUAL_NO_MAX} characters or fewer`);
    if (await numberTaken(target, docEntry, no, transaction)) throw new ValidationError(`${noLabel} ${no} is already used by another ${target.label}`);
  }
  await db.query(`UPDATE ${target.table} SET ${target.column} = @no WHERE DocEntry = @docEntry`, [
    { name: 'no', value: no },
    { name: 'docEntry', value: docEntry },
  ], transaction);
}

/**
 * The No. a document gets when it opens (Confirm without approval, or the last approval). Manual series: the No.
 * kept on Confirm. Automatic series: the series' next number; a number already used (e.g. keyed in by hand on a
 * manual series) is skipped, and the series moves on past it.
 */
export async function numberForOpen(
  target: NumberedTable,
  docEntry: number,
  seriesDocEntry: number,
  postingDate: Date,
  transaction: sql.Transaction
): Promise<string> {
  const noLabel = target.noLabel ?? 'No.';
  if (await isManualSeries(seriesDocEntry, transaction)) {
    const rows = await db.query<{ No: string | null }>(`SELECT ${target.column} AS [No] FROM ${target.table} WHERE DocEntry = @docEntry`, [
      { name: 'docEntry', value: docEntry },
    ], transaction);
    const no = rows[0]?.No?.trim();
    if (!no) throw new ValidationError(`Key in the ${noLabel}: the series is Manual`);
    if (await numberTaken(target, docEntry, no, transaction)) throw new ValidationError(`${noLabel} ${no} is already used by another ${target.label}`);
    return no;
  }
  // Skipping more than this many used numbers means the series' Seq is far behind: better fixed by hand
  for (let tries = 0; tries < 1000; tries++) {
    const no = await takeNextNumber(seriesDocEntry, postingDate, transaction);
    if (!(await numberTaken(target, docEntry, no, transaction))) return no;
  }
  throw new ValidationError(`The next numbers of this series are all used already. Check the Seq of the series in Document Numbering.`);
}

/** A series with its Date Numbering rows, shaped for the API */
export async function getSeriesDetail(docEntry: number) {
  const rows = await db.query(`${SERIES_SELECT} WHERE h.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Document numbering series');

  const dates = await db.query(
    `SELECT [Year], [Month], Seq FROM FTS11NNM2 WHERE DocEntry = @docEntry ORDER BY [Year], [Month]`,
    [{ name: 'docEntry', value: docEntry }]
  );

  return { ...rows[0], Dates: dates };
}
