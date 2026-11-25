import { NextRequest } from 'next/server';
import { db } from './db';
import { authenticateRequest } from './auth';
import { successResponse, errorResponse } from './apiResponse';
import { NotFoundError, ValidationError } from './errors';
import {
  APPR_STATUS,
  DOC_STATUS,
  assertNotInApproval,
  assertNotSynced,
  documentSelect,
  parseDocumentFields,
  assertCustomerExists,
  assertSalesTypeExists,
  assertPaymentTermsExist,
  assertDocumentBranch,
  assertRebateItems,
  assertSalesUoms,
  assertDocumentSeries,
  saveDocumentLines,
  getDocumentDetail,
  totalsParams,
  applyDocumentCurrency,
  getCopySourceLines,
  closeDocument,
  cancelDocument,
  closeDocumentLines,
  openDocument,
  ADDRESS_PARTS,
} from './salesDocuments';
import type { DocumentFields } from './salesDocuments';
import { keepManualNumber, saveDraftNumber } from './documentNumbering';
import type { NumberedTable } from './documentNumbering';
import { autoPostToSap, updateSalesDocumentStatusInSap, withPostResult } from './sapPosting';
import type sql from 'mssql';
import { createApprovalRequests, notifyFirstApprovers, templatesNeedingApproval } from './approvalCheck';
import type { SalesDocType } from './salesDocuments';
import { getCurrencySettings } from './currency';
import { assertDiscountTypes, discountTypesOf } from './discountTypes';
import { assertSellerBank } from './sellerBanks';
import { assertDeliveryZone, assertDocumentAddresses } from './customerAddresses';

// API route handlers shared by every sales document. Each app/api/<document> route file just picks its type, e.g.
//   export const { GET, POST } = documentCollectionRoutes(SALES_ORDER);

/** The Bill To / Ship To Address Lines and Delivery Zones as query parameters (@billStreet ...) */
const addressPartParams = (fields: DocumentFields) => ADDRESS_PARTS.map((p) => ({ name: p.field, value: fields.addressParts[p.field] }));

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Where the document keeps its No. (Document Numbering) */
const numbered = (doc: SalesDocType): NumberedTable => ({ table: doc.header, column: 'DocNum', label: doc.label.toLowerCase() });

