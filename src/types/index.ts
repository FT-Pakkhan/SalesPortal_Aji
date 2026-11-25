// ============================================
// API
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// ============================================
// Auth
// ============================================

export interface LoginRequest {
  userName: string;
  password: string;
  /** Several companies: the chosen company's database */
  company?: string;
}

/** A company of the login screen's Company drop-down */
export interface LoginCompany {
  database: string;
  name: string;
}

export interface LoginResponse {
  token: string;
  user: PortalUser;
}

export interface PortalUser {
  id: number;
  userName: string;
  displayName: string | null;
  email: string | null;
  /** Must choose a new password before using the portal (after a reset) */
  chgPwdOnLogon?: boolean;
  /** Several companies: the company logged in to; null / missing with one company */
  company?: LoginCompany | null;
}

// ============================================
// Users
// ============================================

export interface PortalUserDetail extends PortalUser {
  /** SAP B1 Sales Employee (OSLP.SlpCode) and its name; null = none */
  slpCode: number | null;
  slpName: string | null;
  /** Branch: SAP cost centre of Dimension 1 (OOCR.OcrCode) and its name; null = none */
  branch: string | null;
  branchName: string | null;
  isActive: boolean;
  hasPassword: boolean;
  chgPwdOnLogon: boolean;
}

export interface CreateUserDto {
  userName: string;
  password: string;
  displayName?: string;
  email?: string;
  slpCode?: number | null;
  branch?: string | null;
  isActive?: boolean;
  chgPwdOnLogon?: boolean;
}

export interface UpdateUserDto {
  userName?: string;
  displayName?: string;
  email?: string;
  slpCode?: number | null;
  branch?: string | null;
  isActive?: boolean;
  chgPwdOnLogon?: boolean;
}

// ============================================
// Approval Stages (FTS11OWST / FTS11WST1)
// ============================================

export interface ApprovalStage {
  docEntry: number;
  wstCode: string;
  wstName: string;
  maxReqr: number | null;
}

export interface ApprovalStageApprover {
  userId: number;
  userName: string;
  displayName: string | null;
}

export interface ApprovalStageDetail extends ApprovalStage {
  approvers: ApprovalStageApprover[];
}

export interface SaveApprovalStageDto {
  wstCode: string;
  wstName: string;
  maxReqr: number;
  /** SystemUsers.DocEntry of each approver */
  approverIds: number[];
}

// ============================================
// Approval Templates (FTS11OWTM / FTS11WTM1)
// ============================================

/** A row of FTS_vw_ObjType */
export interface DocumentType {
  code: string;
  name: string;
}

export interface ApprovalTemplate {
  docEntry: number;
  wtmCode: string;
  wtmName: string;
  /** FTS_vw_ObjType.Code */
  objDoc: string;
  /** FTS_vw_ObjType.Name */
  objDocName: string | null;
  active: boolean;
}

export interface ApprovalTemplateStage {
  /** Order of approval in the template (1, 2, 3 ...): the order the stages were assigned */
  stageNo?: number;
  /** FTS11OWST.DocEntry */
  wstDocEntry: number;
  wstCode: string;
  wstName: string;
}

export interface ApprovalTemplateDetail extends ApprovalTemplate {
  query: string;
  stages: ApprovalTemplateStage[];
}

export interface SaveApprovalTemplateDto {
  wtmCode: string;
  wtmName: string;
  objDoc: string;
  active: boolean;
  query: string;
  /** FTS11OWST.DocEntry of each stage */
  stageIds: number[];
}

// ============================================
// Document Numbering (FTS11NNM1 / FTS11NNM2)
// ============================================

export interface NumberingSeries {
  docEntry: number;
  /** FTS_vw_ObjType.Code */
  objType: string;
  /** FTS_vw_ObjType.Name */
  objTypeName: string | null;
  series: string;
  seriesName: string | null;
  /** May contain [YY], [YYYY], [MM] */
  prefix: string | null;
  /** Next number when not numbered by month / year */
  seq: number;
  length: number;
  suffix: string | null;
  /** Number restarts every month */
  month: boolean;
  /** Number restarts every year */
  year: boolean;
  isDefault: boolean;
  active: boolean;
  /** Manual series: the No. is keyed in on Confirm */
  isManual: boolean;
}

/** Next number of a series for one year / month (month 0 = whole year) */
export interface DateNumbering {
  year: number;
  month: number;
  seq: number;
}

export interface NumberingSeriesDetail extends NumberingSeries {
  dates: DateNumbering[];
}

export interface SaveNumberingSeriesDto {
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
  isManual: boolean;
  dates: DateNumbering[];
}

// ============================================
// SAP B1 master data (read only)
// ============================================

export interface SapCustomer {
  cardCode: string;
  cardName: string;
  /** Default contact person's name (OCRD.CntctPrsn) */
  cntctPrsn: string | null;
  /** Default sales employee (OCRD.SlpCode) */
  slpCode: number | null;
  /** Payment terms (OCRD.GroupNum; a lead's Credit Term) — a sales document's default Payment Terms */
  groupNum?: number | null;
  /** Customer Type UDF (OCRD.U_CustType, e.g. LOCAL / EXPORT) — a sales document's default Sales Type, by name */
  custType?: string | null;
  /** In the quotation's customer lookup: "Customer" (SAP) or "Lead" (FTS11LEAD) */
  cardType?: string;
  /** The customer's currency in SAP (OCRD.Currency); '##' = all currencies */
  currency?: string | null;
}

/** SAP's currencies (OCRN), the local currency and, for a date, each one's rate (null = SAP has none that day) */
export interface SapCurrencies {
  local: string;
  /** Direct rates: 1 foreign = rate local (else 1 local = rate foreign) */
  direct: boolean;
  currencies: { code: string; name: string; rate?: number | null }[];
}

export interface SapContact {
  cntctCode: number;
  name: string;
}

export interface SapSalesEmployee {
  slpCode: number;
  slpName: string;
}

/** A branch: an active SAP cost centre of Dimension 1 (OOCR) */
export interface SapBranch {
  ocrCode: string;
  ocrName: string;
}

export interface SapItem {
  itemCode: string;
  itemName: string;
  /** Sales unit of measure (OITM.SalUnitMsr) */
  salUnitMsr: string | null;
  /** Default warehouse: the item's (OITM.DfltWH), or else SAP's default warehouse (General Settings, OADM.DfltWhs) */
  dfltWH: string | null;
  /** Default sales tax code (OITM.VatGourpSa) */
  vatGroup: string | null;
  /** Price in the customer's price list, if any */
  price: number | null;
  /** Sales MOQ and its unit (OITM.U_Sales_MOQ, U_Sales_MOQ_UOM) */
  moq?: number | null;
  moqUom?: string | null;
}

