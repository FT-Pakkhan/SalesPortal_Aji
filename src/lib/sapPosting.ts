import sql from 'mssql';
import { db } from './db';
import { runDiApi } from './diApi';
import { CONTACT_ROLES, FORM_COLUMNS, getFormContacts } from './leads';
import { CARD_CODE_MAX, CONVERSION_TABLES, assertCardCodeFree, getConversionAddresses } from './customerConversions';
import { NotFoundError, ValidationError } from './errors';
import { getIncomingPaymentSettings, getSavedDiApiLogon } from './generalSettings';
import { notifyPostFailed } from './notifications';
import { sapTable } from './sapDb';
import { getCurrencySettings } from './currency';
import { getAddressParts } from './customerAddresses';
import { assertUomsValid, uomColumns, uomFactor, uomForDi, uomItemJoin } from './sapUom';
import { APPR_STATUS, CREDIT_MEMO, DOC_STATUS, SALES_ORDER } from './salesDocuments';
import type { SalesDocType } from './salesDocuments';

// Post to SAP B1 through DI API (General Settings > SAP DI API log-on):
//   Convert to Customer -> Business Partner master (customer) for its lead, with the SAP BP code keyed in
//   Sales Order        -> SAP Sales Order (SAP's default series gives the number)
//   Credit Memo        -> SAP A/R Credit Memo (likewise)
//   Temporary Receipt  -> SAP Incoming Payment (the documents it pays, the payment means; the rest on account)
//   Inventory Transfer -> SAP Inventory Transfer Request
// Only an OPEN document that needs no (more) approval, not posted yet or failed before, can be posted.
// Steps: PostStatus PENDING (saved first, so it is locked while DI API works) -> DI API -> SUCCESS, or FAILED with
// SAP's error in ErrorDesc (a FAILED document can be corrected and posted again).
// All of them are posted automatically as soon as they are confirmed (or fully approved) - autoPostToSap; Post to SAP
// retries one that FAILED. A lead itself is never posted: it becomes a customer through Convert to Customer.

/** Posting statuses (FTS_vw_PostStatus.Code) */
export const POST_STATUS = { none: 'NO-POSTING', pending: 'PENDING', success: 'SUCCESS', failed: 'FAILED' } as const;

/** Statuses a document must have to be posted */
const POSTABLE_APPR: string[] = [APPR_STATUS.none, APPR_STATUS.approved];
const POSTABLE_POST: string[] = [POST_STATUS.none, POST_STATUS.failed];

interface DiApiResult {
  success: boolean;
  message: string;
}

/**
 * Check the document can be posted and set it PENDING, in one transaction (row locked, so two users can't post it
 * at the same time). `table` comes from this file, never from a request.
 */