/** GET (list, newest first) and POST (save a new document as DRAFT, no No. until it is confirmed) */
export function documentCollectionRoutes(doc: SalesDocType) {
  return {
    GET: async (request: NextRequest) => {
      try {
        authenticateRequest(request);
        return successResponse(await db.query(`${documentSelect(doc)} ORDER BY q.DocEntry DESC`));
      } catch (error) {
        return errorResponse(error);
      }
    },

    POST: async (request: NextRequest) => {
      try {
        const user = authenticateRequest(request);
        const body = await request.json();
        const fields = parseDocumentFields(doc, body);

        await assertSalesTypeExists(fields.salesTyp);
        await assertPaymentTermsExist(fields.groupNum);
        await assertDocumentBranch(fields.branch);
        await assertCustomerExists(fields.cardCode, doc);
        await assertDocumentSeries(doc, fields.series);
        await assertRebateItems(doc, fields.lines);
        await assertSalesUoms(fields.lines);
        await assertDiscountTypes(discountTypesOf(fields));
        await assertSellerBank(fields.bankInfo);
        await assertDocumentAddresses(fields.cardCode, fields.payToCode, fields.shipToCode);
        await assertDeliveryZone(fields.addressParts.billDeliveryZone, 'Bill To');
        await assertDeliveryZone(fields.addressParts.shipDeliveryZone, 'Ship To');
        await applyDocumentCurrency(fields);

        const transaction = await db.beginTransaction();
        let docEntry: number;
        try {
          // DocStatus and ObjType come from the column defaults (DRAFT, the document's own type)
          const result = await db.query<{ DocEntry: number }>(
            `INSERT INTO ${doc.header} (Series, SalesTyp, CardCode, CardName, CntctCode, NumAtCard, GroupNum, COA, Branch, DiscType1, DiscType2, DiscType3, DiscType4, DiscType5, BankInfo, PayToCode, ShipToCode, Address, Address2, ${ADDRESS_PARTS.map((p) => p.column).join(', ')}, Comments, InComments, TAC, DocDate, DocDueDate, TaxDate, SlpCode,
                                        DiscPrcnt, DiscSum, VatSum, DocTotal, DocCur, DocRate, DiscSumFC, VatSumFC, DocTotalFC,
                                        CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
             OUTPUT INSERTED.DocEntry
             VALUES (@series, @salesTyp, @cardCode, @cardName, @cntctCode, @numAtCard, @groupNum, @coa, @branch, @discType1, @discType2, @discType3, @discType4, @discType5, @bankInfo, @payToCode, @shipToCode, @address, @address2, ${ADDRESS_PARTS.map((p) => `@${p.field}`).join(', ')}, @comments, @inComments, @tac, @docDate, @docDueDate, @taxDate, @slpCode,
                     @discPrcnt, @discSum, @vatSum, @docTotal, @docCur, @docRate, @discSumFC, @vatSumFC, @docTotalFC,
                     @userName, GETDATE(), @userName, GETDATE())`,
            [
              { name: 'series', value: fields.series },
              { name: 'salesTyp', value: fields.salesTyp },
              { name: 'cardCode', value: fields.cardCode },
              { name: 'cardName', value: fields.cardName },
              { name: 'cntctCode', value: fields.cntctCode },
              { name: 'numAtCard', value: fields.numAtCard },
              { name: 'groupNum', value: fields.groupNum },
              { name: 'coa', value: fields.coa },
              { name: 'branch', value: fields.branch }, { name: 'discType1', value: fields.discType1 }, { name: 'discType2', value: fields.discType2 }, { name: 'discType3', value: fields.discType3 }, { name: 'discType4', value: fields.discType4 }, { name: 'discType5', value: fields.discType5 }, { name: 'bankInfo', value: fields.bankInfo },
              { name: 'payToCode', value: fields.payToCode }, { name: 'shipToCode', value: fields.shipToCode },
              { name: 'address', value: fields.address }, { name: 'address2', value: fields.address2 },
              ...addressPartParams(fields),
              { name: 'comments', value: fields.comments },
              { name: 'inComments', value: fields.inComments },
              { name: 'tac', value: fields.tac },
              { name: 'docDate', value: fields.docDate },
              { name: 'docDueDate', value: fields.docDueDate },
              { name: 'taxDate', value: fields.taxDate },
              { name: 'slpCode', value: fields.slpCode },
              ...totalsParams(fields),
              { name: 'userName', value: user.userName },
            ],
            transaction
          );
          docEntry = result[0].DocEntry;
          await saveDocumentLines(doc, docEntry, fields.cardCode, fields.lines, user.userName, transaction);
          // Manual series: the No. typed in the No. field (checked on Confirm)
          await saveDraftNumber(numbered(doc), docEntry, fields.series, body.docNum, transaction);
          await db.commitTransaction(transaction);
        } catch (error) {
          await db.rollbackTransaction(transaction);
          throw error;
        }

        return successResponse(await getDocumentDetail(doc, docEntry), `${doc.label} saved as draft`, 201);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

/**
 * GET (one document with its lines) and PUT (update a DRAFT or OPEN document and replace its lines).
 * Once confirmed (OPEN) the Posting Date, Series, Customer and Sales Type can't change (as in SAP B1).
 * A draft whose lines were copied from another document also keeps its customer (checked when saving the lines).
 */
export function documentItemRoutes(doc: SalesDocType) {
  return {
    GET: async (request: NextRequest, context: RouteContext) => {
      try {
        authenticateRequest(request);
        const { id } = await context.params;
        return successResponse(await getDocumentDetail(doc, parseInt(id)));
      } catch (error) {
        return errorResponse(error);
      }
    },

    PUT: async (request: NextRequest, context: RouteContext) => {
      try {
        const user = authenticateRequest(request);
        const { id } = await context.params;
        const docEntry = parseInt(id);
        const body = await request.json();
        const fields = parseDocumentFields(doc, body);

        const existing = await db.query<{
          DocStatus: string;
          ApprStatus: string;
          PostStatus: string;
          Series: number | null;
          DocDate: string;
          CardCode: string;
          SalesTyp: string | null;
          GroupNum: number | null;
          COA: string | null;
          Branch: string | null;
          InComments: string | null;
          TAC: string | null;
          DiscType1: string | null;
          DiscType2: string | null;
          DiscType3: string | null;
          DiscType4: string | null;
          DiscType5: string | null;
          BankInfo: string | null;
          PayToCode: string | null;
          ShipToCode: string | null;
          Address: string | null;
          Address2: string | null;
          DocCur: string | null;
          [column: string]: unknown;
          DocRate: number;
        }>(
          `SELECT DocStatus, ApprStatus, PostStatus, Series, CONVERT(CHAR(8), DocDate, 112) AS DocDate, CardCode, SalesTyp, GroupNum, COA, Branch, InComments, TAC, DiscType1, DiscType2, DiscType3, DiscType4, DiscType5, BankInfo,
                  PayToCode, ShipToCode, Address, Address2, ${ADDRESS_PARTS.map((p) => p.column).join(', ')}, DocCur, DocRate
           FROM ${doc.header} WHERE DocEntry = @docEntry`,
          [{ name: 'docEntry', value: docEntry }]
        );
        if (existing.length === 0) throw new NotFoundError(doc.label);
        const current = existing[0];
        // No Sales Type on screen: keep whatever the document has (one saved before it was hidden keeps its own)
        if (doc.noSalesType) fields.salesTyp = current.SalesTyp;
        // No Payment Terms on screen: the same
        if (doc.noPaymentTerms) fields.groupNum = current.GroupNum;
        // No COA on screen: the same
        if (doc.noCoa) fields.coa = current.COA;
        // No Internal Remarks / T&C on screen: the same
        if (doc.noExtraRemarks) {
          fields.inComments = current.InComments;
          fields.tac = current.TAC;
        }
        // No Discount Type on screen: the same
        if (doc.noDiscType) {
          fields.discType1 = current.DiscType1;
          fields.discType2 = current.DiscType2;
          fields.discType3 = current.DiscType3;
          fields.discType4 = current.DiscType4;
          fields.discType5 = current.DiscType5;
        }
        // No Bank Info on screen: the same
        if (doc.noBankInfo) fields.bankInfo = current.BankInfo;
        // No Delivery tab on screen: the same
        if (doc.noAddresses) {
          fields.payToCode = current.PayToCode;
          fields.shipToCode = current.ShipToCode;
          fields.address = current.Address;
          fields.address2 = current.Address2;
          for (const p of ADDRESS_PARTS) fields.addressParts[p.field] = (current[p.column] as string | null) ?? null;
        }
        await assertNotInApproval(doc, docEntry, current.ApprStatus);
        assertNotSynced(doc.label.toLowerCase(), current.PostStatus);

        if (current.DocStatus !== DOC_STATUS.draft && current.DocStatus !== DOC_STATUS.open) {
          throw new ValidationError(`A ${current.DocStatus} ${doc.label.toLowerCase()} can't be changed`);
        }
        if (current.DocStatus === DOC_STATUS.open) {
          if (fields.docDate !== current.DocDate) throw new ValidationError("Posting Date can't be changed after confirming");
          if (fields.series !== current.Series) throw new ValidationError("Series can't be changed after confirming");
          if (fields.cardCode !== current.CardCode) throw new ValidationError("Customer can't be changed after confirming");
          // A document confirmed before Sales Type existed may still set it once
          if (current.SalesTyp && fields.salesTyp !== current.SalesTyp) {
            throw new ValidationError("Sales Type can't be changed after confirming");
          }
          // Branch is fixed once confirmed, like Sales Type (one confirmed before Branch existed may still set it once)
          if (current.Branch && fields.branch !== current.Branch) {
            throw new ValidationError("Branch can't be changed after confirming");
          }
          if (fields.lines.length === 0) throw new ValidationError('A confirmed document needs at least one line');
        }

        await assertSalesTypeExists(fields.salesTyp);
        if (!doc.noPaymentTerms) await assertPaymentTermsExist(fields.groupNum);
        if (fields.branch !== current.Branch) await assertDocumentBranch(fields.branch);
        await assertCustomerExists(fields.cardCode, doc, current.CardCode);
        if (current.DocStatus === DOC_STATUS.draft) await assertDocumentSeries(doc, fields.series);
        await assertRebateItems(doc, fields.lines);
        await assertSalesUoms(fields.lines);
        await assertDiscountTypes(discountTypesOf(fields), [current.DiscType1, current.DiscType2, current.DiscType3, current.DiscType4, current.DiscType5]);
        if (fields.bankInfo !== current.BankInfo) await assertSellerBank(fields.bankInfo);
        // Bill To / Ship To checked when chosen again or the customer changed (one kept as saved stays as it is)
        if (fields.cardCode !== current.CardCode || fields.payToCode !== current.PayToCode || fields.shipToCode !== current.ShipToCode) {
          await assertDocumentAddresses(fields.cardCode, fields.payToCode, fields.shipToCode);
        }
        if (fields.addressParts.billDeliveryZone !== current.BillDeliveryZone) await assertDeliveryZone(fields.addressParts.billDeliveryZone, 'Bill To');
        if (fields.addressParts.shipDeliveryZone !== current.ShipDeliveryZone) await assertDeliveryZone(fields.addressParts.shipDeliveryZone, 'Ship To');
        // A confirmed document keeps its currency and rate (its Posting Date is fixed too). One confirmed before
        // currencies existed (no DocCur) is in the local currency.
        await applyDocumentCurrency(
          fields,
          current.DocStatus === DOC_STATUS.open
            ? { docCur: current.DocCur ?? (await getCurrencySettings()).local, docRate: Number(current.DocRate) || 1 }
            : undefined
        );

        const transaction = await db.beginTransaction();
        try {
          await db.query(
            `UPDATE ${doc.header}
             SET Series = @series, SalesTyp = @salesTyp, CardCode = @cardCode, CardName = @cardName, CntctCode = @cntctCode, NumAtCard = @numAtCard, GroupNum = @groupNum, COA = @coa, Branch = @branch, DiscType1 = @discType1, DiscType2 = @discType2, DiscType3 = @discType3, DiscType4 = @discType4, DiscType5 = @discType5, BankInfo = @bankInfo,
                 PayToCode = @payToCode, ShipToCode = @shipToCode, Address = @address, Address2 = @address2,
                 ${ADDRESS_PARTS.map((p) => `${p.column} = @${p.field}`).join(', ')},
                 Comments = @comments, InComments = @inComments, TAC = @tac, DocDate = @docDate, DocDueDate = @docDueDate, TaxDate = @taxDate, SlpCode = @slpCode,
                 DiscPrcnt = @discPrcnt, DiscSum = @discSum, VatSum = @vatSum, DocTotal = @docTotal,
                 DocCur = @docCur, DocRate = @docRate, DiscSumFC = @discSumFC, VatSumFC = @vatSumFC, DocTotalFC = @docTotalFC,
                 UpdatedBy = @userName, UpdatedDate = GETDATE()
             WHERE DocEntry = @docEntry`,
            [
              { name: 'docEntry', value: docEntry },
              { name: 'series', value: fields.series },
              { name: 'salesTyp', value: fields.salesTyp },
              { name: 'cardCode', value: fields.cardCode },
              { name: 'cardName', value: fields.cardName },
              { name: 'cntctCode', value: fields.cntctCode },
              { name: 'numAtCard', value: fields.numAtCard },
              { name: 'groupNum', value: fields.groupNum },
              { name: 'coa', value: fields.coa },
              { name: 'branch', value: fields.branch }, { name: 'discType1', value: fields.discType1 }, { name: 'discType2', value: fields.discType2 }, { name: 'discType3', value: fields.discType3 }, { name: 'discType4', value: fields.discType4 }, { name: 'discType5', value: fields.discType5 }, { name: 'bankInfo', value: fields.bankInfo },
              { name: 'payToCode', value: fields.payToCode }, { name: 'shipToCode', value: fields.shipToCode },
              { name: 'address', value: fields.address }, { name: 'address2', value: fields.address2 },
              ...addressPartParams(fields),
              { name: 'comments', value: fields.comments },
              { name: 'inComments', value: fields.inComments },
              { name: 'tac', value: fields.tac },
              { name: 'docDate', value: fields.docDate },
              { name: 'docDueDate', value: fields.docDueDate },
              { name: 'taxDate', value: fields.taxDate },
              { name: 'slpCode', value: fields.slpCode },
              ...totalsParams(fields),
              { name: 'userName', value: user.userName },
            ],
            transaction
          );
          await saveDocumentLines(doc, docEntry, fields.cardCode, fields.lines, user.userName, transaction);
          // A draft on a manual series: the No. typed in the No. field (checked on Confirm); nothing once confirmed
          await saveDraftNumber(numbered(doc), docEntry, fields.series, body.docNum, transaction);
          await db.commitTransaction(transaction);
        } catch (error) {
          await db.rollbackTransaction(transaction);
          throw error;
        }

        return successResponse(await getDocumentDetail(doc, docEntry), `${doc.label} updated`);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

/** GET ?cardCode=: the open lines of OPEN documents this document can copy from (Copy From), for one customer */
export function documentCopySourceRoute(doc: SalesDocType) {
  return {
    GET: async (request: NextRequest) => {
      try {
        authenticateRequest(request);
        const cardCode = request.nextUrl.searchParams.get('cardCode')?.trim();
        if (!cardCode) throw new ValidationError('Choose a customer first');
        return successResponse(await getCopySourceLines(doc, cardCode));
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

/**
 * POST handlers for Close Doc, Cancel Doc and Close Line (body { lineNums: number[] }). Each runs in one transaction
 * and answers with the document as it is afterwards.
 */
export function documentStatusRoutes(doc: SalesDocType) {
  const run = (
    action: (docEntry: number, userName: string, body: Record<string, unknown>, transaction: sql.Transaction) => Promise<unknown>,
    done: string
  ) => ({
    POST: async (request: NextRequest, context: RouteContext) => {
      try {
        const user = authenticateRequest(request);
        const { id } = await context.params;
        const docEntry = parseInt(id);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const transaction = await db.beginTransaction();
        try {
          await action(docEntry, user.userName, body, transaction);
          await db.commitTransaction(transaction);
        } catch (error) {
          await db.rollbackTransaction(transaction);
          throw error;
        }
        return successResponse(await getDocumentDetail(doc, docEntry), done);
      } catch (error) {
        return errorResponse(error);
      }
    },
  });

  // A sales order / credit memo posted to SAP is closed / canceled there too, last, before the portal's change is
  // committed: SAP refusing rolls the portal back
  const inSap = (docEntry: number, action: 'close' | 'cancel' | 'closeLines', lineNums: number[], tx: sql.Transaction) =>
    updateSalesDocumentStatusInSap(doc, docEntry, action, lineNums, tx);

  return {
    close: run(async (docEntry, userName, _body, tx) => {
      await closeDocument(doc, docEntry, userName, tx);
      await inSap(docEntry, 'close', [], tx);
    }, `${doc.label} closed`),
    cancel: run(async (docEntry, userName, _body, tx) => {
      await cancelDocument(doc, docEntry, userName, tx);
      await inSap(docEntry, 'cancel', [], tx);
    }, `${doc.label} canceled`),
    closeLines: run(async (docEntry, userName, body, tx) => {
      const lineNums = Array.isArray(body.lineNums) ? body.lineNums.map(Number) : [];
      await closeDocumentLines(doc, docEntry, lineNums, userName, tx);
      await inSap(docEntry, 'closeLines', lineNums, tx);
    }, 'Lines closed'),
  };
}

/** POST: confirm a DRAFT document — straight to OPEN with its No., or (approval needed) PENDING approval as a draft */
export function documentConfirmRoute(doc: SalesDocType) {
  return {
    POST: async (request: NextRequest, context: RouteContext) => {
      try {
        const user = authenticateRequest(request);
        const { id } = await context.params;
        const docEntry = parseInt(id);
        // { docNum }: the No. keyed in, for a manual series (no body otherwise)
        const body = (await request.json().catch(() => ({}))) as { docNum?: unknown };

        const transaction = await db.beginTransaction();
        try {
          // Locked so the same document can't be confirmed twice at the same moment
          const rows = await db.query<{ DocStatus: string; ApprStatus: string; Series: number | null; LineCount: number }>(
            `SELECT q.DocStatus, q.ApprStatus, q.Series,
                    (SELECT COUNT(*) FROM ${doc.lines} l WHERE l.DocEntry = q.DocEntry) AS LineCount
             FROM ${doc.header} q WITH (UPDLOCK, HOLDLOCK)
             WHERE q.DocEntry = @docEntry`,
            [{ name: 'docEntry', value: docEntry }],
            transaction
          );
          const document = rows[0];
          if (!document) throw new NotFoundError(doc.label);
          if (document.DocStatus !== DOC_STATUS.draft) throw new ValidationError(`Only a DRAFT ${doc.label.toLowerCase()} can be confirmed`);
          await assertNotInApproval(doc, docEntry, document.ApprStatus, transaction);
          if (document.Series === null) throw new ValidationError('Choose a Series before confirming');
          if (document.LineCount === 0) throw new ValidationError('Add at least one line before confirming');
          // Manual series: the No. (sent with Confirm, else typed and saved on the draft) is checked and kept now
          // (also while waiting for approval)
          await keepManualNumber(numbered(doc), docEntry, document.Series, body.docNum, transaction);

          // Approval first (as in SAP B1): the active templates of this document type run their query for this
          // draft. Any row returned -> it waits for approval: stays DRAFT, ApprStatus PENDING, no No. yet (a manual No. is kept).
          // None -> confirmed now: No., OPEN, and ApprStatus stays NO-APPROVAL (it never went through approval).
          const needing = await templatesNeedingApproval(doc.objType, docEntry, transaction);
          if (needing.length > 0) {
            await createApprovalRequests(doc.objType, docEntry, needing, transaction);
            // ConfirmedBy / Date = who sent it for approval, and when (kept when it is approved later)
            await db.query(
              `UPDATE ${doc.header}
               SET ApprStatus = @pending, ConfirmedBy = @userName, ConfirmedDate = GETDATE(),
                   UpdatedBy = @userName, UpdatedDate = GETDATE()
               WHERE DocEntry = @docEntry`,
              [
                { name: 'docEntry', value: docEntry },
                { name: 'pending', value: APPR_STATUS.pending },
                { name: 'userName', value: user.userName },
              ],
              transaction
            );
            await notifyFirstApprovers(doc.objType, docEntry, transaction);
          } else {
            await openDocument(doc, docEntry, user.userName, APPR_STATUS.none, transaction);
          }
          await db.commitTransaction(transaction);
        } catch (error) {
          await db.rollbackTransaction(transaction);
          throw error;
        }

        // Confirmed (no approval needed): a Sales Order goes to SAP straight away (FAILED with the reason if not)
        const post = await autoPostToSap(doc.objType, docEntry, user.userId);
        const detail = await getDocumentDetail(doc, docEntry);
        const sentForApproval = (detail as { ApprStatus?: string }).ApprStatus === APPR_STATUS.pending;
        return successResponse(
          detail,
          sentForApproval
            ? `${doc.label} sent for approval. ${(detail as { DocNum?: string }).DocNum ? `No. ${(detail as { DocNum?: string }).DocNum} is kept for it.` : 'It gets its No. once approved.'}`
            : withPostResult(`${doc.label} confirmed: No. ${(detail as { DocNum?: string }).DocNum}`, post)
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