export interface SapTaxCode {
  code: string;
  name: string;
  rate: number;
}

/** An SAP unit of measure (OUOM), for a line's Sales UoM */
export interface SapUom {
  uomCode: string;
  uomName: string | null;
}

export interface SapWarehouse {
  whsCode: string;
  whsName: string;
  /** The warehouse's Branch (OWHS.U_Branch, a Dimension 1 cost centre code); null when none or no such field */
  branch?: string | null;
  /** The Branch's default warehouse (OWHS.U_Default = 'Y') */
  isDefault?: boolean;
}

/** An SAP B1 price list (OPLN) */
export interface SapPriceList {
  listNum: number;
  listName: string;
}

/** One unit of an item's UoM Group (SAP UGP1 / OUOM), with the customer's price in that unit */
export interface SapItemUom {
  itemCode: string;
  uomEntry: number;
  uomCode: string;
  uomName: string;
  /** Base units in one of this unit */
  factor: number | null;
  /** Price-list price in this unit; null when the price list has none */
  price: number | null;
}

// ============================================
// Sales documents: Sales Quotation (FTS11OQUT / FTS11QUT1), Sales Order (FTS11ORDR / FTS11RDR1)
// ============================================

/** Header of a sales document (same fields for every sales document type) */
export interface SalesDocument {
  docEntry: number;
  /** Empty while DRAFT; assigned on Confirm */
  docNum: string | null;
  objType: string;
  objTypeName: string | null;
  /** FTS_vw_DocStatus.Code: DRAFT, OPEN, CLOSED, CANCELED */
  docStatus: string;
  docStatusName: string | null;
  /** FTS_vw_ApprStatus.Code: NO-APPROVAL, PENDING, APPROVED, REJECTED */
  apprStatus: string;
  apprStatusName: string | null;
  /** FTS_vw_PostStatus.Code: NO-POSTING, PENDING, FAILED, SUCCESS */
  postStatus: string;
  postStatusName: string | null;
  /** Error SAP B1 returned when posting FAILED */
  errorDesc: string | null;
  /** The document's number in SAP B1 once posted (OQUT / ORDR.DocNum) */
  sapDocNum: number | null;
  /** Has been through approval (has FTS11WDD1 rows): can never be edited again (PENDING / APPROVED / REJECTED) */
  apprLocked: boolean;
  /** The customer is a lead (FTS11LEAD; quotations only), its SAP customer once posted, and that customer's name */
  isLead: boolean;
  leadCardCode: string | null;
  leadCardName: string | null;
  /** Numbering series (FTS11NNM1.DocEntry) */
  series: number | null;
  seriesCode: string | null;
  seriesName: string | null;
  /** Sales Type (FTS_vw_SalesTyp.Code) and its name; empty only on documents saved before it existed */
  salesTyp: string | null;
  salesTypName: string | null;
  confirmedBy: string | null;
  confirmedDate: string | null;
  /** Document discount % and amount, tax and total (footer) */
  discPrcnt: number;
  discSum: number;
  vatSum: number;
  docTotal: number;
  /** Discount Type 1 .. 5: Codes of SAP's user table @DISCOUNTTYPE, each one at most once; optional */
  discType1?: string | null;
  discType2?: string | null;
  discType3?: string | null;
  discType4?: string | null;
  discType5?: string | null;
  /** Bank Info: a Code of SAP's user table @SELLERBANK; optional */
  bankInfo?: string | null;
  /** Delivery: Bill To / Ship To (the customer's SAP address names; none for a lead) and their text */
  payToCode?: string | null;
  shipToCode?: string | null;
  address?: string | null;
  address2?: string | null;
  /** Bill To / Ship To Address Line 1 .. 4 (SAP Street / StreetNo / Block / City) and Delivery Zone (@DELIVERYZONE Code) */
  billStreet?: string | null;
  billStreetNo?: string | null;
  billBlock?: string | null;
  billCity?: string | null;
  billDeliveryZone?: string | null;
  shipStreet?: string | null;
  shipStreetNo?: string | null;
  shipBlock?: string | null;
  shipCity?: string | null;
  shipDeliveryZone?: string | null;
  /** Document currency (local for documents made before currencies), SAP's rate, and the totals in it */
  docCur?: string;
  docRate?: number;
  discSumFC?: number;
  vatSumFC?: number;
  docTotalFC?: number;
  /** The customer's currency in SAP ('##' = all currencies; a lead: none) */
  cardCurrency?: string | null;
  cardCode: string;
  cardName: string | null;
  cntctCode: number | null;
  contactName: string | null;
  numAtCard: string | null;
  /** Payment Terms (SAP OCTG.GroupNum) and its name; empty = the customer's own in SAP */
  groupNum: number | null;
  pymntGroup: string | null;
  /** COA (SAP UDF U_COA): 'Y' / 'N'; empty = not chosen */
  coa: string | null;
  /** Branch (SAP Dimension 1 cost centre) and its name; empty = none */
  branch: string | null;
  branchName: string | null;
  /** Trade Remarks (SAP Comments; "Remarks" on a Credit Memo) */
  comments: string | null;
  /** Internal Remarks (SAP UDF U_InComments); not on a Credit Memo */
  inComments: string | null;
  /** T&C (SAP UDF U_TAC); not on a Credit Memo */
  tac: string | null;
  /** ISO date strings */
  docDate: string;
  docDueDate: string;
  taxDate: string | null;
  slpCode: number | null;
  slpName: string | null;
}

/** A line of a sales document (FTS11QUT1, FTS11RDR1) */
export interface SalesDocumentLine {
  /** Screen-only key, stable while lines are added / edited (not stored) */
  rowKey?: string;
  /** The line's permanent key (kept when lines above it are removed or moved); -1 for a line not saved yet */
  lineNum: number;
  /** Position on screen 0, 1, 2 ... (VisOrder); shown as the line's # */
  visOrder?: number;
  itemCode: string;
  dscription: string | null;
  quantity: number;
  /** Quantity not yet copied to a later document; set by the server (read only) */
  openQty?: number;
  /** FTS_vw_LineStatus.Code: OPEN, CLOSED, CANCELED; set by the server (read only) */
  lineStatus?: string;
  uomCode: string | null;
  /** The item's Sales MOQ and its unit, from the SAP item master (read only, not saved on the line) */
  moq?: number | null;
  moqUom?: string | null;
  priceBefDi: number | null;
  discPrcnt: number | null;
  price: number | null;
  vatGroup: string | null;
  vatPrcnt: number | null;
  lineTotal: number | null;
  whsCode: string | null;
  /** Item details (long text) */
  text: string | null;
  /** FOC (free of charge) item: Unit Price 0, locked while ticked */
  isFoc?: boolean;
  /** Line total in the local currency (read only; lineTotal is in the document currency) */
  lineTotalLC?: number | null;
  /** Server only: the line total in a foreign document currency (FTS11QUT1.TotalFrgn) */
  totalFrgn?: number;
  /**
   * Export Qty / Export UoM (an SAP unit, OUOM) / Export Unit Price (per Export UoM): only on a Sales Type EXPORT
   * document, posted to SAP's line UDFs U_SalesQty / U_SalesUoM / U_SalesPrice. The screen fills in the Unit Price
   * from them: Export Unit Price x Export Qty / Quantity.
   */
  salesQty?: number | null;
  salesUom?: string | null;
  salesPrice?: number | null;
  /** Screen only: the Unit Price before FOC was ticked, given back when it is unticked (not stored) */
  focPrevPrice?: number | null;
  /** Copied from (Copy From): source document type, its DocEntry and LineNum, and its No. — not shown on screen */
  baseType?: string | null;
  baseEntry?: number | null;
  baseLine?: number | null;
  baseRef?: string | null;
}

