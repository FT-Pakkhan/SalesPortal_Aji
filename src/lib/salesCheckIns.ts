import sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { sapTable } from './sapDb';
import { takeNextNumber } from './documentNumbering';
import { reverseGeocode } from './geocoding';

// Sales Check In (FTS11SCIN), A/R Sales:
//   Check In  = a new visit: its No. from Document Numbering (a series of type Sales Check In), the server's time and
//               the user's GPS location (+ its address), status OPEN.
//   Check Out = the time and GPS location (+ address) again, status CLOSED; Duration is worked out by the table.
// A visit belongs to the user's Sales Employee (SystemUsers.SlpCode). A user sees only their Sales Employee's visits;
// a user without a Sales Employee sees all visits (for now) but can't check in.
// One OPEN visit per user at a time.

/** Document type (FTS_vw_ObjType.Code); its numbering series are kept under it */
export const SCIN_OBJTYPE = 'FTS11SCIN';

const OPEN = 'OPEN';
const CLOSED = 'CLOSED';

/** A function because the SAP database name (Sales Employee names, OSLP) comes from .env.local */
export const visitSelect = () => `
  SELECT v.DocEntry, v.DocNum, v.Series, n.Series AS SeriesCode, n.SeriesName,
         v.CardCode, v.CardName, v.SlpCode, (SELECT sp.SlpName FROM ${sapTable('OSLP')} sp WHERE sp.SlpCode = v.SlpCode) AS SlpName,
         v.UserID, u.UserName, u.DisplayName AS UserDisplayName,
         v.Purpose, v.DocStatus, st.Name AS DocStatusName,
         v.CheckInTime, v.CheckInLat, v.CheckInLng, v.CheckInAccuracy, v.CheckInAddress,
         v.CheckOutTime, v.CheckOutLat, v.CheckOutLng, v.CheckOutAccuracy, v.CheckOutAddress,
         v.Duration, v.Comments
  FROM FTS11SCIN v
  LEFT JOIN FTS11NNM1 n ON n.DocEntry = v.Series
  LEFT JOIN SystemUsers u ON u.DocEntry = v.UserID
  LEFT JOIN FTS_vw_DocStatus st ON st.Code = v.DocStatus`;

/** The user's Sales Employee (null = none) */
async function userSlpCode(userId: number, transaction?: sql.Transaction): Promise<number | null> {
  const rows = await db.query<{ SlpCode: number | null }>(
    `SELECT SlpCode FROM SystemUsers WHERE DocEntry = @userId`,
    [{ name: 'userId', value: userId }],
    transaction
  );
  return rows[0]?.SlpCode ?? null;
}

/** SQL filter and parameters: the visits this user may see (their Sales Employee's; all if they have none) */
async function visibleTo(userId: number) {
  const slpCode = await userSlpCode(userId);
  return slpCode === null
    ? { where: '1 = 1', params: [] as { name: string; value: unknown }[] }
    : { where: 'v.SlpCode = @mySlpCode', params: [{ name: 'mySlpCode', value: slpCode }] };
}

/** The visits this user may see, newest first */
export async function listVisits(userId: number) {
  const scope = await visibleTo(userId);
  return db.query(`${visitSelect()} WHERE ${scope.where} ORDER BY v.CheckInTime DESC, v.DocEntry DESC`, scope.params);
}

/** One visit, if this user may see it (otherwise "not found") */
export async function getVisit(docEntry: number, userId: number) {
  const scope = await visibleTo(userId);
  const rows = await db.query(`${visitSelect()} WHERE v.DocEntry = @docEntry AND ${scope.where}`, [
    { name: 'docEntry', value: docEntry },
    ...scope.params,
  ]);
  if (rows.length === 0) throw new NotFoundError('Sales check-in');
  return rows[0];
}

// ============================================
// Input
// ============================================

export interface GpsPoint {
  lat: number;
  lng: number;
  /** Metres, as the device reports it */
  accuracy: number | null;
}

