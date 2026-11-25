import { access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { DOC_TYPES } from './salesDocuments';

// Print layouts (FTS11SLYT): Crystal Reports .rpt files per document type. A document's Print button offers the
// active layouts of its type.

export const LAYOUT_SELECT = `
  SELECT l.DocEntry, l.LayoutName, l.LayoutPath, l.ObjDoc, v.Name AS ObjDocName, l.IsActive, l.EmailAllowed
  FROM FTS11SLYT l
  LEFT JOIN FTS_vw_ObjType v ON v.Code = l.ObjDoc`;

export interface LayoutFields {
  layoutName: string;
  layoutPath: string;
  objDoc: string;
  isActive: boolean;
  emailAllowed: boolean;
}

/** Validate a save request */
export function parseLayoutFields(body: Record<string, unknown>): LayoutFields {
  const layoutName = String(body.layoutName ?? '').trim();
  if (!layoutName) throw new ValidationError('Layout Name is required');
  if (layoutName.length > 100) throw new ValidationError('Layout Name must be 100 characters or fewer');

  const layoutPath = String(body.layoutPath ?? '').trim();
  if (!layoutPath) throw new ValidationError('Layout Path is required');
  if (layoutPath.length > 254) throw new ValidationError('Layout Path must be 254 characters or fewer');
  if (!path.isAbsolute(layoutPath)) {
    throw new ValidationError('Layout Path must be a full path on the server, e.g. D:\\SalesPortal_Layouts\\SalesQuotation.rpt');
  }
  if (path.extname(layoutPath).toLowerCase() !== '.rpt') throw new ValidationError('Layout Path must be a Crystal Reports file (.rpt)');

  const objDoc = String(body.objDoc ?? '').trim();
  if (!objDoc) throw new ValidationError('Document is required');

  return { layoutName, layoutPath, objDoc, isActive: body.isActive !== false, emailAllowed: body.emailAllowed === true };
}

/** Document must be one of FTS_vw_ObjType (a view can't carry a foreign key) */
export async function assertLayoutDocumentType(objDoc: string): Promise<void> {
  const found = await db.query(`SELECT Code FROM FTS_vw_ObjType WHERE Code = @objDoc`, [{ name: 'objDoc', value: objDoc }]);
  if (found.length === 0) throw new ValidationError('Document is not a valid document type');
}

/** The same Layout Name can't be used twice for one document type (the table enforces it too) */
export async function assertLayoutNameAvailable(fields: LayoutFields, excludeDocEntry?: number): Promise<void> {
  const found = await db.query(
    `SELECT DocEntry FROM FTS11SLYT WHERE ObjDoc = @objDoc AND LayoutName = @layoutName AND DocEntry <> @exclude`,
    [
      { name: 'objDoc', value: fields.objDoc },
      { name: 'layoutName', value: fields.layoutName },
      { name: 'exclude', value: excludeDocEntry ?? 0 },
    ]
  );
  if (found.length > 0) throw new ValidationError('This document already has a layout with that name');
}

/**
 * A save that still hits the table's unique Layout Name rule (e.g. two users saving the same name at once) gets the
 * same friendly message instead of the database's error
 */
export function friendlyLayoutSaveError(error: unknown): unknown {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('UQ_FTS11SLYT_Name') ? new ValidationError('This document already has a layout with that name') : error;
}

/** The .rpt file must exist and be readable by the portal (checked on save, and again when printing) */
export async function assertLayoutFileExists(layoutPath: string): Promise<void> {
  try {
    await access(layoutPath, constants.R_OK);
  } catch {
    throw new ValidationError(`The portal can't find or read the layout file ${layoutPath}`);
  }
}

export async function getLayout(docEntry: number) {
  const rows = await db.query(`${LAYOUT_SELECT} WHERE l.DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (rows.length === 0) throw new NotFoundError('Layout');
  return rows[0];
}

/** The layout to print a document of `objType` with: it must exist, be active and be for that document type */
export async function getPrintableLayout(
  docEntry: number,
  objType: string
): Promise<{ LayoutPath: string; LayoutName: string; EmailAllowed: boolean }> {
  const rows = await db.query<{ LayoutPath: string; LayoutName: string; ObjDoc: string; IsActive: boolean; EmailAllowed: boolean }>(
    `SELECT LayoutPath, LayoutName, ObjDoc, IsActive, EmailAllowed FROM FTS11SLYT WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  const layout = rows[0];
  if (!layout) throw new NotFoundError('Layout');
  if (!layout.IsActive) throw new ValidationError(`Layout ${layout.LayoutName} is not active`);
  if (layout.ObjDoc !== objType) throw new ValidationError(`Layout ${layout.LayoutName} is for another document type`);
  await assertLayoutFileExists(layout.LayoutPath);
  return layout;
}

/**
 * Documents that can be printed: every document type of the Layouts screen (FTS_vw_ObjType) - the sales documents,
 * Inventory Transfer, Temporary Receipt Request, Temporary Receipt, Lead, Convert to Customer and Sales Check In.
 * number: the column holding the document's No. (empty on a draft); email: the document's own e-mail column (Lead,
 * Convert to Customer), else the customer's SAP e-mail (OCRD.E_Mail) is offered when the document has a CardCode.
 */
export const PRINTABLE: Record<string, { header: string; label: string; number: string; email?: string }> = {
  ...Object.fromEntries(Object.values(DOC_TYPES).map((d) => [d.objType, { header: d.header, label: d.label, number: 'DocNum' }])),
  FTS11OWTR: { header: 'FTS11OWTR', label: 'Inventory transfer', number: 'DocNum' },
  FTS11OTRQ: { header: 'FTS11OTRQ', label: 'Temporary receipt request', number: 'DocNum' },
  FTS11TMPR: { header: 'FTS11TMPR', label: 'Temporary receipt', number: 'DocNum' },
  FTS11LEAD: { header: 'FTS11LEAD', label: 'Lead', number: 'LeadCode', email: 'Email' },
  FTS11OCRD: { header: 'FTS11OCRD', label: 'Customer conversion', number: 'DocNum', email: 'Email' },
  FTS11SCIN: { header: 'FTS11SCIN', label: 'Sales check in', number: 'DocNum' },
};

/** A printable document type, or an error */
export function printableDocument(objType: string) {
  const doc = PRINTABLE[objType];
  if (!doc) throw new ValidationError('This document type can not be printed');
  return doc;
}