async function markPending(table: string, docEntry: number, label: string): Promise<void> {
  const transaction = await db.beginTransaction();
  try {
    const rows = await db.query<{ DocStatus: string; ApprStatus: string; PostStatus: string | null }>(
      `SELECT DocStatus, ApprStatus, PostStatus FROM ${table} WITH (UPDLOCK, HOLDLOCK) WHERE DocEntry = @docEntry`,
      [{ name: 'docEntry', value: docEntry }],
      transaction
    );
    if (rows.length === 0) throw new NotFoundError(label);
    const doc = rows[0];
    const lower = label.toLowerCase();
    if (doc.PostStatus === POST_STATUS.success) throw new ValidationError(`This ${lower} has already been posted to SAP`);
    if (doc.PostStatus === POST_STATUS.pending) throw new ValidationError(`This ${lower} is being posted to SAP`);
    if (doc.DocStatus !== DOC_STATUS.open) throw new ValidationError(`Only an OPEN ${lower} can be posted to SAP`);
    if (!POSTABLE_APPR.includes(doc.ApprStatus)) throw new ValidationError(`This ${lower} is not approved; it can't be posted to SAP`);
    if (!POSTABLE_POST.includes(doc.PostStatus ?? POST_STATUS.none)) throw new ValidationError(`This ${lower} can't be posted to SAP`);

    await db.query(
      `UPDATE ${table} SET PostStatus = @pending, ErrorDesc = NULL WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'pending', value: POST_STATUS.pending },
      ],
      transaction
    );
    await db.commitTransaction(transaction);
  } catch (error) {
    await db.rollbackTransaction(transaction);
    throw error;
  }
}

/** Posting failed: FAILED with the reason, so it can be corrected and posted again */
async function markFailed(table: string, docEntry: number, reason: string): Promise<void> {
  await db.query(`UPDATE ${table} SET PostStatus = @failed, ErrorDesc = @reason WHERE DocEntry = @docEntry`, [
    { name: 'docEntry', value: docEntry },
    { name: 'failed', value: POST_STATUS.failed },
    { name: 'reason', value: reason },
  ]);
}

/**
 * Set PENDING, run the DI API action, then SUCCESS (`onSuccess` saves what SAP gave back) or FAILED. Returns DI API's
 * result: success = false means the document is now FAILED with that message.
 */
async function post<T extends DiApiResult>(
  table: string,
  docEntry: number,
  label: string,
  action: string,
  data: unknown,
  userId: number,
  onSuccess: (result: T) => Promise<void>
): Promise<T | DiApiResult> {
  // Log-on details first: missing settings are reported without touching the document
  const logon = await getSavedDiApiLogon();
  await markPending(table, docEntry, label);
  let result: T | DiApiResult;
  try {
    result = await runDiApi<T>(logon, action, data);
  } catch (error) {
    // No answer / unreadable answer: SAP may or may not have it, so say so
    const message = error instanceof Error ? error.message : String(error);
    result = { success: false, message: `${message}. Check in SAP whether it was created before posting again.` };
  }
  if (result.success) {
    await onSuccess(result as T);
  } else {
    await markFailed(table, docEntry, result.message);
    // The user who clicked Post is told in the portal's bell (a failed notification mustn't hide the result)
    await notifyPostFailed(table, docEntry, userId, result.message).catch(() => undefined);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Posting straight after Confirm / the last approval

/** The documents posted to SAP on their own once confirmed (or fully approved): their header table = ObjType */
const AUTO_POST: Record<string, (docEntry: number, userId: number) => Promise<DiApiResult>> = {
  FTS11ORDR: (docEntry, userId) => postSalesOrderToSap(docEntry, userId),
  FTS11ORIN: (docEntry, userId) => postCreditMemoToSap(docEntry, userId),
  FTS11TMPR: (docEntry, userId) => postReceiptToSap(docEntry, userId),
  FTS11OWTR: (docEntry, userId) => postTransferToSap(docEntry, userId),
  FTS11OCRD: (docEntry, userId) => postConversionToSap(docEntry, userId),
};

/**
 * Post a document just confirmed (OPEN) to SAP, if its type is posted automatically; null if it isn't (a Lead, a
 * quotation...) or isn't OPEN. Never throws: the confirmation stands whatever happens, and a document that couldn't
 * be posted is FAILED with the reason (also when it fails before reaching SAP, e.g. a General Settings account is
 * missing), so the Post to SAP button retries it once corrected. The failure goes to `notifyUserId`'s bell - after an
 * approval, the sender's (who owns the document) rather than the approver's.
 */
export async function autoPostToSap(
  objType: string,
  docEntry: number,
  notifyUserId: number
): Promise<{ posted: boolean; message: string } | null> {
  const postIt = AUTO_POST[objType];
  if (!postIt) return null;
  const rows = await db.query<{ DocStatus: string }>(`SELECT DocStatus FROM ${objType} WHERE DocEntry = @docEntry`, [
    { name: 'docEntry', value: docEntry },
  ]);
  if (rows[0]?.DocStatus !== DOC_STATUS.open) return null;
  try {
    const result = await postIt(docEntry, notifyUserId);
    return { posted: result.success, message: result.message };
  } catch (error) {
    // Refused before reaching SAP (settings missing, a cheque No. not numeric, ...): FAILED with the reason
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(objType, docEntry, message).catch(() => undefined);
    await notifyPostFailed(objType, docEntry, notifyUserId, message).catch(() => undefined);
    return { posted: false, message };
  }
}

/** Who sent a document for approval (its ConfirmedBy), as a user id; null if not found */
export async function senderUserId(objType: string, docEntry: number): Promise<number | null> {
  if (!AUTO_POST[objType]) return null;
  const rows = await db.query<{ DocEntry: number }>(
    `SELECT u.DocEntry FROM ${objType} h JOIN SystemUsers u ON u.UserName = h.ConfirmedBy WHERE h.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  return rows[0]?.DocEntry ?? null;
}

/** "Sales order confirmed: No. X" + what happened in SAP, for the Confirm / Approve answer */
export function withPostResult(message: string, post: { posted: boolean; message: string } | null): string {
  if (!post) return message;
  return post.posted ? `${message}. ${post.message}` : `${message}, but Post to SAP failed: ${post.message}`;
}

// ---------------------------------------------------------------------------
// Convert to Customer -> Business Partner (customer)

/**
 * DI API: add a customer (BusinessPartners = object 2) with the code typed by the user, its BP Group, and the lead's application
 * form: e-mail, phone, credit limit, payment terms, remarks, addresses (bill-to / ship-to; country before state, as
 * SAP checks the state against the country) and contact persons.
 */
const ADD_CUSTOMER = String.raw`
      $bp = $company.GetBusinessObject(2)
      try {
        if ($d.series) { $bp.Series = [int]$d.series }
        $bp.CardCode = [string]$d.cardCode
        $bp.CardName = [string]$d.cardName
        $bp.CardType = 0
        # The lead's currency (SAP's local one when it has none)
        if ($d.currency) { $bp.Currency = [string]$d.currency }
        if ($null -ne $d.groupCode) { $bp.GroupCode = [int]$d.groupCode }
        if ($null -ne $d.slpCode) { $bp.SalesPersonCode = [int]$d.slpCode }
        if ($d.email) { $bp.EmailAddress = [string]$d.email }
        if ($d.phone) { $bp.Phone1 = [string]$d.phone }
        if ($null -ne $d.creditLimit) { $bp.CreditLimit = [double]$d.creditLimit }
        if ($null -ne $d.groupNum) { $bp.PayTermsGrpCode = [int]$d.groupNum }
        if ($d.freeText) { $bp.FreeText = [string]$d.freeText }
        $first = $true
        foreach ($a in @($d.addresses)) {
          if (-not $first) { $bp.Addresses.Add() }
          $first = $false
          $bp.Addresses.AddressType = [int]$a.type
          $bp.Addresses.AddressName = [string]$a.name
          if ($a.street) { $bp.Addresses.Street = [string]$a.street }
          if ($a.streetNo) { $bp.Addresses.StreetNo = [string]$a.streetNo }
          if ($a.block) { $bp.Addresses.Block = [string]$a.block }
          if ($a.city) { $bp.Addresses.City = [string]$a.city }
          if ($a.zipCode) { $bp.Addresses.ZipCode = [string]$a.zipCode }
          if ($a.country) { $bp.Addresses.Country = [string]$a.country }
          if ($a.state) { $bp.Addresses.State = [string]$a.state }
          if ($a.deliveryZone) { $bp.Addresses.UserFields.Fields.Item('U_DeliveryZone').Value = [string]$a.deliveryZone }
        }
        if ($d.billToDefault) { $bp.BilltoDefault = [string]$d.billToDefault }
        if ($d.shipToDefault) { $bp.ShipToDefault = [string]$d.shipToDefault }
        $first = $true
        foreach ($c in @($d.contacts)) {
          if (-not $first) { $bp.ContactEmployees.Add() }
          $first = $false
          $bp.ContactEmployees.Name = [string]$c.name
          if ($c.position) { $bp.ContactEmployees.Position = [string]$c.position }
          if ($c.tel) { $bp.ContactEmployees.Phone1 = [string]$c.tel }
          if ($c.email) { $bp.ContactEmployees.E_Mail = [string]$c.email }
        }
        if ($bp.Add() -ne 0) {
          $result = @{ success = $false; message = "SAP error $($company.GetLastErrorCode()): $($company.GetLastErrorDescription())" }
        } else {
          $result = @{ success = $true; message = "Business partner $($d.cardCode) created in SAP" }
        }
      } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($bp)
      }
`;

/**
 * DI API: Update Customer - change an existing business partner (BusinessPartners = object 2) to the form as approved:
 * name, BP Group, sales employee, e-mail, phone, credit limit, payment terms, remarks; addresses matched by type and
 * Address ID (changed, or added when new), contact persons matched by name (changed, or added). Addresses and contacts
 * no longer on the form are left in SAP (SAP documents may use them). Empty texts clear the SAP field.
 */
const UPDATE_CUSTOMER = String.raw`
      $bp = $company.GetBusinessObject(2)
      try {
        if (-not $bp.GetByKey([string]$d.cardCode)) {
          $result = @{ success = $false; message = "Business partner $($d.cardCode) was not found in SAP" }
        } else {
          $bp.CardName = [string]$d.cardName
          if ($null -ne $d.groupCode) { $bp.GroupCode = [int]$d.groupCode }
          if ($null -ne $d.slpCode) { $bp.SalesPersonCode = [int]$d.slpCode }
          $bp.EmailAddress = [string]$d.email
          $bp.Phone1 = [string]$d.phone
          if ($null -ne $d.creditLimit) { $bp.CreditLimit = [double]$d.creditLimit }
          if ($null -ne $d.groupNum) { $bp.PayTermsGrpCode = [int]$d.groupNum }
          $bp.FreeText = [string]$d.freeText
          $addrs = $bp.Addresses
          foreach ($a in @($d.addresses)) {
            $found = -1
            for ($i = 0; $i -lt $addrs.Count; $i++) {
              $addrs.SetCurrentLine($i)
              if ($addrs.AddressName -eq [string]$a.name -and [int]$addrs.AddressType -eq [int]$a.type) { $found = $i; break }
            }
            if ($found -ge 0) {
              $addrs.SetCurrentLine($found)
            } else {
              # A business partner without addresses still has one empty line: use it, otherwise add one
              $addrs.SetCurrentLine($addrs.Count - 1)
              if ($addrs.AddressName) { $addrs.Add() }
              $addrs.AddressType = [int]$a.type
              $addrs.AddressName = [string]$a.name
            }
            $addrs.Street = [string]$a.street
            $addrs.StreetNo = [string]$a.streetNo
            $addrs.Block = [string]$a.block
            $addrs.City = [string]$a.city
            $addrs.ZipCode = [string]$a.zipCode
            $addrs.Country = [string]$a.country
            $addrs.State = [string]$a.state
            if ($a.deliveryZone) { $addrs.UserFields.Fields.Item('U_DeliveryZone').Value = [string]$a.deliveryZone }
          }
          if ($d.billToDefault) { $bp.BilltoDefault = [string]$d.billToDefault }
          if ($d.shipToDefault) { $bp.ShipToDefault = [string]$d.shipToDefault }
          $people = $bp.ContactEmployees
          foreach ($c in @($d.contacts)) {
            $found = -1
            for ($i = 0; $i -lt $people.Count; $i++) {
              $people.SetCurrentLine($i)
              if ($people.Name -eq [string]$c.name) { $found = $i; break }
            }
            if ($found -ge 0) {
              $people.SetCurrentLine($found)
            } else {
              $people.SetCurrentLine($people.Count - 1)
              if ($people.Name) { $people.Add() }
              $people.Name = [string]$c.name
            }
            $people.Position = [string]$c.position
            $people.Phone1 = [string]$c.tel
            $people.E_Mail = [string]$c.email
          }
          if ($bp.Update() -ne 0) {
            $result = @{ success = $false; message = "SAP error $($company.GetLastErrorCode()): $($company.GetLastErrorDescription())" }
          } else {
            $result = @{ success = $true; message = "Business partner $($d.cardCode) updated in SAP" }
          }
        }
      } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($bp)
      }
`;

/**
 * Post an OPEN Convert to Customer (FTS11OCRD) to SAP: the lead becomes a customer with the SAP BP Code keyed in, and
 * the application form as completed there. The code must still be free (see assertCardCodeFree). SAP's manual
 * customer series is used (SAP only accepts a typed code on a manual series). On SUCCESS the lead gets the customer
 * code (so its quotations can be copied to Sales Orders), the credit limit and the form as posted.
 * An Update Customer (BaseEntry set) changes that existing business partner instead (UPDATE_CUSTOMER); the lead gets
 * the form as posted the same way.
 */
export async function postConversionToSap(docEntry: number, userId: number) {
  const rows = await db.query<Record<string, unknown> & { LeadEntry: number; LeadName: string; CardCode: string | null; CreditLine: number | null; SlpCode: number | null; GroupCode: number | null; BaseEntry: number | null }>(
    `SELECT LeadEntry, LeadName, CardCode, CreditLine, SlpCode, GroupCode, BaseEntry, ${FORM_COLUMNS.join(', ')}
     FROM FTS11OCRD WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (rows.length === 0) throw new NotFoundError('Convert to Customer');
  const conv = rows[0];
  const cardCode = String(conv.CardCode ?? '').trim();
  if (!cardCode) throw new ValidationError('SAP BP Code is required');
  if (cardCode.length > CARD_CODE_MAX) throw new ValidationError(`SAP BP Code must be ${CARD_CODE_MAX} characters or fewer`);
  const isUpdate = conv.BaseEntry !== null;
  if (!isUpdate) await assertCardCodeFree(cardCode, docEntry, conv.LeadEntry);
  const contacts = await getFormContacts(CONVERSION_TABLES, docEntry);
  const addresses = await getConversionAddresses(docEntry);
  const details = { cardCode, cardName: conv.LeadName, groupCode: conv.GroupCode, slpCode: conv.SlpCode, creditLimit: conv.CreditLine, ...bpDetailsOf(conv, contacts, addresses) };
  if (isUpdate) return post<DiApiResult>('FTS11OCRD', docEntry, 'Update customer', UPDATE_CUSTOMER, details, userId, () => afterConversionPosted(docEntry, conv.LeadEntry, cardCode, true));

  // SAP's manual customer series: its default one if manual, else the first manual one that isn't locked
  const series = await db.query<{ Series: number }>(
    `SELECT TOP 1 n.Series
     FROM ${sapTable('NNM1')} n
     WHERE n.ObjectCode = '2' AND n.DocSubType = 'C' AND n.IsManual = 'Y' AND n.Locked = 'N'
     ORDER BY CASE WHEN n.Series = (SELECT o.DfltSeries FROM ${sapTable('ONNM')} o WHERE o.ObjectCode = '2' AND o.DocSubType = 'C') THEN 0 ELSE 1 END, n.Series`
  );
  if (series.length === 0) throw new ValidationError('SAP has no manual numbering series for customers, so a BP code can\'t be keyed in');

  // The customer's currency: the lead's (Update Customer never changes it)
  const lead = await db.query<{ Currency: string | null }>(`SELECT Currency FROM FTS11LEAD WHERE DocEntry = @leadEntry`, [
    { name: 'leadEntry', value: conv.LeadEntry },
  ]);
  const currency = (lead[0]?.Currency ?? '').trim() || (await getCurrencySettings()).local;

  return post<DiApiResult>(
    'FTS11OCRD',
    docEntry,
    'Convert to customer',
    ADD_CUSTOMER,
    { series: series[0].Series, currency, ...details },
    userId,
    () => afterConversionPosted(docEntry, conv.LeadEntry, cardCode, false)
  );
}

/**
 * The customer is in SAP now (added, or updated by an Update Customer): the document SUCCESS, and the lead takes the
 * customer and the form as posted
 */
async function afterConversionPosted(docEntry: number, leadEntry: number, cardCode: string, isUpdate: boolean) {
  const key = [{ name: 'docEntry', value: docEntry }];
  const transaction = await db.beginTransaction();
  try {
    await db.query(
      `UPDATE FTS11OCRD SET PostStatus = @success, ErrorDesc = NULL WHERE DocEntry = @docEntry`,
      [...key, { name: 'success', value: POST_STATUS.success }],
      transaction
    );
    await db.query(
      `UPDATE l
       SET l.CardCode = c.CardCode, l.CreditLine = c.CreditLine, l.LeadName = c.LeadName, l.SlpCode = c.SlpCode,
           l.PostStatus = @success, l.ErrorDesc = NULL,
           ${FORM_COLUMNS.map((col) => `l.${col} = c.${col}`).join(', ')}
       FROM FTS11LEAD l JOIN FTS11OCRD c ON c.LeadEntry = l.DocEntry
       WHERE c.DocEntry = @docEntry`,
      [...key, { name: 'success', value: POST_STATUS.success }],
      transaction
    );
    await db.query(`DELETE FROM FTS11LED1 WHERE DocEntry = @leadEntry`, [{ name: 'leadEntry', value: leadEntry }], transaction);
    await db.query(
      `INSERT INTO FTS11LED1 (DocEntry, LineNum, VisOrder, Role, RoleDesc, Name, Tel, Email)
       SELECT @leadEntry, LineNum, VisOrder, Role, RoleDesc, Name, Tel, Email FROM FTS11CRD1 WHERE DocEntry = @docEntry`,
      [...key, { name: 'leadEntry', value: leadEntry }],
      transaction
    );
    await db.commitTransaction(transaction);
  } catch (error) {
    await db.rollbackTransaction(transaction);
    // SAP has the customer whatever happens here: never leave it PENDING. The lead gets at least its customer code;
    // the reason the form wasn't copied back is noted.
    const reason = error instanceof Error ? error.message : String(error);
    await db.query(`UPDATE FTS11OCRD SET PostStatus = @success, ErrorDesc = @note WHERE DocEntry = @docEntry`, [
      ...key,
      { name: 'success', value: POST_STATUS.success },
      { name: 'note', value: `${isUpdate ? 'Updated' : 'Created'} in SAP, but the lead's details were not updated: ${reason}` },
    ]);
    await db.query(`UPDATE FTS11LEAD SET CardCode = @cardCode, PostStatus = @success WHERE DocEntry = @leadEntry`, [
      { name: 'cardCode', value: cardCode },
      { name: 'success', value: POST_STATUS.success },
      { name: 'leadEntry', value: leadEntry },
    ]);
  }
}