/** An open line of an OPEN document that can be copied (Copy From) */
export interface CopySourceLine {
  baseType: string;
  baseEntry: number;
  baseLine: number;
  /** The source line's position on its document (VisOrder), shown as its # */
  baseVisOrder?: number;
  /** Source document No. */
  baseRef: string | null;
  docDate: string;
  itemCode: string;
  dscription: string | null;
  quantity: number;
  /** Still open on the source line — the most that can be copied */
  openQty: number;
  uomCode: string | null;
  /** The item's Sales MOQ and its unit, from the SAP item master */
  moq?: number | null;
  moqUom?: string | null;
  priceBefDi: number | null;
  discPrcnt: number | null;
  price: number | null;
  vatGroup: string | null;
  vatPrcnt: number | null;
  whsCode: string | null;
  text: string | null;
  isFoc?: boolean;
  salesQty?: number | null;
  salesUom?: string | null;
  salesPrice?: number | null;
  /** The source document's currency (its prices are in it) */
  baseDocCur?: string;
  /** The source document's own Discount % (footer), copied with its lines */
  baseDiscPrcnt?: number | null;
}

export interface SalesDocumentDetail extends SalesDocument {
  lines: SalesDocumentLine[];
}

export interface SaveSalesDocumentLineDto extends SalesDocumentLine {
  /** LineNum the line had when loaded (keeps who / when it was created); null for a new line */
  origLineNum: number | null;
}

export interface SaveSalesDocumentDto {
  series: number | null;
  /** Manual series: the No. typed on the draft (checked on Confirm) */
  docNum?: string | null;
  /** FTS_vw_SalesTyp.Code — mandatory */
  salesTyp: string;
  cardCode: string;
  cardName: string | null;
  cntctCode: number | null;
  numAtCard: string | null;
  /** Payment Terms (SAP OCTG.GroupNum); optional */
  groupNum: number | null;
  /** COA (SAP UDF U_COA): 'Y' / 'N'; optional */
  coa?: string | null;
  /** Branch (SAP Dimension 1 cost centre); optional */
  branch?: string | null;
  comments: string | null;
  /** Internal Remarks (SAP UDF U_InComments); optional */
  inComments?: string | null;
  /** T&C (SAP UDF U_TAC); optional */
  tac?: string | null;
  /** YYYY-MM-DD */
  docDate: string;
  docDueDate: string;
  taxDate: string | null;
  slpCode: number | null;
  lines: SaveSalesDocumentLineDto[];
  /** Document discount %; the amount, tax and total are worked out from it on the server */
  discPrcnt: number;
  /** Currency; empty = the customer's default (an "all currencies" customer may choose) */
  docCur?: string | null;
  /** Discount Type 1 .. 5: Codes of SAP's user table @DISCOUNTTYPE, each one at most once; optional */
  discType1?: string | null;
  discType2?: string | null;
  discType3?: string | null;
  discType4?: string | null;
  discType5?: string | null;
  /** Bank Info: a Code of SAP's user table @SELLERBANK; optional */
  bankInfo?: string | null;
  /** Bill To / Ship To: the customer's SAP address names (none for a lead) and the address text; optional */
  payToCode?: string | null;
  shipToCode?: string | null;
  address?: string | null;
  address2?: string | null;
  /** Bill To / Ship To Address Line 1 .. 4 (SAP Street / StreetNo / Block / City) and Delivery Zone (@DELIVERYZONE Code) */
  billStreet?: string | null;
  billStreetNo?: string | null;
  billBlock?: string | null;
  billCity?: string | null;
  billDeliveryZone?: string | null;
  shipStreet?: string | null;
  shipStreetNo?: string | null;
  shipBlock?: string | null;
  shipCity?: string | null;
  shipDeliveryZone?: string | null;
}

/** A SAP customer's address (CRD1) for a sales document's Bill To / Ship To */
export interface SapCustomerAddress {
  /** Address name (CRD1.Address) */
  address: string;
  /** 'B' Bill To, 'S' Ship To */
  adresType: 'B' | 'S';
  /** The address laid out as text: Address Line 1 .. 4, then textTail */
  text: string;
  /** Address Line 1 .. 4 (SAP Street / StreetNo / Block / City) */
  street: string | null;
  streetNo: string | null;
  block: string | null;
  city: string | null;
  /** The rest of the text after the Address Lines: county / state / zip code, country */
  textTail: string;
  /** Delivery Zone (CRD1.U_DeliveryZone) and its name */
  deliveryZone: string | null;
  deliveryZoneName: string | null;
}

/** A SAP customer's Bill To / Ship To addresses and its default ones */
export interface SapCustomerAddresses {
  addresses: SapCustomerAddress[];
  billToDef: string | null;
  shipToDef: string | null;
}

/** A Seller Bank (Bank Info): a row of SAP's user table @SELLERBANK */
export interface SapSellerBank {
  code: string;
  name: string | null;
}

/** A Discount Type: a row of SAP's user table @DISCOUNTTYPE */
export interface SapDiscountType {
  code: string;
  name: string | null;
}

// ============================================
// General Settings (FTS11OADM)
// ============================================

/** A row of FTS_vw_SalesTyp (Sales Type of a sales document) */
export interface SalesType {
  code: string;
  name: string;
}

/** A row of FTS_vw_SvrTyp */
export interface ServerType {
  code: string;
  name: string;
}

