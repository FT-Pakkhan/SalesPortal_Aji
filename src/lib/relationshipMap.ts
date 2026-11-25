import { db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { DOC_TYPES } from './salesDocuments';
import type { SalesDocType } from './salesDocuments';

// Relationship Map (as in SAP B1) of the portal's documents: a document, the documents it was copied from and the
// documents copied from it, followed both ways until nothing new turns up - so a document copied into several shows
// every branch. Portal documents only; SAP B1 documents aren't followed.
//   Sales Quotation -> Sales Order: Copy From / Copy To (BaseType / BaseEntry on the target's lines)
//   Temporary Receipt Request -> Temporary Receipt: Copy To (BaseType / BaseEntry on the receipt's header)
//   Lead -> Convert to Customer: the lead's Copy To / Copy From Lead (LeadEntry on the conversion)

/** A map never grows past this many documents (a safety stop) */
const MAX_NODES = 200;

export interface MapNode {
  id: string;
  objType: string;
  docEntry: number;
}

/** Every document type on a map: its header table, name, and the header columns a box shows (as SQL on `h`) */
interface MapDocType {
  header: string;
  label: string;
  /** SQL for its date (a type without one: NULL) */
  date: string;
  /** SQL for its posting status (a type never posted: NULL) */
  postStatus: string;
  /** SQL for its No., customer code, customer name and total (a type without a total: NULL) */
  docNum: string;
  cardCode: string;
  cardName: string;
  total: string;
}

/** The usual header columns (sales documents, receipt requests, receipts) */
const DOC_COLUMNS = { docNum: 'h.DocNum', cardCode: 'h.CardCode', cardName: 'h.CardName', total: 'h.DocTotal' };

const MAP_TYPES: Record<string, MapDocType> = {
  ...Object.fromEntries(
    Object.values(DOC_TYPES).map((d): [string, MapDocType] => [
      d.objType,
      { header: d.header, label: d.label, date: 'h.DocDate', postStatus: 'h.PostStatus', ...DOC_COLUMNS },
    ])
  ),
  FTS11OTRQ: { header: 'FTS11OTRQ', label: 'Temporary receipt request', date: 'h.DocDate', postStatus: 'NULL', ...DOC_COLUMNS },
  FTS11TMPR: { header: 'FTS11TMPR', label: 'Temporary receipt', date: 'h.DocDate', postStatus: 'h.PostStatus', ...DOC_COLUMNS },
  // A lead's No. is its Lead Code; its customer code is the SAP BP Code once converted. Neither has a total.
  FTS11LEAD: { header: 'FTS11LEAD', label: 'Lead', date: 'ISNULL(h.DocDate, h.ConfirmedDate)', postStatus: 'h.PostStatus', docNum: 'h.LeadCode', cardCode: 'h.CardCode', cardName: 'h.LeadName', total: 'NULL' },
  FTS11OCRD: { header: 'FTS11OCRD', label: 'Convert to customer', date: 'h.DocDate', postStatus: 'h.PostStatus', docNum: 'h.DocNum', cardCode: 'h.CardCode', cardName: 'h.LeadName', total: 'NULL' },
};

/** The sales document types copied FROM `doc` (its targets), e.g. Sales Quotation -> Sales Order */
const targetsOf = (doc: SalesDocType) => Object.values(DOC_TYPES).filter((t) => t.copyFrom?.some((s) => s.objType === doc.objType));

const idOf = (objType: string, docEntry: number) => `${objType}:${docEntry}`;

/** Documents linked to one document: its sources and its targets */
async function neighbours(objType: string, docEntry: number): Promise<{ from: MapNode[]; to: MapNode[] }> {
  const from: MapNode[] = [];
  const to: MapNode[] = [];
  const node = (type: string, entry: number): MapNode => ({ id: idOf(type, entry), objType: type, docEntry: entry });

  // Lead -> its Convert to Customer documents (e.g. a canceled one and the next: both); a conversion -> its lead
  if (objType === 'FTS11LEAD') {
    const rows = await db.query<{ DocEntry: number }>(`SELECT DocEntry FROM FTS11OCRD WHERE LeadEntry = @docEntry`, [
      { name: 'docEntry', value: docEntry },
    ]);
    for (const r of rows) to.push(node('FTS11OCRD', r.DocEntry));
    return { from, to };
  }
  if (objType === 'FTS11OCRD') {
    const rows = await db.query<{ LeadEntry: number }>(`SELECT LeadEntry FROM FTS11OCRD WHERE DocEntry = @docEntry`, [
      { name: 'docEntry', value: docEntry },
    ]);
    if (rows[0]) from.push(node('FTS11LEAD', rows[0].LeadEntry));
    return { from, to };
  }

  // Temporary Receipt Request -> its receipts; a receipt -> its request
  if (objType === 'FTS11OTRQ') {
    const rows = await db.query<{ DocEntry: number }>(
      `SELECT DocEntry FROM FTS11TMPR WHERE BaseType = 'FTS11OTRQ' AND BaseEntry = @docEntry`,
      [{ name: 'docEntry', value: docEntry }]
    );
    for (const r of rows) to.push(node('FTS11TMPR', r.DocEntry));
    return { from, to };
  }
  if (objType === 'FTS11TMPR') {
    const rows = await db.query<{ BaseEntry: number | null }>(
      `SELECT BaseEntry FROM FTS11TMPR WHERE DocEntry = @docEntry AND BaseType = 'FTS11OTRQ'`,
      [{ name: 'docEntry', value: docEntry }]
    );
    if (rows[0]?.BaseEntry) from.push(node('FTS11OTRQ', rows[0].BaseEntry));
    return { from, to };
  }

  // Sales documents: their lines' sources, and the lines of other documents copied from them
  const doc = DOC_TYPES[objType];
  if (doc.copyFrom?.length) {
    const rows = await db.query<{ BaseType: string; BaseEntry: number }>(
      `SELECT DISTINCT BaseType, BaseEntry FROM ${doc.lines} WHERE DocEntry = @docEntry AND BaseType IS NOT NULL AND BaseEntry IS NOT NULL`,
      [{ name: 'docEntry', value: docEntry }]
    );
    for (const r of rows) if (DOC_TYPES[r.BaseType]) from.push(node(r.BaseType, r.BaseEntry));
  }
  for (const target of targetsOf(doc)) {
    const rows = await db.query<{ DocEntry: number }>(
      `SELECT DISTINCT DocEntry FROM ${target.lines} WHERE BaseType = @objType AND BaseEntry = @docEntry`,
      [
        { name: 'objType', value: objType },
        { name: 'docEntry', value: docEntry },
      ]
    );
    for (const r of rows) to.push(node(target.objType, r.DocEntry));
  }
  return { from, to };
}

/** Header fields shown in a map box, for the documents of one type */
async function headersOf(type: MapDocType, docEntries: number[]) {
  if (docEntries.length === 0) return [];
  return db.query<Record<string, unknown>>(
    `SELECT h.DocEntry, ${type.docNum} AS DocNum, ${type.date} AS DocDate, ${type.cardCode} AS CardCode, ${type.cardName} AS CardName,
            ${type.total} AS DocTotal,
            h.DocStatus, st.Name AS DocStatusName, h.ApprStatus, ${type.postStatus} AS PostStatus
     FROM ${type.header} h
     LEFT JOIN FTS_vw_DocStatus st ON st.Code = h.DocStatus
     WHERE h.DocEntry IN (${docEntries.map((_, i) => `@d${i}`).join(', ')})`,
    docEntries.map((id, i) => ({ name: `d${i}`, value: id }))
  );
}

/** The map around one document: every document linked to it, directly or through others, and the links */
export async function getRelationshipMap(objType: string, docEntry: number) {
  const start = MAP_TYPES[objType];
  if (!start) throw new ValidationError('This document type has no relationship map');
  const exists = await db.query(`SELECT DocEntry FROM ${start.header} WHERE DocEntry = @docEntry`, [{ name: 'docEntry', value: docEntry }]);
  if (exists.length === 0) throw new NotFoundError(start.label);

  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, { from: string; to: string }>();
  const queue: MapNode[] = [{ id: idOf(objType, docEntry), objType, docEntry }];
  nodes.set(queue[0].id, queue[0]);
  while (queue.length > 0 && nodes.size < MAX_NODES) {
    const node = queue.shift() as MapNode;
    const { from, to } = await neighbours(node.objType, node.docEntry);
    for (const source of from) edges.set(`${source.id}>${node.id}`, { from: source.id, to: node.id });
    for (const target of to) edges.set(`${node.id}>${target.id}`, { from: node.id, to: target.id });
    for (const next of [...from, ...to]) {
      if (!nodes.has(next.id)) {
        nodes.set(next.id, next);
        queue.push(next);
      }
    }
  }

  // Box details, per document type
  const boxes: Record<string, unknown>[] = [];
  for (const [type, info] of Object.entries(MAP_TYPES)) {
    const ofType = [...nodes.values()].filter((n) => n.objType === type);
    const headers = await headersOf(info, ofType.map((n) => n.docEntry));
    for (const h of headers) {
      boxes.push({ Id: idOf(type, h.DocEntry as number), ObjType: type, TypeName: info.label, ...h });
    }
  }
  return {
    StartId: idOf(objType, docEntry),
    Nodes: boxes,
    // Only links between documents that are on the map (a stop at MAX_NODES may leave some out)
    Edges: [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to)),
    Truncated: nodes.size >= MAX_NODES,
  };
}