/** SAP OCPR.Name is up to 50 characters, and unique within a business partner */
const CONTACT_NAME_MAX = 50;

/**
 * The lead's application form as the SAP business partner's details:
 *   E-mail -> E-mail (the e-invoice e-mail if there is no general one); Account Dept's contact no. -> Telephone 1;
 *   Credit Term -> Payment Terms; Nature of Business / Main Products / Major Suppliers / e-invoice e-mail -> Remarks;
 *   addresses (Addresses tab) -> its Bill To / Ship To addresses by Address ID, the defaults its default ones;
 *   contacts -> contact persons, their role as Position. One person listed under several roles becomes one contact
 *   person with all the roles (SAP doesn't allow the same name twice).
 */
function bpDetailsOf(
  lead: Record<string, unknown>,
  contacts: { Role: string; RoleDesc: string | null; Name: string; Tel: string | null; Email: string | null }[],
  rows: Awaited<ReturnType<typeof getConversionAddresses>>
) {
  const text = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
  const roleName = (c: { Role: string; RoleDesc: string | null }) => (c.Role === 'OTHERS' && c.RoleDesc ? c.RoleDesc : CONTACT_ROLES[c.Role] ?? c.Role);

  const byName = new Map<string, { name: string; position: string; tel: string | null; email: string | null }>();
  for (const c of contacts) {
    const name = c.Name.trim().slice(0, CONTACT_NAME_MAX);
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      existing.position = `${existing.position}, ${roleName(c)}`.slice(0, 90);
      existing.tel ??= text(c.Tel);
      existing.email ??= text(c.Email);
    } else {
      byName.set(name.toLowerCase(), { name, position: roleName(c).slice(0, 90), tel: text(c.Tel), email: text(c.Email) });
    }
  }

  // BoAddressType: 0 = ship-to, 1 = bill-to
  const addresses = rows.map((a) => ({
    type: a.AdresType === 'B' ? 1 : 0,
    name: a.Address,
    street: text(a.Street),
    streetNo: text(a.StreetNo),
    block: text(a.Block),
    city: text(a.City),
    zipCode: text(a.ZipCode),
    state: text(a.State),
    country: text(a.Country),
    deliveryZone: text(a.DeliveryZone),
  }));
  const defaultOf = (type: 'B' | 'S') => rows.find((a) => a.AdresType === type && a.IsDefault)?.Address ?? null;

  const remarks = [
    text(lead.NatureOfBiz) && `Nature of Business: ${text(lead.NatureOfBiz)}`,
    text(lead.MainProducts) && `Main Products: ${text(lead.MainProducts)}`,
    (text(lead.Supplier1) || text(lead.Supplier2)) && `Major Suppliers: ${[text(lead.Supplier1), text(lead.Supplier2)].filter(Boolean).join(', ')}`,
    text(lead.EInvEmail) && `E-mail (E-invoice): ${text(lead.EInvEmail)}`,
  ].filter(Boolean);

  return {
    email: text(lead.Email) ?? text(lead.EInvEmail),
    phone: text(contacts.find((c) => c.Role === 'ACCOUNT' && text(c.Tel))?.Tel),
    groupNum: lead.GroupNum ?? null,
    freeText: remarks.length > 0 ? remarks.join('\r\n') : null,
    addresses,
    billToDefault: defaultOf('B'),
    shipToDefault: defaultOf('S'),
    contacts: [...byName.values()],
  };
}