export interface GeneralSettings {
  compnyName: string | null;
  attachPath: string | null;
  attachMaxSizeMB: number;
  sapServer: string | null;
  /** FTS_vw_SvrTyp.Code */
  sapDbServerType: string | null;
  sapCompanyDB: string | null;
  sapUseTrusted: boolean;
  sapDbUserName: string | null;
  sapUserName: string | null;
  sapLicenseServer: string | null;
  sapSLDServer: string | null;
  /** Passwords are never sent to the screen, only whether one is saved */
  hasSapDbPassword: boolean;
  hasSapPassword: boolean;
  /** SMTP: the mail server the portal sends e-mail through */
  smtpHost: string | null;
  smtpPort: number | null;
  /** NONE / SSL / STARTTLS */
  smtpSecurity: string | null;
  smtpUserName: string | null;
  hasSmtpPassword: boolean;
  smtpFromEmail: string | null;
  smtpFromName: string | null;
  /** E-mail approval notifications on, and the portal's address for their links */
  apprEmail: boolean;
  portalUrl: string | null;
  /** Incoming Payment: Cash / Cheque G/L accounts and credit card for posting Temporary Receipts */
  payCashAcct: string | null;
  payCheckAcct: string | null;
  payCreditCard: number | null;
  /** SAP price list for a lead or no customer (a customer's own price list comes first) */
  defaultPriceList: number | null;
  updatedBy: string | null;
  updatedDate: string | null;
}

/** General Settings > Incoming Payment choices from SAP B1 */
export interface SapPaymentAccounts {
  accounts: { acctCode: string; acctName: string }[];
  creditCards: { creditCard: number; cardName: string }[];
}

// ============================================
// Leads (FTS11LEAD)
// ============================================

export interface Lead extends LeadFormFields {
  docEntry: number;
  /** The lead's currency (SAP OCRN; the local one when none set): its quotations are in it */
  currency?: string;
  /** Fixed: the lead has a quotation */
  currencyLocked?: boolean;
  /** Given on Confirm from Document Numbering; empty while DRAFT */
  leadCode: string | null;
  leadName: string;
  /** Numbering series (FTS11NNM1.DocEntry), its code and name */
  series: number | null;
  seriesCode: string | null;
  seriesName: string | null;
  /** FTS_vw_DocStatus.Code: DRAFT, OPEN, ... and its name */
  docStatus: string;
  docStatusName: string | null;
  /** FTS_vw_ApprStatus.Code and its name */
  apprStatus: string;
  apprStatusName: string | null;
  /** Business Partner code in SAP B1 once posted */
  cardCode: string | null;
  /** SAP B1 Sales Employee (OSLP.SlpCode) and its name */
  slpCode: number | null;
  slpName: string | null;
  /** FTS_vw_PostStatus.Code and its name */
  postStatus: string;
  postStatusName: string | null;
  /** Error SAP B1 returned when posting FAILED */
  errorDesc: string | null;
  /** Remarks */
  comments: string | null;
  /** Has been through approval: can't be edited or confirmed again */
  apprLocked: boolean;
  /** Who confirmed it (or sent it for approval), and when */
  confirmedBy: string | null;
  confirmedDate: string | null;
  /** Approved Credit Limit: keyed in when the lead is posted to SAP (with the SAP BP code) */
  creditLine: number | null;
  /** Credit Term's name (SAP OCTG) */
  pymntGroup: string | null;
  /** Contact persons (in-charge persons and directors) */
  contacts: LeadContact[];
}

/** A lead's contact person (FTS11LED1): an in-charge person or a director */
export interface LeadContact {
  /** The contact's permanent key (FTS11LED1.LineNum); null / missing for a contact added on screen */
  lineNum?: number | null;
  role: LeadContactRole;
  /** For OTHERS: which department / role */
  roleDesc: string | null;
  name: string;
  tel: string | null;
  email: string | null;
}

export type LeadContactRole = 'PURCHASING' | 'RECEIVING' | 'ACCOUNT' | 'DIRECTOR' | 'OTHERS';

/** The New Account Application Form fields of a lead (saved with it; * ones required on Confirm) */
export interface LeadFormFields {
  docDate: string | null;
  regNo: string | null;
  yearsInBiz: number | null;
  billStreet: string | null;
  billStreetNo: string | null;
  billBlock: string | null;
  billCity: string | null;
  billZipCode: string | null;
  billState: string | null;
  billCountry: string | null;
  shipSameAsBill: boolean;
  shipStreet: string | null;
  shipStreetNo: string | null;
  shipBlock: string | null;
  shipCity: string | null;
  shipZipCode: string | null;
  shipState: string | null;
  shipCountry: string | null;
  email: string | null;
  eInvEmail: string | null;
  natureOfBiz: string | null;
  mainProducts: string | null;
  supplier1: string | null;
  supplier2: string | null;
  recCreditLine: number | null;
  groupNum: number | null;
  msicCode: string | null;
  tin: string | null;
  sstNo: string | null;
}

/** A lead is saved with its name and series only; its application form is filled in on Convert to Customer */
export interface SaveLeadDto {
  leadName: string;
  series: number | null;
  /** Currency (SAP OCRN); empty = the local one */
  currency?: string | null;
  /** Manual series: the Lead Code typed on the draft (checked on Confirm) */
  leadCode?: string | null;
}

// ============================================
// Convert to Customer (FTS11OCRD / contacts FTS11CRD1 / addresses FTS11CRD2)
// ============================================

/** The request to create an OPEN lead in SAP B1 as a customer: the lead's application form, completed */
export interface CustomerConversion extends LeadFormFields {
  docEntry: number;
  /** The lead's currency: the customer is created in it */
  currency?: string;
  /** Given on Confirm from Document Numbering; empty while DRAFT */
  docNum: string | null;
  series: number | null;
  seriesCode: string | null;
  seriesName: string | null;
  /** The lead converted (FTS11LEAD.DocEntry) and its Lead Code */
  leadEntry: number;
  leadCode: string | null;
  /** SAP BP Code the customer gets (keyed in; required on Confirm) */
  cardCode: string | null;
  /** Company Name (the SAP BP name) */
  leadName: string;
  /** Approved Credit Limit */
  creditLine: number | null;
  slpCode: number | null;
  slpName: string | null;
  /** BP Group (SAP OCRG customer group) and its name */
  groupCode: number | null;
  groupName: string | null;
  docStatus: string;
  docStatusName: string | null;
  apprStatus: string;
  apprStatusName: string | null;
  postStatus: string;
  postStatusName: string | null;
  errorDesc: string | null;
  comments: string | null;
  /** Waiting for approval or approved: can't be edited (a rejected one can be changed and sent again) */
  apprLocked: boolean;
  /** Update Customer: the conversion it was filled from (and its No.); empty = a new customer */
  baseEntry: number | null;
  baseDocNum: string | null;
  confirmedBy: string | null;
  confirmedDate: string | null;
  /** Credit Term's name (SAP OCTG) */
  pymntGroup: string | null;
  contacts: LeadContact[];
  addresses: ConversionAddress[];
}