/** The location sent with Check In / Check Out: required, and a real point on Earth */
export function parseLocation(body: Record<string, unknown>): GpsPoint {
  const raw = body.location as Record<string, unknown> | null | undefined;
  if (!raw) throw new ValidationError('Your location is needed: allow this site to use your location, then try again');
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ValidationError('The location is not valid');
  }
  const accuracy = raw.accuracy == null ? null : Number(raw.accuracy);
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracy: accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(Math.min(accuracy, 1e7) * 100) / 100 : null,
  };
}

/** Purpose (required) and Remarks, up to 254 characters each */
export function parseVisitText(body: Record<string, unknown>) {
  const purpose = String(body.purpose ?? '').trim();
  if (!purpose) throw new ValidationError('Purpose of Visit is required');
  if (purpose.length > 254) throw new ValidationError('Purpose of Visit must be 254 characters or fewer');
  const comments = String(body.comments ?? '').trim();
  if (comments.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');
  return { purpose, comments: comments || null };
}

// ============================================
// Check In / Check Out
// ============================================

/**
 * Check In: a new OPEN visit with its No., the server's time and the user's location (+ address).
 * Refused if the user has no Sales Employee, or still has an OPEN visit. Returns its DocEntry.
 */
export async function checkIn(body: Record<string, unknown>, user: { userId: number; userName: string }): Promise<number> {
  const series = Number(body.series);
  if (!Number.isInteger(series) || series <= 0) throw new ValidationError('Series is required');
  const cardCode = String(body.cardCode ?? '').trim();
  if (!cardCode) throw new ValidationError('Customer is required');
  const cardName = String(body.cardName ?? '').trim().slice(0, 200) || null;
  const { purpose, comments } = parseVisitText(body);
  const location = parseLocation(body);

  const slpCode = await userSlpCode(user.userId);
  if (slpCode === null) throw new ValidationError('Your user has no Sales Employee: set it in Users before checking in');
  const seriesFound = await db.query(`SELECT DocEntry FROM FTS11NNM1 WHERE DocEntry = @series AND ObjType = @objType AND Active = 1`, [
    { name: 'series', value: series },
    { name: 'objType', value: SCIN_OBJTYPE },
  ]);
  if (seriesFound.length === 0) throw new ValidationError('Series is not an active Sales Check In series');
  const customer = await db.query(`SELECT CardCode FROM ${sapTable('OCRD')} WHERE CardCode = @cardCode AND CardType = 'C'`, [
    { name: 'cardCode', value: cardCode },
  ]);
  if (customer.length === 0) throw new ValidationError('Customer does not exist in SAP');

  // Looked up before the transaction: a slow answer mustn't hold the numbering series locked
  const address = await reverseGeocode(location.lat, location.lng);

  const transaction = await db.beginTransaction();
  try {
    // Locked so the same user can't check in twice at the same moment
    const open = await db.query<{ DocNum: string; CardCode: string }>(
      `SELECT DocNum, CardCode FROM FTS11SCIN WITH (UPDLOCK, HOLDLOCK) WHERE UserID = @userId AND DocStatus = @open`,
      [
        { name: 'userId', value: user.userId },
        { name: 'open', value: OPEN },
      ],
      transaction
    );
    if (open.length > 0) {
      throw new ValidationError(`You are still checked in at ${open[0].CardCode} (visit ${open[0].DocNum}): check out first`);
    }

    const docNum = await takeNextNumber(series, new Date(), transaction);
    const taken = await db.query(`SELECT DocEntry FROM FTS11SCIN WHERE DocNum = @docNum`, [{ name: 'docNum', value: docNum }], transaction);
    if (taken.length > 0) throw new ValidationError(`No. ${docNum} is already used. Check the Seq of this series in Document Numbering.`);

    const result = await db.query<{ DocEntry: number }>(
      `INSERT INTO FTS11SCIN (DocNum, Series, CardCode, CardName, SlpCode, UserID, Purpose, DocStatus,
                              CheckInTime, CheckInLat, CheckInLng, CheckInAccuracy, CheckInAddress, Comments,
                              CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
       OUTPUT INSERTED.DocEntry
       VALUES (@docNum, @series, @cardCode, @cardName, @slpCode, @userId, @purpose, @open,
               GETDATE(), @lat, @lng, @accuracy, @address, @comments,
               @userName, GETDATE(), @userName, GETDATE())`,
      // Untyped: types set from this shared file aren't recognised by the database driver
      [
        { name: 'docNum', value: docNum },
        { name: 'series', value: series },
        { name: 'cardCode', value: cardCode },
        { name: 'cardName', value: cardName },
        { name: 'slpCode', value: slpCode },
        { name: 'userId', value: user.userId },
        { name: 'purpose', value: purpose },
        { name: 'open', value: OPEN },
        { name: 'lat', value: location.lat },
        { name: 'lng', value: location.lng },
        { name: 'accuracy', value: location.accuracy },
        { name: 'address', value: address },
        { name: 'comments', value: comments },
        { name: 'userName', value: user.userName },
      ],
      transaction
    );
    await db.commitTransaction(transaction);
    return result[0].DocEntry;
  } catch (error) {
    await db.rollbackTransaction(transaction);
    throw error;
  }
}

/** Check Out: the server's time and the user's location (+ address), CLOSED. Only the user who checked in. */
export async function checkOut(docEntry: number, body: Record<string, unknown>, user: { userId: number; userName: string }) {
  const location = parseLocation(body);
  const comments = body.comments === undefined ? undefined : String(body.comments ?? '').trim() || null;
  if (comments && comments.length > 254) throw new ValidationError('Remarks must be 254 characters or fewer');

  const visit = await ownVisit(docEntry, user.userId);
  if (visit.DocStatus !== OPEN) throw new ValidationError('This visit is already checked out');

  const address = await reverseGeocode(location.lat, location.lng);
  await db.query(
    `UPDATE FTS11SCIN
     SET DocStatus = @closed, CheckOutTime = GETDATE(), CheckOutLat = @lat, CheckOutLng = @lng,
         CheckOutAccuracy = @accuracy, CheckOutAddress = @address,
         Comments = CASE WHEN @keepComments = 1 THEN Comments ELSE @comments END,
         UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry AND DocStatus = @open`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'closed', value: CLOSED },
      { name: 'open', value: OPEN },
      { name: 'lat', value: location.lat },
      { name: 'lng', value: location.lng },
      { name: 'accuracy', value: location.accuracy },
      { name: 'address', value: address },
      { name: 'keepComments', value: comments === undefined ? 1 : 0 },
      { name: 'comments', value: comments ?? null },
      { name: 'userName', value: user.userName },
    ]
  );
}

/** Edit: Purpose and Remarks only (times and locations are never typed). Only the user who checked in. */
export async function updateVisitText(docEntry: number, body: Record<string, unknown>, user: { userId: number; userName: string }) {
  const { purpose, comments } = parseVisitText(body);
  await ownVisit(docEntry, user.userId);
  await db.query(
    `UPDATE FTS11SCIN SET Purpose = @purpose, Comments = @comments, UpdatedBy = @userName, UpdatedDate = GETDATE()
     WHERE DocEntry = @docEntry`,
    [
      { name: 'docEntry', value: docEntry },
      { name: 'purpose', value: purpose },
      { name: 'comments', value: comments },
      { name: 'userName', value: user.userName },
    ]
  );
}

/** The visit, which must be this user's own (someone else's: they may see it, but not change it) */
async function ownVisit(docEntry: number, userId: number) {
  const rows = await db.query<{ DocStatus: string; UserID: number }>(
    `SELECT DocStatus, UserID FROM FTS11SCIN WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (rows.length === 0) throw new NotFoundError('Sales check-in');
  if (rows[0].UserID !== userId) throw new ValidationError('Only the user who checked in can change this visit');
  return rows[0];
}