// ---------------------------------------------------------------------------
// Sales Order -> SAP Sales Order, Credit Memo -> SAP A/R Credit Memo

/** The sales documents posted to SAP: SAP's object type (Documents) and its name in messages */
const SAP_DOCUMENTS: Record<string, { objectType: number; sapName: string }> = {
  [SALES_ORDER.objType]: { objectType: 17, sapName: 'Sales Order' },
  [CREDIT_MEMO.objType]: { objectType: 14, sapName: 'A/R Credit Memo' },
};

/** DI API: add a sales document (Documents: sales order 17, A/R credit memo 14), then read back its number */
const ADD_SALES_DOCUMENT = String.raw`
      $o = $company.GetBusinessObject([int]$d.objectType)
      try {
        $h = $d.header
        $o.CardCode = [string]$h.cardCode
        $o.DocDate = [datetime]::ParseExact($h.docDate, 'yyyy-MM-dd', $null)
        if ($h.docDueDate) { $o.DocDueDate = [datetime]::ParseExact($h.docDueDate, 'yyyy-MM-dd', $null) }
        if ($h.taxDate) { $o.TaxDate = [datetime]::ParseExact($h.taxDate, 'yyyy-MM-dd', $null) }
        if ($h.numAtCard) { $o.NumAtCard = [string]$h.numAtCard }
        if ($null -ne $h.groupNum) { $o.PaymentGroupCode = [int]$h.groupNum }
        if ($null -ne $h.cntctCode) { $o.ContactPersonCode = [int]$h.cntctCode }
        if ($null -ne $h.slpCode) { $o.SalesPersonCode = [int]$h.slpCode }
        if ($h.comments) { $o.Comments = [string]$h.comments }
        # Bill To / Ship To: the address names first, then the address as on the document (SAP separates text lines with
        # a carriage return). Empty: the customer's defaults.
        if ($h.payToCode) { $o.PayToCode = [string]$h.payToCode }
        if ($h.shipToCode) { $o.ShipToCode = [string]$h.shipToCode }
        # SAP keeps either the text or the address parts, never both (the text empties the parts; the parts make SAP build
        # the text with the country's address format). The parts are sent whenever there are any (user's choice,
        # 2026-11-15); the text only for a side without them.
        if ($h.address -and $null -eq $h.billToParts) { $o.Address = ([string]$h.address -replace "\r?\n", [string][char]13) }
        if ($h.address2 -and $null -eq $h.shipToParts) { $o.Address2 = ([string]$h.address2 -replace "\r?\n", [string][char]13) }
        # The address parts: Bill To / Ship To components on the document's address tab (Address Line 1 .. 4 = Street /
        # StreetNo / Block / City, the rest from the SAP address), Delivery Zone in U_DeliveryZoneB / S
        foreach ($side in @(@{ prefix = 'BillTo'; parts = $h.billToParts; zone = 'U_DeliveryZoneB' }, @{ prefix = 'ShipTo'; parts = $h.shipToParts; zone = 'U_DeliveryZoneS' })) {
          $a = $side.parts
          if ($null -eq $a) { continue }
          $x = $o.AddressExtension
          $pre = $side.prefix
          foreach ($f in @(@('Street', 'street'), @('StreetNo', 'streetNo'), @('Block', 'block'), @('Building', 'building'), @('City', 'city'),
                           @('ZipCode', 'zipCode'), @('County', 'county'), @('Country', 'country'), @('State', 'state'),
                           @('AddressType', 'addrType'), @('Address2', 'address2'), @('Address3', 'address3'), @('GlobalLocationNumber', 'glblLocNum'))) {
            if ($a.($f[1])) { $x.($pre + $f[0]) = [string]$a.($f[1]) }
          }
          Set-Udf $x.UserFields.Fields $side.zone $a.deliveryZone
        }
        if ($h.discPrcnt) { $o.DiscountPercent = [double]$h.discPrcnt }
        # The document's currency, always (an "all currencies" customer could otherwise get another one); a foreign
        # one also gets SAP's rate it was made with, and the prices are in it
        if ($h.docCur) { $o.DocCurrency = [string]$h.docCur }
        if ($h.docRate) { $o.DocRate = [double]$h.docRate }
        Set-Udf $o.UserFields.Fields 'U_PDocEntry' $d.portalDocEntry
        Set-Udf $o.UserFields.Fields 'U_PDocNum' $h.docNum
        Set-Udf $o.UserFields.Fields 'U_COA' $h.coa
        Set-Udf $o.UserFields.Fields 'U_InComments' $h.inComments
        Set-Udf $o.UserFields.Fields 'U_TAC' $h.tac
        # Discount Type 1 .. 5 (Codes of SAP's @DISCOUNTTYPE) in the UDFs U_DiscType1 .. 5; each skipped when empty or the company has no such field
        foreach ($i in 1..5) { Set-Udf $o.UserFields.Fields "U_DiscType$i" $h."discType$i" }
        # Bank Info (a Code of SAP's @SELLERBANK) in the UDF U_BankInfo; skipped when empty or the company has no such field
        Set-Udf $o.UserFields.Fields 'U_BankInfo' $h.bankInfo
        $first = $true
        foreach ($ln in $d.lines) {
          if (-not $first) { $o.Lines.Add() }
          $first = $false
          $o.Lines.ItemCode = [string]$ln.itemCode
          Set-Udf $o.Lines.UserFields.Fields 'U_PDocEntry' $d.portalDocEntry
          Set-Udf $o.Lines.UserFields.Fields 'U_PLineNum' $ln.lineNum
          if ($ln.dscription) { $o.Lines.ItemDescription = [string]$ln.dscription }
          $o.Lines.Quantity = [double]$ln.quantity
          if ($h.docRate) { $o.Lines.Currency = [string]$h.docCur }
          $o.Lines.UnitPrice = [double]$ln.priceBefDi
          if ($ln.discPrcnt) { $o.Lines.DiscountPercent = [double]$ln.discPrcnt }
          if ($ln.vatGroup) { $o.Lines.VatGroup = [string]$ln.vatGroup }
          if ($ln.whsCode) { $o.Lines.WarehouseCode = [string]$ln.whsCode }
          # Branch: the header's, as every line's Dimension 1 cost centre
          if ($h.branch) { $o.Lines.CostingCode = [string]$h.branch }
          if ($null -ne $ln.uomEntry) { $o.Lines.UoMEntry = [int]$ln.uomEntry }
          elseif ($ln.measureUnit) { $o.Lines.MeasureUnit = [string]$ln.measureUnit }
          if ($ln.text) { $o.Lines.ItemDetails = [string]$ln.text }
          Set-Udf $o.Lines.UserFields.Fields 'U_SalesQty' $ln.salesQty
          Set-Udf $o.Lines.UserFields.Fields 'U_SalesUoM' $ln.salesUom
          Set-Udf $o.Lines.UserFields.Fields 'U_SalesPrice' $ln.salesPrice
        }
        if ($o.Add() -ne 0) {
          $result = @{ success = $false; message = "SAP error $($company.GetLastErrorCode()): $($company.GetLastErrorDescription())" }
        } else {
          $key = [int]$company.GetNewObjectKey()
          [void]$o.GetByKey($key)
          $result = @{ success = $true; message = "Posted to SAP: $($d.sapName) $($o.DocNum)"; docEntry = $key; docNum = [int]$o.DocNum }
        }
      } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o)
      }
`;