/** A Convert to Customer address (FTS11CRD2), as SAP B1's BP addresses */
export interface ConversionAddress {
  /** The address's permanent key (FTS11CRD2.LineNum); null / missing for one added on screen */
  lineNum?: number | null;
  /** B = Bill To, S = Ship To */
  adresType: 'B' | 'S';
  /** Address ID (unique within its type) */
  address: string;
  /** Address Lines 1-4: Street, StreetNo, Block, City (SAP CRD1) */
  street: string | null;
  streetNo: string | null;
  block: string | null;
  city: string | null;
  zipCode: string | null;
  state: string | null;
  country: string | null;
  /** Delivery Zone: Code of SAP UDT @DELIVERYZONE (posted as CRD1.U_DeliveryZone) */
  deliveryZone: string | null;
  /** The type's default address (one per type) */
  isDefault: boolean;
}

/** The application form's single address fields: on Convert to Customer the Addresses tab's rows are used instead */
type FormAddressField =
  | 'billStreet' | 'billStreetNo' | 'billBlock' | 'billCity' | 'billZipCode' | 'billState' | 'billCountry'
  | 'shipSameAsBill' | 'shipStreet' | 'shipStreetNo' | 'shipBlock' | 'shipCity' | 'shipZipCode' | 'shipState' | 'shipCountry';

export interface SaveCustomerConversionDto extends Omit<LeadFormFields, FormAddressField> {
  leadEntry: number;
  leadName: string;
  cardCode: string | null;
  creditLine: number | null;
  slpCode: number | null;
  groupCode: number | null;
  series: number | null;
  comments: string | null;
  contacts: LeadContact[];
  addresses: ConversionAddress[];
}

/** SAP choices for addresses and credit term */
export interface SapAddressLists {
  countries: { code: string; name: string }[];
  states: { country: string; code: string; name: string }[];
  paymentTerms: { groupNum: number; pymntGroup: string }[];
  /** SAP customer groups (OCRG, type Customer, not locked) - Convert to Customer's BP Group */
  customerGroups: { groupCode: number; groupName: string }[];
  /** SAP UDT @DELIVERYZONE (empty if the company database doesn't have it) - an address's Delivery Zone */
  deliveryZones: { code: string; name: string | null; state: string | null; city: string | null; area: string | null }[];
}

// ============================================
// Temporary Receipts (FTS11TMPR)
// ============================================

/** Payment type (FTS_vw_PayTyp) */
export interface PayType {
  code: string;
  name: string;
}

export interface TemporaryReceipt extends ReceiptPaymentMeans {
  docEntry: number;
  /** Given on Confirm from Document Numbering; empty while DRAFT */
  docNum: string | null;
  series: number | null;
  seriesCode: string | null;
  seriesName: string | null;
  /** Posting Date (locked once confirmed) and Document Date */
  docDate: string;
  taxDate: string | null;
  /** SAP B1 customer */
  cardCode: string;
  cardName: string | null;
  /** FTS_vw_PayTyp.Code and its name */
  payTyp: string;
  payTypName: string | null;
  /** Amount in the receipt's currency (docCur); docTotalLC in the local currency; SAP's rate */
  docTotal: number;
  docTotalLC?: number;
  docCur?: string;
  docRate?: number;
  /** The customer's currency in SAP ('##' = all currencies) */
  cardCurrency?: string | null;
  docStatus: string;
  docStatusName: string | null;
  apprStatus: string;
  apprStatusName: string | null;
  postStatus: string;
  postStatusName: string | null;
  errorDesc: string | null;
  /** SAP B1 Incoming Payment No. / key once posted */
  sapDocNum: number | null;
  sapDocEntry: number | null;
  /** Remarks */
  comments: string | null;
  /** Has been through approval: can't be edited or confirmed again */
  apprLocked: boolean;
  /** Waiting for the logged-in user's approval now: they may change it while approving (Series and Customer fixed) */
  canApproverEdit?: boolean;
  /** Who confirmed it (or sent it for approval), and when */
  confirmedBy: string | null;
  confirmedDate: string | null;
  /** On Account: Amount - total Amount Applied */
  noDocSum: number;
  /** The documents it pays (FTS11TMP1) */
  lines: TemporaryReceiptLine[];
  /** Payment Means; the bank transfer's house bank account as "CIMB - 3434" */
  trsfrBankName: string | null;
  /** The Temporary Receipt Request it was copied from, if any */
  baseEntry: number | null;
  baseDocNum: string | null;
}

/** How the customer paid (Payment Means popup): Amount = all of these + Bank Charge */
export interface ReceiptPaymentMeans {
  /** The cheques, each with its No. and amount (FTS11TMP2) */
  cheques: ReceiptCheque[];
  /** Their total (worked out) */
  checkSum: number;
  trsfrSum: number;
  /** SAP house bank account (DSC1.AbsEntry) */
  trsfrBank: number | null;
  creditSum: number;
  cashSum: number;
  /** One for the whole receipt, as in SAP B1 */
  bcgSum: number;
}

/** A Temporary Receipt Request (FTS11OTRQ): header and payment means; copied into Temporary Receipts */
export interface ReceiptRequest extends ReceiptPaymentMeans {
  docEntry: number;
  docNum: string | null;
  series: number | null;
  seriesCode: string | null;
  seriesName: string | null;
  docDate: string;
  /** Ticked: the customer was chosen from SAP; not ticked: only the name was typed */
  knownCust: boolean;
  cardCode: string | null;
  cardName: string;
  slpCode: number | null;
  slpName: string | null;
  payTyp: string | null;
  payTypName: string | null;
  /** Amount in the request's currency (docCur); docTotalLC in the local currency; SAP's rate */
  docTotal: number;
  docTotalLC?: number;
  docCur?: string;
  docRate?: number;
  /** The customer's currency in SAP ('##' = all currencies); none without a known customer */
  cardCurrency?: string | null;
  trsfrBankName: string | null;
  comments: string | null;
  docStatus: string;
  docStatusName: string | null;
  apprStatus: string;
  apprStatusName: string | null;
  apprLocked: boolean;
  confirmedBy: string | null;
  confirmedDate: string | null;
  /** Receipts copied from it that still count, and the confirmed ones (they close it) */
  copiedTotal: number;
  confirmedTotal: number;
  receiptCount: number;
  receipts: { docEntry: number; docNum: string | null; cardCode: string; docTotal: number; docCur?: string; docStatus: string; apprStatus: string }[];
}

