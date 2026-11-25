import type sql from 'mssql';
import { db } from './db';
import { NotFoundError, ValidationError } from './errors';

/** Template header columns for the list (FTS11OWTM), with the document name from FTS_vw_ObjType */
export const TEMPLATE_SELECT = `
  SELECT h.DocEntry, h.WtmCode, h.WtmName, h.ObjDoc, v.Name AS ObjDocName, h.Active
  FROM FTS11OWTM h
  LEFT JOIN FTS_vw_ObjType v ON v.Code = h.ObjDoc`;

export interface TemplateFields {
  wtmCode: string;
  wtmName: string;
  objDoc: string;
  active: boolean;
  query: string;
  stageIds: number[];
}

/** Validate a create / update request body for an approval template */
export function parseTemplateFields(body: Record<string, unknown>): TemplateFields {
  const wtmCode = String(body.wtmCode ?? '').trim();
  if (!wtmCode) throw new ValidationError('Template code is required');
  if (wtmCode.length > 100) throw new ValidationError('Template code must be 100 characters or fewer');

  const wtmName = String(body.wtmName ?? '').trim();
  if (!wtmName) throw new ValidationError('Description is required');
  if (wtmName.length > 100) throw new ValidationError('Description must be 100 characters or fewer');

  const objDoc = String(body.objDoc ?? '').trim();
  if (!objDoc) throw new ValidationError('Document is required');

  const query = String(body.query ?? '').trim();
  if (!query) throw new ValidationError('Query is required');

  const rawIds = Array.isArray(body.stageIds) ? body.stageIds : [];
  const stageIds = [...new Set(rawIds.map((id) => Number(id)))];
  if (stageIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ValidationError('Approval stage list is not valid');
  }
  if (stageIds.length === 0) throw new ValidationError('Add at least one approval stage');

  return { wtmCode, wtmName, objDoc, active: body.active !== false, query, stageIds };
}

/** ObjDoc must be one of the document types in FTS_vw_ObjType (a view can't carry a foreign key) */
export async function assertDocumentTypeExists(objDoc: string): Promise<void> {
  const found = await db.query(`SELECT Code FROM FTS_vw_ObjType WHERE Code = @objDoc`, [
    { name: 'objDoc', value: objDoc },
  ]);
  if (found.length === 0) throw new ValidationError('Document is not a valid document type');
}

/** FTS11OWTM.WtmCode must be unique; checked here for a friendly message (the table also enforces it) */
export async function assertTemplateCodeAvailable(wtmCode: string, excludeDocEntry?: number): Promise<void> {
  const existing = await db.query(
    `SELECT DocEntry FROM FTS11OWTM WHERE WtmCode = @wtmCode AND DocEntry <> @excludeDocEntry`,
    [
      { name: 'wtmCode', value: wtmCode },
      { name: 'excludeDocEntry', value: excludeDocEntry ?? 0 },
    ]
  );
  if (existing.length > 0) throw new ValidationError('Template code already exists');
}

/**
 * Every stage must be an existing approval stage that can actually approve: at least one active approver, and at
 * least as many active approvers as its Approvals Required — otherwise a document sent to it would wait for ever.
 */
export async function assertStagesExist(stageIds: number[]): Promise<void> {
  const found = await db.query<{ DocEntry: number }>(
    `SELECT DocEntry FROM FTS11OWST WHERE DocEntry IN (${stageIds.map((_, i) => `@s${i}`).join(', ')})`,
    stageIds.map((id, i) => ({ name: `s${i}`, value: id }))
  );
  if (found.length !== stageIds.length) throw new ValidationError('One or more approval stages no longer exist');
  const problem = await stageWithoutApprovers(
    `s.DocEntry IN (${stageIds.map((_, i) => `@s${i}`).join(', ')})`,
    stageIds.map((id, i) => ({ name: `s${i}`, value: id }))
  );
  if (problem) throw new ValidationError(problem);
}

/**
 * The first stage (of those matching `where`, on FTS11OWST s) that can't approve: no active approver, or fewer active
 * approvers than its Approvals Required. Returns a message for the user, or null when all can approve.
 */
export async function stageWithoutApprovers(
  where: string,
  params: { name: string; value: unknown }[],
  transaction?: sql.Transaction
): Promise<string | null> {
  const rows = await db.query<{ WstCode: string; MaxReqr: number; Active: number }>(
    `SELECT s.WstCode, s.MaxReqr,
            (SELECT COUNT(*) FROM FTS11WST1 a JOIN SystemUsers u ON u.DocEntry = a.UserID
             WHERE a.DocEntry = s.DocEntry AND u.IsActive = 1) AS Active
     FROM FTS11OWST s
     WHERE ${where}
     ORDER BY s.WstCode`,
    params,
    transaction
  );
  const bad = rows.find((r) => r.Active === 0 || r.Active < r.MaxReqr);
  if (!bad) return null;
  return bad.Active === 0
    ? `Approval stage ${bad.WstCode} has no active approver: add one in Approval Stage first`
    : `Approval stage ${bad.WstCode} needs ${bad.MaxReqr} approvals but has only ${bad.Active} active approver(s): fix it in Approval Stage first`;
}

/**
 * Replace a template's stages (FTS11WTM1) inside a transaction. StageNo = their order in `stageIds` (1, 2, 3 ...),
 * i.e. the order they were assigned; stages are approved in this order.
 */
export async function saveTemplateStages(docEntry: number, stageIds: number[], transaction: sql.Transaction): Promise<void> {
  await db.query(`DELETE FROM FTS11WTM1 WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }], transaction);
  for (const [index, wstDocEntry] of stageIds.entries()) {
    await db.query(
      `INSERT INTO FTS11WTM1 (DocEntry, WstDocEntry, StageNo) VALUES (@docEntry, @wstDocEntry, @stageNo)`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'wstDocEntry', value: wstDocEntry },
        { name: 'stageNo', value: index + 1 },
      ],
      transaction
    );
  }
}

/** A template with its query and stages, shaped for the API */
export async function getTemplateDetail(docEntry: number) {
  const templates = await db.query(
    `SELECT h.DocEntry, h.WtmCode, h.WtmName, h.ObjDoc, v.Name AS ObjDocName, h.Active, h.Query
     FROM FTS11OWTM h
     LEFT JOIN FTS_vw_ObjType v ON v.Code = h.ObjDoc
     WHERE h.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (templates.length === 0) throw new NotFoundError('Approval template');

  const stages = await db.query(
    `SELECT t.StageNo, s.DocEntry AS WstDocEntry, s.WstCode, s.WstName
     FROM FTS11WTM1 t
     JOIN FTS11OWST s ON s.DocEntry = t.WstDocEntry
     WHERE t.DocEntry = @docEntry
     ORDER BY t.StageNo`,
    [{ name: 'docEntry', value: docEntry }]
  );

  return { ...templates[0], Stages: stages };
}