/**
 * A sales document's Bill To ('B') or Ship To ('S') parts for SAP's address tab. Address Line 1 .. 4 (Street / StreetNo /
 * Block / City) and the Delivery Zone are the document's own (094); zip code, state, country and the rest come from the
 * chosen SAP address. A document saved before 094 (none of its own) takes all of them from the SAP address.
 * null = nothing to send (no address on the document): SAP fills in the customer's default as usual.
 */
async function documentAddressParts(h: Record<string, unknown>, type: 'B' | 'S') {
  const pre = type === 'B' ? 'Bill' : 'Ship';
  const code = ((type === 'B' ? h.PayToCode : h.ShipToCode) as string | null) || null;
  const text = (type === 'B' ? h.Address : h.Address2) as string | null;
  const own = {
    street: h[`${pre}Street`] as string | null,
    streetNo: h[`${pre}StreetNo`] as string | null,
    block: h[`${pre}Block`] as string | null,
    city: h[`${pre}City`] as string | null,
    deliveryZone: h[`${pre}DeliveryZone`] as string | null,
  };
  const hasOwn = Object.values(own).some((v) => v);
  if (!code && !text && !hasOwn) return null;
  const sap = await getAddressParts(h.CardCode as string, type, code);
  if (!hasOwn) return sap;
  return { ...(sap ?? {}), ...own };
}

/** Post an OPEN sales order to SAP as a sales order; SAP's DocNum / DocEntry are kept in SAPDocNum / SAPDocEntry */
export function postSalesOrderToSap(docEntry: number, userId: number) {
  return postSalesDocumentToSap(SALES_ORDER, docEntry, userId);
}

/** Post an OPEN credit memo to SAP as an A/R credit memo (the items come back into the lines' warehouses) */
export function postCreditMemoToSap(docEntry: number, userId: number) {
  return postSalesDocumentToSap(CREDIT_MEMO, docEntry, userId);
}

/** Post an OPEN sales document as the same SAP document (SAP_DOCUMENTS); SAP's DocNum / DocEntry kept in SAPDocNum / SAPDocEntry */
async function postSalesDocumentToSap(doc: SalesDocType, docEntry: number, userId: number) {
  const sap = SAP_DOCUMENTS[doc.objType];
  const table = doc.header;
  const headers = await db.query<Record<string, unknown>>(
    `SELECT CardCode, CONVERT(char(10), DocDate, 23) AS DocDate, CONVERT(char(10), DocDueDate, 23) AS DocDueDate,
            CONVERT(char(10), TaxDate, 23) AS TaxDate, NumAtCard, GroupNum, COA, Branch, CntctCode, SlpCode, Comments, InComments, TAC, DiscPrcnt, DocNum,
            DocCur, DocRate, DiscType1, DiscType2, DiscType3, DiscType4, DiscType5, BankInfo, PayToCode, ShipToCode, Address, Address2,
            BillStreet, BillStreetNo, BillBlock, BillCity, BillDeliveryZone, ShipStreet, ShipStreetNo, ShipBlock, ShipCity, ShipDeliveryZone
     FROM ${table}
     WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (headers.length === 0) throw new NotFoundError(doc.label);
  const h = headers[0];
  // The line's UoM (see sapUom): a unit of the item's UoM group, or a manual-UoM text; empty = SAP's default sales unit
  const lines = await db.query<Record<string, unknown>>(
    `SELECT l.LineNum, l.ItemCode, l.Dscription, l.Quantity, l.PriceBefDi, l.DiscPrcnt, l.VatGroup, l.WhsCode, l.Text,
            l.SalesQty, l.SalesUoM, l.SalesPrice, ${uomColumns('l', 'i')}
     FROM ${doc.lines} l
     ${uomItemJoin('l', 'i')}
     WHERE l.DocEntry = @docEntry
     ORDER BY l.VisOrder, l.LineNum`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (lines.length === 0) throw new ValidationError(`The ${doc.label.toLowerCase()} has no lines to post`);
  assertUomsValid(lines);
  // The currency is always sent; the rate (and the lines' currency) only for a foreign one
  const local = (await getCurrencySettings()).local;
  const docCur = (h.DocCur as string | null) || local;
  const foreign = docCur !== local;

  const data = {
    objectType: sap.objectType,
    sapName: sap.sapName,
    // The portal document in SAP's U_PDocEntry / U_PDocNum (header) and U_PDocEntry / U_PLineNum (lines)
    portalDocEntry: docEntry,
    header: {
      docNum: h.DocNum,
      cardCode: h.CardCode,
      docDate: h.DocDate,
      docDueDate: h.DocDueDate,
      taxDate: h.TaxDate,
      numAtCard: h.NumAtCard,
      // Payment Terms; empty = the customer's own (SAP fills it from the business partner)
      groupNum: h.GroupNum,
      // COA (Y / N) in SAP's UDF U_COA; empty = left as SAP has it; skipped when the company has no such field
      coa: h.COA,
      // Branch (SAP Dimension 1 cost centre); empty = no cost centre set
      branch: h.Branch,
      cntctCode: h.CntctCode,
      slpCode: h.SlpCode,
      comments: h.Comments,
      // Internal Remarks / T&C in SAP's UDFs U_InComments / U_TAC; skipped when empty or the company has no such field
      inComments: h.InComments,
      tac: h.TAC,
      discPrcnt: h.DiscPrcnt,
      docCur,
      docRate: foreign ? Number(h.DocRate) : null,
      // Discount Type 1 .. 5 in SAP's UDFs U_DiscType1 .. U_DiscType5
      discType1: h.DiscType1,
      discType2: h.DiscType2,
      discType3: h.DiscType3,
      discType4: h.DiscType4,
      discType5: h.DiscType5,
      // Bank Info in SAP's UDF U_BankInfo
      bankInfo: h.BankInfo,
      // Bill To / Ship To address names and their (possibly edited) text; empty = the customer's defaults in SAP
      payToCode: h.PayToCode,
      shipToCode: h.ShipToCode,
      address: h.Address,
      address2: h.Address2,
      // The address parts sent with the text: Address Line 1 .. 4 and Delivery Zone as on the document, the rest from
      // the chosen SAP address (the customer's default one when none is chosen)
      billToParts: await documentAddressParts(h, 'B'),
      shipToParts: await documentAddressParts(h, 'S'),
    },
    lines: lines.map((l) => ({
      lineNum: l.LineNum,
      itemCode: l.ItemCode,
      dscription: l.Dscription,
      quantity: l.Quantity,
      priceBefDi: l.PriceBefDi,
      discPrcnt: l.DiscPrcnt,
      vatGroup: l.VatGroup,
      whsCode: l.WhsCode,
      text: l.Text,
      // Export Qty / Export UoM / Export Unit Price in SAP's line UDFs U_SalesQty / U_SalesUoM / U_SalesPrice; skipped when
      // empty or the company has no such field
      salesQty: l.SalesQty,
      salesUom: l.SalesUoM,
      salesPrice: l.SalesPrice,
      ...uomForDi(l),
    })),
  };

  return post<DiApiResult & { docEntry: number; docNum: number }>(table, docEntry, doc.label, ADD_SALES_DOCUMENT, data, userId, async (r) => {
    await db.query(
      `UPDATE ${table} SET PostStatus = @success, ErrorDesc = NULL, SAPDocNum = @sapDocNum, SAPDocEntry = @sapDocEntry WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'success', value: POST_STATUS.success },
        { name: 'sapDocNum', value: r.docNum },
        { name: 'sapDocEntry', value: r.docEntry },
      ]
    );
  });
}