export interface SaveReceiptRequestDto extends ReceiptPaymentMeans {
  series: number | null;
  /** Manual series: the No. typed on the draft (checked on Confirm) */
  docNum?: string | null;
  /** yyyy-mm-dd */
  docDate: string;
  knownCust: boolean;
  cardCode: string | null;
  cardName: string;
  slpCode: number | null;
  comments: string | null;
  /** Currency; empty = the customer's default (local without a known customer) */
  docCur?: string | null;
}

/** Copy To Temporary Receipt: what is still left on a request */
export interface ReceiptRequestCopy {
  baseEntry: number;
  baseDocNum: string | null;
  knownCust: boolean;
  cardCode: string | null;
  cardName: string;
  comments: string | null;
  remainingTotal: number;
  means: Omit<ReceiptPaymentMeans, 'checkSum'>;
  /** The request's currency: the receipt is in it */
  docCur?: string;
}

/** One cheque of a receipt */
export interface ReceiptCheque {
  checkNum: string;
  checkSum: number;
}

/** The company's own bank account in SAP B1 (house bank account, DSC1) */
export interface SapHouseBank {
  absEntry: number;
  bankCode: string;
  account: string;
  glAccount: string | null;
  bankName: string | null;
}

/** A customer's open SAP item (FTS_fn_UnreconciledDocs) that a receipt may pay */
export interface ReceiptOpenItem {
  /** 13 A/R Invoice, 14 A/R Credit Memo, 203 A/R Down Payment Invoice, 30 Journal Entry (payments too) */
  transType: string;
  /** 13, 14, 30, 24 Incoming / 46 Outgoing Payment */
  oriTransType: string;
  docType: string;
  docNum: string | null;
  oriDocEntry: number;
  /** The SAP journal line: TransId + LineId */
  transId: number;
  lineId: number;
  postingDate: string | null;
  dueDate: string | null;
  daysOverdue?: number;
  /** Open amount in the receipt's currency; minus = in the customer's favour */
  balanceDue: number;
  /** The document's own currency */
  itemCur?: string;
}

/** A receipt line (FTS11TMP1): an open item and how much the receipt pays on it */
export interface TemporaryReceiptLine extends ReceiptOpenItem {
  lineNum?: number;
  sumApplied: number;
}

// ============================================
// Inventory Transfers (FTS11OWTR / FTS11WTR1)
// ============================================

export interface InventoryTransferLine {
  lineNum?: number;
  itemCode: string;
  dscription: string | null;
  quantity: number;
  /** Inventory unit (OITM.InvntryUom) */
  uomCode: string | null;
  /** From / To warehouse (SAP's spellings) */
  fromWhsCod: string;
  whsCode: string;
  text: string | null;
  /** Stock in the From warehouse now (SAP B1 OITW), shown for reference */
  onHand?: number | null;
}

export interface InventoryTransfer {
  docEntry: number;
  /** Given on Confirm; empty while DRAFT */
  docNum: string | null;
  series: number | null;
  seriesCode: string | null;
  seriesName: string | null;
  /** Optional business partner */
  cardCode: string | null;
  cardName: string | null;
  docDate: string;
  taxDate: string | null;
  /** Default From / To warehouse for the lines */
  filler: string | null;
  fillerName: string | null;
  toWhsCode: string | null;
  toWhsName: string | null;
  slpCode: number | null;
  slpName: string | null;
  comments: string | null;
  docStatus: string;
  docStatusName: string | null;
  apprStatus: string;
  apprStatusName: string | null;
  postStatus: string;
  postStatusName: string | null;
  errorDesc: string | null;
  sapDocNum: number | null;
  confirmedBy: string | null;
  confirmedDate: string | null;
  canceledBy: string | null;
  canceledDate: string | null;
  apprLocked: boolean;
  lineCount: number;
  totalQuantity: number | null;
  lines: InventoryTransferLine[];
}

export interface SaveInventoryTransferDto {
  series: number | null;
  /** Manual series: the No. typed on the draft (checked on Confirm) */
  docNum?: string | null;
  cardCode: string | null;
  cardName: string | null;
  /** yyyy-mm-dd */
  docDate: string;
  taxDate: string | null;
  filler: string | null;
  toWhsCode: string | null;
  slpCode: number | null;
  comments: string | null;
  /** lineNum: the line's permanent key when it was loaded; null for a line added on screen */
  lines: (Omit<InventoryTransferLine, 'lineNum' | 'onHand'> & { lineNum: number | null })[];
}

/** An inventory item for the transfer lookup (SAP B1 OITM / OITW) */
export interface SapStockItem {
  itemCode: string;
  itemName: string | null;
  invntryUom: string | null;
  /** The item's default warehouse, or else SAP's default warehouse (General Settings) */
  dfltWH: string | null;
  /** In that default warehouse */
  whsOnHand: number | null;
  totalOnHand: number | null;
}

// ============================================
// Roles (FTS11OROL / FTS11ROL1 / FTS11ROL2)
// ============================================

export interface Role {
  docEntry: number;
  roleName: string;
  /** Administrator: every screen with Full access */
  isAdmin: boolean;
  userCount: number;
}

export interface RoleUser {
  userId: number;
  userName: string;
  displayName: string | null;
  isActive: boolean;
}

export interface RoleScreen {
  screenCode: string;
  access: 'FULL' | 'READ' | 'NONE';
}

/** A report (Report Settings) and whether the role may run it */
export interface RoleReport {
  reportEntry: number;
  reportName: string;
  category: string | null;
  isActive: boolean;
  allowed: boolean;
}

export interface RoleDetail extends Role {
  users: RoleUser[];
  /** Only screens with FULL / READ; the rest are NONE */
  screens: RoleScreen[];
  /** Every report; allowed = the role may run it */
  reports: RoleReport[];
}

export interface SaveRoleDto {
  roleName: string;
  isAdmin: boolean;
  userIds: number[];
  screens: RoleScreen[];
  /** The reports the role may run */
  reportIds: number[];
}

/** An approval stage a user approves in (Users: warning before deactivating an approver) */
export interface ApproverStage {
  wstCode: string;
  wstName: string;
  /** Approvals Required */
  maxReqr: number;
  /** Active approvers now, this user included */
  activeApprovers: number;
  /** Active approval templates using the stage, e.g. "TPL1, TPL2"; null if none */
  templates: string | null;
}

// ============================================
// Sales Check In (FTS11SCIN)
// ============================================

export interface SalesCheckIn {
  docEntry: number;
  /** Visit No., from Document Numbering on Check In */
  docNum: string;
  series: number;
  seriesCode: string | null;
  seriesName: string | null;
  cardCode: string;
  cardName: string | null;
  /** The visiting user's Sales Employee */
  slpCode: number;
  slpName: string | null;
  /** Who checked in (SystemUsers) */
  userID: number;
  userName: string | null;
  userDisplayName: string | null;
  purpose: string;
  /** OPEN while checked in, CLOSED once checked out */
  docStatus: string;
  docStatusName: string | null;
  checkInTime: string;
  checkInLat: number | null;
  checkInLng: number | null;
  /** GPS accuracy in metres */
  checkInAccuracy: number | null;
  checkInAddress: string | null;
  checkOutTime: string | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  checkOutAccuracy: number | null;
  checkOutAddress: string | null;
  /** Minutes; empty until checked out */
  duration: number | null;
  comments: string | null;
}

/** A GPS reading from the browser / phone */
export interface GpsLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export interface CheckInDto {
  series: number;
  cardCode: string;
  cardName: string | null;
  purpose: string;
  comments: string | null;
  location: GpsLocation;
}

/** Payment Type and Amount aren't sent: the server works them out from the payment means */
export interface SaveTemporaryReceiptDto extends ReceiptPaymentMeans {
  comments: string | null;
  series: number | null;
  /** Manual series: the No. typed on the draft (checked on Confirm) */
  docNum?: string | null;
  /** Saved by an approver while approving: why (optional; kept on the Approval tab) */
  changeReason?: string;
  /** Posting Date / Document Date, yyyy-mm-dd */
  docDate: string;
  taxDate: string | null;
  cardCode: string;
  cardName: string | null;
  lines: { transId: number; lineId: number; sumApplied: number }[];
  /** A new receipt copied from a Temporary Receipt Request */
  baseEntry?: number | null;
}

// ============================================
// Print layouts (FTS11SLYT)
// ============================================

/** A Crystal Reports layout (.rpt) a document type can be printed with */
export interface PrintLayout {
  docEntry: number;
  layoutName: string;
  /** Full path of the .rpt file on the server */
  layoutPath: string;
  /** Document type (FTS_vw_ObjType.Code) and its name */
  objDoc: string;
  objDocName: string | null;
  isActive: boolean;
  /** The printed PDF's window shows E-mail */
  emailAllowed: boolean;
}

export interface SavePrintLayoutDto {
  layoutName: string;
  layoutPath: string;
  objDoc: string;
  isActive: boolean;
  emailAllowed: boolean;
}

// ============================================
// Notifications (FTS11ONTF, the bell)
// ============================================

export type NotificationType = 'APPR_WAITING' | 'APPR_STAGE' | 'APPR_DONE' | 'APPR_REJECTED' | 'APPR_CHANGED' | 'POST_FAILED';

export interface PortalNotification {
  absEntry: number;
  ntfType: NotificationType;
  title: string;
  message: string | null;
  /** The document it opens */
  objType: string | null;
  objTypeName: string | null;
  docEntry: number | null;
  isRead: boolean;
  readDate: string | null;
  createdBy: string | null;
  createdDate: string;
}

export interface NotificationSummary {
  unread: number;
  latest: string | null;
}

// ============================================
// Relationship Map (Sales Quotation / Sales Order, linked by Copy From / Copy To)
// ============================================

export interface MapDocument {
  /** "<objType>:<docEntry>" */
  id: string;
  objType: string;
  /** e.g. Sales quotation */
  typeName: string;
  docEntry: number;
  docNum: string | null;
  docDate: string;
  /** Customer code (a lead not converted yet: none) */
  cardCode: string | null;
  cardName: string | null;
  /** None on a Lead / Convert to Customer */
  docTotal: number | null;
  docStatus: string;
  docStatusName: string | null;
  apprStatus: string;
  postStatus: string;
}

export interface RelationshipMapData {
  startId: string;
  nodes: MapDocument[];
  edges: { from: string; to: string }[];
  /** Stopped at its size limit: some documents aren't shown */
  truncated: boolean;
}

// ============================================
// Reports (FTS11SRPT / FTS11RPT1 / FTS11RPT2; Crystal Reports)
// ============================================

export type ReportParamType = 'STRING' | 'INTEGER' | 'DECIMAL' | 'DATE' | 'DATETIME' | 'BOOLEAN';
/** KEYIN = typed by the user; LIST = chosen from the result of the parameter's query */
export type ReportInputType = 'KEYIN' | 'LIST';

/** A report in the Report Settings list */
export interface ReportSetting {
  docEntry: number;
  reportCode: string;
  reportName: string;
  reportPath: string;
  category: string | null;
  remarks: string | null;
  isActive: boolean;
  /** Log on with the SAP DI API setting (SAP company database) instead of the portal's database setting */
  useSapConn: boolean;
  /** E-mail tab: may be e-mailed after Run; default recipients; templates */
  emailAllowed: boolean;
  emailTo: string | null;
  emailCc: string | null;
  emailToQuery: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  emailFileName: string | null;
  paramCount: number;
  /** Names of the roles that may run it, comma separated */
  roleNames: string | null;
}

/** A parameter of a report (Parameters tab) */
export interface ReportParam {
  lineNum?: number;
  /** As in the .rpt */
  paramName: string;
  caption: string;
  paramType: ReportParamType;
  inputType: ReportInputType;
  query: string | null;
  allowMulti: boolean;
  isRange: boolean;
  mandatory: boolean;
  defaultValue: string | null;
}

export interface ReportRole {
  roleEntry: number;
  roleName: string;
  isAdmin: boolean;
}

export interface ReportSettingDetail extends ReportSetting {
  params: ReportParam[];
  roles: ReportRole[];
}

// ============================================
// Dashboard (My Work tiles) and Dashboard Settings (FTS11ODSH / FTS11DSH1)
// ============================================

/** A document behind a My Work tile */
export interface DashboardTileItem {
  /** FTS_vw_ObjType.Code, e.g. FTS11ORDR (FTS11SCIN for a visit) */
  objType: string;
  typeName: string;
  docEntry: number;
  docNum: string | null;
  name: string | null;
  docDate: string | null;
  total: number | null;
  note: string | null;
}

export interface DashboardTile {
  key: 'APPROVALS' | 'MY_DRAFTS' | 'SENT_PENDING' | 'POST_FAILED' | 'NOT_POSTED' | 'CHECKED_IN';
  title: string;
  hint: string;
  count: number;
  /** The newest 100 */
  items: DashboardTileItem[];
}

export type WidgetType = 'KPI' | 'BAR' | 'LINE' | 'PIE' | 'TABLE';
export type WidgetValueFormat = 'NUMBER' | 'AMOUNT' | 'PERCENT';

/** A widget as the Dashboard shows it (its data is fetched separately) */
export interface DashboardWidget {
  docEntry: number;
  widgetCode: string;
  title: string;
  widgetType: WidgetType;
  /** 1 = quarter row, 2 = half, 4 = whole row */
  width: 1 | 2 | 4;
  valueFormat: WidgetValueFormat;
  linkPath: string | null;
  remarks: string | null;
}