/**
 * DI API: Close Doc / Cancel Doc / Close Line on a posted sales document (sales order 17, A/R credit memo 14). Already
 * closed / canceled in SAP counts as done. An A/R credit memo is canceled as SAP does it: a cancellation document is
 * added. Lines are SAP's line numbers (the portal lines in their order on screen, VisOrder, as they were posted).
 */
const UPDATE_SALES_DOCUMENT_STATUS = String.raw`
      $o = $company.GetBusinessObject([int]$d.objectType)
      try {
        if (-not $o.GetByKey([int]$d.sapDocEntry)) {
          $result = @{ success = $false; message = "$($d.sapName) $($d.sapDocEntry) was not found in SAP" }
        } else {
          $rc = 0
          if ($d.action -eq 'cancel') {
            if ([int]$o.Cancelled -ne 1) {
              if ([int]$d.objectType -eq 14) {
                $c = $o.CreateCancellationDocument()
                try { $rc = $c.Add() } finally { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($c) }
              } else {
                $rc = $o.Cancel()
              }
            }
          } elseif ($d.action -eq 'close') {
            if ([int]$o.DocumentStatus -ne 1) { $rc = $o.Close() }
          } else {
            $changed = $false
            foreach ($i in @($d.lines)) {
              $o.Lines.SetCurrentLine([int]$i)
              if ([int]$o.Lines.LineStatus -ne 1) { $o.Lines.LineStatus = 1; $changed = $true }
            }
            if ($changed) { $rc = $o.Update() }
          }
          if ($rc -ne 0) {
            $result = @{ success = $false; message = "SAP error $($company.GetLastErrorCode()): $($company.GetLastErrorDescription())" }
          } else {
            $result = @{ success = $true; message = 'Updated in SAP' }
          }
        }
      } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o)
      }
`;

/**
 * Close Doc / Cancel Doc / Close Line of a sales order or credit memo, done in SAP too when it has been posted. Called
 * inside the portal's transaction after the portal's own checks and updates: SAP refusing (or not answering) throws,
 * so the portal change is rolled back and nothing differs between the two. Not posted (or FAILED), or a document type
 * never posted (Sales Quotation): nothing to do in SAP.
 */
export async function updateSalesDocumentStatusInSap(
  salesDoc: SalesDocType,
  docEntry: number,
  action: 'close' | 'cancel' | 'closeLines',
  lineNums: number[],
  transaction: sql.Transaction
): Promise<void> {
  const sap = SAP_DOCUMENTS[salesDoc.objType];
  if (!sap) return;
  const rows = await db.query<{ PostStatus: string | null; SAPDocEntry: number | null }>(
    `SELECT PostStatus, SAPDocEntry FROM ${salesDoc.header} WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  const doc = rows[0];
  if (!doc) throw new NotFoundError(salesDoc.label);
  if (doc.PostStatus === POST_STATUS.pending) {
    throw new ValidationError(`This ${salesDoc.label.toLowerCase()} is being posted to SAP; try again when posting has finished`);
  }
  if (doc.PostStatus !== POST_STATUS.success || doc.SAPDocEntry === null) return;

  // SAP's line numbers: the position of each portal line (all lines were posted, in VisOrder order; a posted order can no longer be edited)
  let sapLines: number[] = [];
  if (action === 'closeLines') {
    const all = await db.query<{ LineNum: number }>(
      `SELECT LineNum FROM ${salesDoc.lines} WHERE DocEntry = @docEntry ORDER BY VisOrder, LineNum`,
      [{ name: 'docEntry', value: docEntry }],
      transaction
    );
    sapLines = lineNums.map((n) => all.findIndex((l) => l.LineNum === n)).filter((i) => i >= 0);
  }

  const logon = await getSavedDiApiLogon();
  let result: DiApiResult;
  try {
    result = await runDiApi<DiApiResult>(logon, UPDATE_SALES_DOCUMENT_STATUS, { ...sap, sapDocEntry: doc.SAPDocEntry, action, lines: sapLines });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`SAP did not answer: ${message}. Nothing was changed in the portal; check the document in SAP before trying again.`);
  }
  if (!result.success) throw new ValidationError(`${result.message}. Nothing was changed in the portal.`);
}

// ---------------------------------------------------------------------------
// Temporary Receipt -> SAP Incoming Payment

/**
 * DI API: add an incoming payment (Payments, object 24). Invoices: A/R invoices (13), credit memos (14) and down payment
 * invoices (203, it_DownPayment) by their DocEntry, other open items as journal entry lines (30: TransId + Line_ID). Payment means: cash and cheques to the
 * accounts in General Settings > Incoming Payment, the bank transfer to the chosen bank's G/L account, a credit card
 * with the card in General Settings; one bank charge (SAP's Bank Charges account). What isn't applied stays on account.
 * Amounts applied are signed as the balance due (a credit memo minus) and get no cash discount, so SAP takes exactly
 * what the receipt applies (both tested 2026-10-22 against SBODemoGB, payment terms 2P10Net30).
 */
const ADD_INCOMING_PAYMENT = String.raw`
      $p = $company.GetBusinessObject(24)
      try {
        $h = $d.header
        $p.CardCode = [string]$h.cardCode
        $p.DocDate = [datetime]::ParseExact($h.docDate, 'yyyy-MM-dd', $null)
        $p.TaxDate = [datetime]::ParseExact($(if ($h.taxDate) { $h.taxDate } else { $h.docDate }), 'yyyy-MM-dd', $null)
        if ($h.remarks) { $p.Remarks = [string]$h.remarks }
        if ($h.journalRemarks) { $p.JournalRemarks = [string]$h.journalRemarks }
        # The payment's currency, always (else SAP takes the customer's: a local-currency receipt of a USD customer
        # would be read as USD). A foreign one also gets SAP's rate it was made with; the payment means and the
        # amounts applied are in it (SAP books the exchange difference)
        if ($h.docCur) { $p.DocCurrency = [string]$h.docCur }
        if ($h.docRate) { $p.DocRate = [double]$h.docRate }
        Set-Udf $p.UserFields.Fields 'U_PDocEntry' $d.portalDocEntry
        Set-Udf $p.UserFields.Fields 'U_PDocNum' $h.docNum
        $first = $true
        foreach ($l in @($d.invoices)) {
          if (-not $first) { $p.Invoices.Add() }
          $first = $false
          $p.Invoices.InvoiceType = [int]$l.invoiceType
          Set-Udf $p.Invoices.UserFields.Fields 'U_PDocEntry' $d.portalDocEntry
          Set-Udf $p.Invoices.UserFields.Fields 'U_PLineNum' $l.lineNum
          $p.Invoices.DocEntry = [int]$l.docEntry
          if ($null -ne $l.docLine) { $p.Invoices.DocLine = [int]$l.docLine }
          # An invoice split into installments: the installment this journal line is (else SAP takes the first, which
          # may already be paid: "Invoice is already closed or blocked")
          if ($l.installmentId) { $p.Invoices.InstallmentId = [int]$l.installmentId }
          # No cash discount: SAP would take the payment terms' one off by itself, and the amount applied (what was
          # collected) would then be "greater than invoice amount"
          if ([int]$l.invoiceType -ne 30) { $p.Invoices.DiscountPercent = 0 }
          if ($h.docRate) { $p.Invoices.AppliedFC = [double]$l.sumApplied } else { $p.Invoices.SumApplied = [double]$l.sumApplied }
        }
        if ($d.cashSum -gt 0) {
          $p.CashAccount = [string]$d.cashAccount
          $p.CashSum = [double]$d.cashSum
        }
        if (@($d.cheques).Count -gt 0) {
          $p.CheckAccount = [string]$d.checkAccount
          $first = $true
          foreach ($c in @($d.cheques)) {
            if (-not $first) { $p.Checks.Add() }
            $first = $false
            $p.Checks.CheckNumber = [int]$c.checkNum
            $p.Checks.CheckSum = [double]$c.checkSum
            $p.Checks.DueDate = [datetime]::ParseExact($h.docDate, 'yyyy-MM-dd', $null)
            if ($c.countryCode) { $p.Checks.CountryCode = [string]$c.countryCode }
          }
        }
        if ($d.trsfrSum -gt 0) {
          $p.TransferAccount = [string]$d.trsfrAccount
          $p.TransferSum = [double]$d.trsfrSum
          $p.TransferDate = [datetime]::ParseExact($h.docDate, 'yyyy-MM-dd', $null)
          if ($h.reference) { $p.TransferReference = [string]$h.reference }
        }
        if ($d.creditSum -gt 0) {
          $p.CreditCards.CreditCard = [int]$d.creditCard
          $p.CreditCards.CreditCardNumber = '0000'
          $p.CreditCards.CardValidUntil = [datetime]::ParseExact($d.cardValidUntil, 'yyyy-MM-dd', $null)
          $p.CreditCards.VoucherNum = [string]$h.reference
          if ($null -ne $d.paymentMethod) { $p.CreditCards.PaymentMethodCode = [int]$d.paymentMethod }
          $p.CreditCards.CreditSum = [double]$d.creditSum
          $p.CreditCards.NumOfPayments = 1
          $p.CreditCards.FirstPaymentSum = [double]$d.creditSum
        }
        if ($d.bcgSum -gt 0) { $p.BankChargeAmount = [double]$d.bcgSum }
        if ($p.Add() -ne 0) {
          $result = @{ success = $false; message = "SAP error $($company.GetLastErrorCode()): $($company.GetLastErrorDescription())" }
        } else {
          $key = [int]$company.GetNewObjectKey()
          [void]$p.GetByKey($key)
          $result = @{ success = $true; message = "Posted to SAP: Incoming Payment $($p.DocNum)"; docEntry = $key; docNum = [int]$p.DocNum }
        }
      } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($p)
      }
`;

/** yyyy-mm-dd of a date (local time) */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Post an OPEN Temporary Receipt to SAP as an Incoming Payment, with its Posting Date and Document Date (empty = the
 * Posting Date); cheques and the bank transfer are dated on the Posting Date. Its Details lines are the documents it
 * pays; its payment means the money; anything not applied is a payment on account. Cash / cheques / credit card need
 * General Settings > Incoming Payment; cheque Nos. must be numbers (SAP keeps them as numbers).
 */
export async function postReceiptToSap(docEntry: number, userId: number) {
  const table = 'FTS11TMPR';
  const rows = await db.query<Record<string, unknown>>(
    `SELECT t.DocNum, CONVERT(char(10), t.DocDate, 23) AS DocDate, CONVERT(char(10), t.TaxDate, 23) AS TaxDate,
            t.CardCode, t.Comments, t.CashSum, t.CheckSum, t.TrsfrSum, t.TrsfrBank, t.CreditSum, t.BcgSum, t.DocCur, t.DocRate,
            (SELECT b.GLAccount FROM ${sapTable('DSC1')} b WHERE b.AbsEntry = t.TrsfrBank) AS TrsfrAccount
     FROM FTS11TMPR t WHERE t.DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (rows.length === 0) throw new NotFoundError('Temporary receipt');
  const r = rows[0];
  const lines = await db.query<{ LineNum: number; TransType: string; OriDocEntry: number | null; TransId: number; LineId: number; SumApplied: number; InstallmentId: number | null }>(
    // Installment: SAP's journal line of an invoice names its installment (JDT1.SourceLine)
    `SELECT l.LineNum, l.TransType, l.OriDocEntry, l.TransId, l.Line_ID AS LineId, l.SumApplied,
            (SELECT j.SourceLine FROM ${sapTable('JDT1')} j WHERE j.TransId = l.TransId AND j.Line_ID = l.Line_ID) AS InstallmentId
     FROM FTS11TMP1 l WHERE l.DocEntry = @docEntry ORDER BY l.VisOrder, l.LineNum`,
    [{ name: 'docEntry', value: docEntry }]
  );
  const cheques = await db.query<{ CheckNum: string; CheckSum: number }>(
    `SELECT CheckNum, CheckSum FROM FTS11TMP2 WHERE DocEntry = @docEntry ORDER BY LineNum`,
    [{ name: 'docEntry', value: docEntry }]
  );

  // What SAP needs that the receipt doesn't hold: the accounts / card from General Settings
  const settings = await getIncomingPaymentSettings();
  const missing = [
    Number(r.CashSum) > 0 && !settings.cashAcct && 'Cash Account',
    cheques.length > 0 && !settings.checkAcct && 'Cheque Account',
    Number(r.CreditSum) > 0 && settings.creditCard === null && 'Credit Card',
  ].filter(Boolean);
  if (missing.length > 0) throw new ValidationError(`Fill in ${missing.join(', ')} in General Settings > Incoming Payment before posting`);
  if (Number(r.TrsfrSum) > 0 && !r.TrsfrAccount) throw new ValidationError("The bank transfer's bank has no G/L account in SAP (House Bank Accounts)");
  const badCheque = cheques.find((c) => !/^\d{1,9}$/.test(c.CheckNum.trim()));
  if (badCheque) throw new ValidationError(`Cheque No. ${badCheque.CheckNum} must be a number for SAP (digits only)`);

  // The credit card's payment method (SAP OCRP: this card's, or the one for all cards)
  let paymentMethod: number | null = null;
  if (Number(r.CreditSum) > 0) {
    const pm = await db.query<{ CrTypeCode: number }>(
      `SELECT TOP 1 CrTypeCode FROM ${sapTable('OCRP')} WHERE CreditCard IN (@card, 0) ORDER BY CreditCard DESC, CrTypeCode`,
      [{ name: 'card', value: settings.creditCard }]
    );
    paymentMethod = pm[0]?.CrTypeCode ?? null;
  }
  const today = new Date();
  const docNum = String(r.DocNum ?? '');
  // The currency is always sent (a local-currency receipt of a foreign-currency customer must say so); the rate only
  // for a foreign one
  const localCur = (await getCurrencySettings()).local;
  const docCur = (r.DocCur as string | null) || localCur;
  const foreign = docCur !== localCur;
  const data = {
    // The receipt in SAP's U_PDocEntry / U_PDocNum (header) and U_PDocEntry / U_PLineNum (documents paid)
    portalDocEntry: docEntry,
    header: {
      docNum,
      cardCode: r.CardCode,
      docDate: r.DocDate,
      taxDate: r.TaxDate,
      remarks: r.Comments ? String(r.Comments).slice(0, 254) : null,
      journalRemarks: `Temporary Receipt ${docNum}`.slice(0, 50),
      reference: docNum.slice(0, 20),
      docCur,
      docRate: foreign ? Number(r.DocRate) : null,
    },
    // Amounts applied keep the sign of the item's balance due, as in SAP B1's Incoming Payment window: an invoice is
    // plus, a credit memo (or a journal entry line in the customer's favour) minus. A plus amount on a credit memo is
    // refused by SAP ("Payment amount is greater than invoice amount").
    invoices: lines.map((l) =>
      // A/R invoices (13), credit memos (14) and down payment invoices (203) by their own DocEntry; the rest as journal lines
      l.TransType === '13' || l.TransType === '14' || l.TransType === '203'
        ? {
            lineNum: l.LineNum,
            invoiceType: Number(l.TransType),
            docEntry: l.OriDocEntry,
            docLine: null,
            installmentId: Number(l.InstallmentId) > 0 ? Number(l.InstallmentId) : null,
            sumApplied: Number(l.SumApplied),
          }
        : { lineNum: l.LineNum, invoiceType: 30, docEntry: l.TransId, docLine: l.LineId, sumApplied: Number(l.SumApplied) }
    ),
    cashSum: Number(r.CashSum),
    cashAccount: settings.cashAcct,
    cheques: cheques.map((c) => ({ checkNum: c.CheckNum.trim(), checkSum: Number(c.CheckSum) })),
    checkAccount: settings.checkAcct,
    trsfrSum: Number(r.TrsfrSum),
    trsfrAccount: r.TrsfrAccount,
    creditSum: Number(r.CreditSum),
    creditCard: settings.creditCard,
    paymentMethod,
    cardValidUntil: ymd(new Date(today.getFullYear() + 1, 11, 31)),
    bcgSum: Number(r.BcgSum),
  };

  return post<DiApiResult & { docEntry: number; docNum: number }>(table, docEntry, 'Temporary receipt', ADD_INCOMING_PAYMENT, data, userId, async (res) => {
    await db.query(
      `UPDATE ${table} SET PostStatus = @success, ErrorDesc = NULL, SAPDocNum = @sapDocNum, SAPDocEntry = @sapDocEntry WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'success', value: POST_STATUS.success },
        { name: 'sapDocNum', value: res.docNum },
        { name: 'sapDocEntry', value: res.docEntry },
      ]
    );
  });
}

/** DI API: cancel an incoming payment (SAP adds the reversing journal entry). Already cancelled in SAP counts as done. */
const CANCEL_INCOMING_PAYMENT = String.raw`
      $p = $company.GetBusinessObject(24)
      try {
        if (-not $p.GetByKey([int]$d.sapDocEntry)) {
          $result = @{ success = $false; message = "Incoming payment $($d.sapDocEntry) was not found in SAP" }
        } elseif ([int]$p.Cancelled -eq 1) {
          $result = @{ success = $true; message = 'Already cancelled in SAP' }
        } elseif ($p.Cancel() -ne 0) {
          $result = @{ success = $false; message = "SAP error $($company.GetLastErrorCode()): $($company.GetLastErrorDescription())" }
        } else {
          $result = @{ success = $true; message = 'Cancelled in SAP' }
        }
      } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($p)
      }
`;

/**
 * Cancel Doc of a temporary receipt posted to SAP: its incoming payment is cancelled there too. Called inside the
 * portal's cancel transaction after the portal's own checks and update: SAP refusing (e.g. a deposited cheque) or not
 * answering throws, so the portal is rolled back. Not posted (or FAILED): nothing to do in SAP.
 */
export async function cancelReceiptInSap(docEntry: number, transaction: sql.Transaction): Promise<void> {
  const rows = await db.query<{ PostStatus: string | null; SAPDocEntry: number | null }>(
    `SELECT PostStatus, SAPDocEntry FROM FTS11TMPR WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }],
    transaction
  );
  const doc = rows[0];
  if (!doc) throw new NotFoundError('Temporary receipt');
  if (doc.PostStatus !== POST_STATUS.success || doc.SAPDocEntry === null) return;

  const logon = await getSavedDiApiLogon();
  let result: DiApiResult;
  try {
    result = await runDiApi<DiApiResult>(logon, CANCEL_INCOMING_PAYMENT, { sapDocEntry: doc.SAPDocEntry });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`SAP did not answer: ${message}. Nothing was changed in the portal; check the incoming payment in SAP before trying again.`);
  }
  if (!result.success) throw new ValidationError(`${result.message}. Nothing was changed in the portal.`);
}