/** A widget query's result: column names as written in the query, rows as arrays in that order */
export interface DashboardWidgetData {
  columnList: { name: string }[];
  rowList: { cells: unknown[] }[];
  truncated: boolean;
}

export interface DashboardData {
  myWork: DashboardTile[];
  widgets: DashboardWidget[];
}

/** Dashboard Settings list row */
export interface DashboardWidgetSetting extends DashboardWidget {
  query: string;
  useSapConn: boolean;
  sequence: number;
  isActive: boolean;
  roleNames: string | null;
}

export interface DashboardWidgetSettingDetail extends DashboardWidgetSetting {
  roles: ReportRole[];
}

export interface SaveDashboardWidgetDto {
  widgetCode: string;
  title: string;
  widgetType: WidgetType;
  query: string;
  useSapConn: boolean;
  width: number;
  sequence: number;
  valueFormat: WidgetValueFormat;
  linkPath: string | null;
  remarks: string | null;
  isActive: boolean;
  roleIds: number[];
}

export interface SaveReportSettingDto {
  reportCode: string;
  reportName: string;
  reportPath: string;
  category: string | null;
  remarks: string | null;
  isActive: boolean;
  useSapConn: boolean;
  emailAllowed: boolean;
  emailTo: string | null;
  emailCc: string | null;
  emailToQuery: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  emailFileName: string | null;
  params: ReportParam[];
  roleIds: number[];
}

/** A parameter as found in a .rpt file (Read Parameters from Report) */
export interface RptParameter {
  name: string;
  prompt: string;
  type: ReportParamType;
  multi: boolean;
  range: boolean;
  inUse: boolean;
}

/** A report in the Reports module (one the user may run) */
export interface MyReport {
  docEntry: number;
  reportCode: string;
  reportName: string;
  category: string | null;
  remarks: string | null;
}

/** A report to run: its parameters (no query: choices come from the server) */
export interface RunnableReport extends MyReport {
  params: Omit<ReportParam, 'query'>[];
  /** E-mail is offered after Run */
  emailAllowed: boolean;
}

/** The E-mail form filled in from the report's E-mail tab */
export interface ReportEmailDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
  /** Without .pdf */
  fileName: string;
  /** The user's own e-mail (Send me a copy); null = none on their user */
  myEmail: string | null;
}

/** What the E-mail form sends (a report's or a printed layout's PDF) */
export interface EmailPdfFields {
  to: string;
  cc: string;
  subject: string;
  body: string;
  /** Without .pdf */
  fileName: string;
  copyMe: boolean;
}

/** A report e-mailed from the portal (E-mail Log, FTS11OEML) */
export interface EmailLogEntry {
  absEntry: number;
  /** A report, or a layout e-mailed from a document (reportName = the layout's name) */
  reportEntry: number | null;
  layoutEntry: number | null;
  reportName: string;
  source: 'Report' | 'Layout';
  /** The layout's document, e.g. Sales Order 1238 */
  docRef: string | null;
  paramValues: string | null;
  mailTo: string;
  mailCc: string | null;
  subject: string;
  fileName: string;
  status: 'SENT' | 'FAILED';
  errorDesc: string | null;
  sentBy: string;
  sentDate: string;
}

export interface ReportChoice {
  value: string | number | boolean | null;
  description: string | number | null;
}

// ============================================
// Approvals (FTS11WDD1)
// ============================================

/** A document waiting for my approval (Approvals list) */
export interface MyApproval {
  objType: string;
  objTypeName: string | null;
  docEntry: number;
  /** Empty: a document waiting for approval gets its No. once approved */
  docNum: string | null;
  cardCode: string;
  cardName: string | null;
  docDate: string;
  docTotal: number;
  /** Who confirmed it (sent it for approval), and when */
  sentBy: string | null;
  sentDate: string | null;
  wtmCode: string;
  wtmName: string;
  wstName: string;
  stageNo: number;
}

/** One approver's row of a document's approval (Approval tab) */
export interface DocumentApprovalRow {
  absEntry: number;
  /** Which time the document was sent for approval (1, 2, ...); only the latest counts */
  round: number;
  wtmCode: string;
  wtmName: string;
  stageNo: number;
  wstName: string;
  /** Approvals required at that stage */
  maxReqr: number;
  userName: string;
  displayName: string | null;
  /** PENDING / APPROVED / REJECTED */
  apprStatus: string;
  apprStatusName: string | null;
  remarks: string | null;
  actionDate: string | null;
}

export interface DocumentApprovals {
  rows: DocumentApprovalRow[];
  /** The logged-in user can approve / reject it now (their stage's turn) */
  canDecide: boolean;
  /** Changes approvers made while approving (Temporary Receipt), newest first */
  changes: DocumentApprovalChange[];
}

/** A change an approver made to a document while approving it (FTS11WDD2) */
export interface DocumentApprovalChange {
  absEntry: number;
  changeDate: string;
  remarks: string | null;
  userName: string;
  displayName: string | null;
}

/** Result of General Settings > Test Connection (DI API log-on) */
export interface DiApiTestResult {
  success: boolean;
  /** Connected: company name and SAP version. Failed: DI API's error code and message. */
  message: string;
  seconds: number;
}

export interface SaveGeneralSettingsDto {
  compnyName: string | null;
  attachPath: string | null;
  attachMaxSizeMB: number;
  sapServer: string | null;
  sapDbServerType: string | null;
  sapCompanyDB: string | null;
  sapUseTrusted: boolean;
  sapDbUserName: string | null;
  sapUserName: string | null;
  sapLicenseServer: string | null;
  sapSLDServer: string | null;
  /** New password, or null / empty to keep the saved one */
  sapDbPassword: string | null;
  sapPassword: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: string | null;
  smtpUserName: string | null;
  /** New password, or null / empty to keep the saved one */
  smtpPassword: string | null;
  smtpFromEmail: string | null;
  smtpFromName: string | null;
  apprEmail?: boolean;
  portalUrl?: string | null;
  payCashAcct?: string | null;
  payCheckAcct?: string | null;
  payCreditCard?: number | null;
  defaultPriceList?: number | null;
}

/** Send Test Email: sent (the mail server's answer) or failed (its error) */
export interface MailTestResult {
  success: boolean;
  message: string;
  seconds: number;
}

// ============================================
// Attachments (FTS11ATC1)
// ============================================

export interface Attachment {
  absEntry: number;
  objType: string;
  docEntry: number;
  /** Without the extension */
  fileName: string;
  fileExt: string | null;
  fileSize: number;
  freeText: string | null;
  /** Attached by / Attachment date */
  createdBy: string | null;
  createdDate: string | null;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}