// ---------------------------------------------------------------------------
// Inventory Transfer -> SAP Inventory Transfer Request

/** DI API: add an inventory transfer request (StockTransfer, object 1250000001), then read back its number */
const ADD_TRANSFER_REQUEST = String.raw`
      $o = $company.GetBusinessObject(1250000001)
      try {
        $h = $d.header
        if ($h.cardCode) { $o.CardCode = [string]$h.cardCode }
        $o.DocDate = [datetime]::ParseExact($h.docDate, 'yyyy-MM-dd', $null)
        if ($h.taxDate) { $o.TaxDate = [datetime]::ParseExact($h.taxDate, 'yyyy-MM-dd', $null) }
        $o.FromWarehouse = [string]$h.fromWarehouse
        $o.ToWarehouse = [string]$h.toWarehouse
        if ($null -ne $h.slpCode) { $o.SalesPersonCode = [int]$h.slpCode }
        if ($h.comments) { $o.Comments = [string]$h.comments }
        if ($h.journalMemo) { $o.JournalMemo = [string]$h.journalMemo }
        Set-Udf $o.UserFields.Fields 'U_PDocEntry' $d.portalDocEntry
        Set-Udf $o.UserFields.Fields 'U_PDocNum' $h.docNum
        $first = $true
        foreach ($ln in @($d.lines)) {
          if (-not $first) { $o.Lines.Add() }
          $first = $false
          $o.Lines.ItemCode = [string]$ln.itemCode
          Set-Udf $o.Lines.UserFields.Fields 'U_PDocEntry' $d.portalDocEntry
          Set-Udf $o.Lines.UserFields.Fields 'U_PLineNum' $ln.lineNum
          $o.Lines.Quantity = [double]$ln.quantity
          $o.Lines.FromWarehouseCode = [string]$ln.fromWhsCod
          $o.Lines.WarehouseCode = [string]$ln.whsCode
        }
        if ($o.Add() -ne 0) {
          $result = @{ success = $false; message = "SAP error $($company.GetLastErrorCode()): $($company.GetLastErrorDescription())" }
        } else {
          $key = [int]$company.GetNewObjectKey()
          [void]$o.GetByKey($key)
          $result = @{ success = $true; message = "Posted to SAP: Inventory Transfer Request $($o.DocNum)"; docEntry = $key; docNum = [int]$o.DocNum }
        }
      } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o)
      }
`;

/**
 * Post an OPEN Inventory Transfer to SAP as an Inventory Transfer Request (stock moves when SAP copies it to an
 * inventory transfer), with its own dates. Each line keeps its From / To
 * warehouse; the header's From / To are the header's (or else the first line's).
 */
export async function postTransferToSap(docEntry: number, userId: number) {
  const table = 'FTS11OWTR';
  const rows = await db.query<Record<string, unknown>>(
    `SELECT CardCode, CONVERT(char(10), DocDate, 23) AS DocDate, CONVERT(char(10), TaxDate, 23) AS TaxDate, Filler, ToWhsCode,
            SlpCode, Comments, DocNum
     FROM FTS11OWTR WHERE DocEntry = @docEntry`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (rows.length === 0) throw new NotFoundError('Inventory transfer');
  const h = rows[0];
  // The line's UoM (see sapUom). SAP 10 refuses a unit on transfer lines through DI API ("Field cannot be updated"
  // on WTR1.UomEntry / unitMsr), so the quantity is sent in the item's inventory unit instead: 1 Carton -> 24 Pack.
  const lines = await db.query<{ LineNum: number; ItemCode: string; Quantity: number; FromWhsCod: string; WhsCode: string; InvQty: number } & Record<string, unknown>>(
    `SELECT l.LineNum, l.ItemCode, l.Quantity, l.FromWhsCod, l.WhsCode, ${uomColumns('l', 'i')}, l.Quantity * ${uomFactor('l', 'i')} AS InvQty
     FROM FTS11WTR1 l
     ${uomItemJoin('l', 'i')}
     WHERE l.DocEntry = @docEntry
     ORDER BY l.VisOrder, l.LineNum`,
    [{ name: 'docEntry', value: docEntry }]
  );
  if (lines.length === 0) throw new ValidationError('The inventory transfer has no lines to post');
  assertUomsValid(lines);

  const data = {
    // The transfer in SAP's U_PDocEntry / U_PDocNum (header) and U_PDocEntry / U_PLineNum (lines)
    portalDocEntry: docEntry,
    header: {
      docNum: h.DocNum,
      cardCode: h.CardCode || null,
      docDate: h.DocDate,
      taxDate: h.TaxDate,
      fromWarehouse: h.Filler || lines[0].FromWhsCod,
      toWarehouse: h.ToWhsCode || lines[0].WhsCode,
      slpCode: h.SlpCode,
      comments: h.Comments,
      journalMemo: `Inventory Transfer ${h.DocNum ?? ''}`.slice(0, 50),
    },
    lines: lines.map((l) => ({ lineNum: l.LineNum, itemCode: l.ItemCode, quantity: Number(l.InvQty), fromWhsCod: l.FromWhsCod, whsCode: l.WhsCode })),
  };

  return post<DiApiResult & { docEntry: number; docNum: number }>(table, docEntry, 'Inventory transfer', ADD_TRANSFER_REQUEST, data, userId, async (res) => {
    await db.query(
      `UPDATE ${table} SET PostStatus = @success, ErrorDesc = NULL, SAPDocNum = @sapDocNum, SAPDocEntry = @sapDocEntry WHERE DocEntry = @docEntry`,
      [
        { name: 'docEntry', value: docEntry },
        { name: 'success', value: POST_STATUS.success },
        { name: 'sapDocNum', value: res.docNum },
        { name: 'sapDocEntry', value: res.docEntry },
      ]
    );
  });
}
