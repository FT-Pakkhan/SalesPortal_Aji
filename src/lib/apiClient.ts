import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  LoginCompany,
  PortalUserDetail,
  CreateUserDto,
  UpdateUserDto,
  ChangePasswordDto,
  ApprovalStage,
  ApprovalStageDetail,
  SaveApprovalStageDto,
  ApprovalTemplate,
  ApprovalTemplateDetail,
  SaveApprovalTemplateDto,
  DocumentType,
  NumberingSeries,
  NumberingSeriesDetail,
  SaveNumberingSeriesDto,
  SapCustomer,
  SapContact,
  SapSalesEmployee,
  SapBranch,
  SapItem,
  SapTaxCode,
  SapUom,
  SapCurrencies,
  SapDiscountType,
  SapSellerBank,
  SapCustomerAddresses,
  SapWarehouse,
  SapItemUom,
  SapPriceList,
  SalesDocument,
  SalesDocumentDetail,
  SaveSalesDocumentDto,
  SalesType,
  Attachment,
  CopySourceLine,
  GeneralSettings,
  SaveGeneralSettingsDto,
  DiApiTestResult,
  MailTestResult,
  MyApproval,
  DocumentApprovals,
  PrintLayout,
  SavePrintLayoutDto,
  Lead,
  SaveLeadDto,
  CustomerConversion,
  SaveCustomerConversionDto,
  PayType,
  TemporaryReceipt,
  SaveTemporaryReceiptDto,
  ReceiptOpenItem,
  ApproverStage,
  InventoryTransfer,
  SaveInventoryTransferDto,
  SapStockItem,
  Role,
  RoleDetail,
  SaveRoleDto,
  SalesCheckIn,
  CheckInDto,
  GpsLocation,
  ServerType,
  ReportSetting,
  ReportSettingDetail,
  SaveReportSettingDto,
  RptParameter,
  MyReport,
  RunnableReport,
  ReportChoice,
  RelationshipMapData,
  NotificationSummary,
  PortalNotification,
  SapAddressLists,
  ReportEmailDraft,
  EmailPdfFields,
  EmailLogEntry,
  SapHouseBank,
  ReceiptRequest,
  SaveReceiptRequestDto,
  ReceiptRequestCopy,
  SapPaymentAccounts,
  DashboardData,
  DashboardWidgetData,
  DashboardWidgetSetting,
  DashboardWidgetSettingDetail,
  SaveDashboardWidgetDto,
} from '@/types';
import { useLoadingStore } from '@/stores/loadingStore';

const apiClient: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Header that marks a background call (e.g. the notification bell's 60-second check): no LOADING overlay, and it
 * doesn't count as the user changing something
 */
const SILENT = 'X-Portal-Silent';

/** Fired after the user changed something on the server (any successful call that isn't a GET): the bell checks */
export const PORTAL_CHANGED_EVENT = 'portal:changed';

// Request interceptor - add token, and count the request for the loading overlay
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (!config.headers[SILENT]) useLoadingStore.getState().start();
  return config;
});

// Response interceptor - end the loading count, handle auth errors
apiClient.interceptors.response.use(
  (response) => {
    if (!response.config.headers[SILENT]) {
      useLoadingStore.getState().finish();
      if (response.config.method && response.config.method !== 'get') window.dispatchEvent(new Event(PORTAL_CHANGED_EVENT));
    }
    return response.data;
  },
  (error: AxiosError) => {
    if (!error.config?.headers[SILENT]) useLoadingStore.getState().finish();
    if (error.response?.status === 401) {
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ============================================
// Auth API
// ============================================

export const authAPI = {
  login: (data: LoginRequest): Promise<ApiResponse<LoginResponse>> =>
    apiClient.post('/auth', data),
  // The Company drop-down (several companies); multiCompany false = one company, no drop-down
  getCompanies: (): Promise<ApiResponse<{ multiCompany: boolean; companies: LoginCompany[] }>> =>
    apiClient.get('/auth/companies'),
};

// ============================================
// Users API
// ============================================

export const usersAPI = {
  getList: (params?: { search?: string }): Promise<ApiResponse<PortalUserDetail[]>> =>
    apiClient.get('/users', { params }),

  create: (data: CreateUserDto): Promise<ApiResponse<PortalUserDetail>> =>
    apiClient.post('/users', data),

  getById: (id: number): Promise<ApiResponse<PortalUserDetail>> =>
    apiClient.get(`/users/${id}`),

  update: (id: number, data: UpdateUserDto): Promise<ApiResponse<PortalUserDetail>> =>
    apiClient.put(`/users/${id}`, data),

  changePassword: (id: number, data: ChangePasswordDto): Promise<ApiResponse<null>> =>
    apiClient.post(`/users/${id}/change-password`, data),

  /** Forgotten password: set a new one ('' = no password), and whether they must change it after signing in */
  resetPassword: (id: number, data: { newPassword: string; chgPwdOnLogon: boolean }): Promise<ApiResponse<PortalUserDetail>> =>
    apiClient.post(`/users/${id}/reset-password`, data),

  /** The approval stages the user approves in (warned about before deactivating them) */
  getApprovalStages: (id: number): Promise<ApiResponse<ApproverStage[]>> =>
    apiClient.get(`/users/${id}/approval-stages`),
};

// ============================================
// Approval Stages API
// ============================================

export const approvalStagesAPI = {
  getList: (): Promise<ApiResponse<ApprovalStage[]>> =>
    apiClient.get('/approval-stages'),

  getById: (id: number): Promise<ApiResponse<ApprovalStageDetail>> =>
    apiClient.get(`/approval-stages/${id}`),

  create: (data: SaveApprovalStageDto): Promise<ApiResponse<ApprovalStageDetail>> =>
    apiClient.post('/approval-stages', data),

  update: (id: number, data: SaveApprovalStageDto): Promise<ApiResponse<ApprovalStageDetail>> =>
    apiClient.put(`/approval-stages/${id}`, data),
};

// ============================================
// Approval Templates API
// ============================================

export const approvalTemplatesAPI = {
  getList: (): Promise<ApiResponse<ApprovalTemplate[]>> =>
    apiClient.get('/approval-templates'),

  getById: (id: number): Promise<ApiResponse<ApprovalTemplateDetail>> =>
    apiClient.get(`/approval-templates/${id}`),

  create: (data: SaveApprovalTemplateDto): Promise<ApiResponse<ApprovalTemplateDetail>> =>
    apiClient.post('/approval-templates', data),

  update: (id: number, data: SaveApprovalTemplateDto): Promise<ApiResponse<ApprovalTemplateDetail>> =>
    apiClient.put(`/approval-templates/${id}`, data),
};

// ============================================
// Document Types API (FTS_vw_ObjType)
// ============================================

export const documentTypesAPI = {
  getList: (): Promise<ApiResponse<DocumentType[]>> =>
    apiClient.get('/document-types'),
};

// ============================================
// Document Numbering API (FTS11NNM1 / FTS11NNM2)
// ============================================

/** Confirm's body: the No. keyed in for a manual series (nothing for an automatic one) */
const manualNoBody = (docNum?: string) => (docNum === undefined ? undefined : { docNum });

export const documentNumberingAPI = {
  /** With objType: only that document type's active series */
  getList: (objType?: string): Promise<ApiResponse<NumberingSeries[]>> =>
    apiClient.get('/document-numbering', { params: { objType } }),

  getById: (id: number): Promise<ApiResponse<NumberingSeriesDetail>> =>
    apiClient.get(`/document-numbering/${id}`),

  create: (data: SaveNumberingSeriesDto): Promise<ApiResponse<NumberingSeriesDetail>> =>
    apiClient.post('/document-numbering', data),

  update: (id: number, data: SaveNumberingSeriesDto): Promise<ApiResponse<NumberingSeriesDetail>> =>
    apiClient.put(`/document-numbering/${id}`, data),
};

// ============================================
// SAP B1 master data API (read only)
// ============================================

export const sapAPI = {
  getCustomers: (): Promise<ApiResponse<SapCustomer[]>> =>
    apiClient.get('/sap/customers'),

  getContacts: (cardCode: string): Promise<ApiResponse<SapContact[]>> =>
    apiClient.get(`/sap/customers/${encodeURIComponent(cardCode)}/contacts`),

  /** A customer's Bill To / Ship To addresses (SAP CRD1) and its default ones; none for a lead */
  getCustomerAddresses: (cardCode: string): Promise<ApiResponse<SapCustomerAddresses>> =>
    apiClient.get(`/sap/customers/${encodeURIComponent(cardCode)}/addresses`),

  getSalesEmployees: (): Promise<ApiResponse<SapSalesEmployee[]>> =>
    apiClient.get('/sap/sales-employees'),

  /** Branches: active SAP cost centres of Dimension 1 (OOCR) */
  getBranches: (): Promise<ApiResponse<SapBranch[]>> =>
    apiClient.get('/sap/branches'),

  /**
   * Sales items; with a customer, prices come from that customer's price list; rebateOnly: U_Rebate = 'Y' only (Credit
   * Memo); currency + date (YYYY-MM-DD): prices in the document's currency at SAP's rates that day
   */
  getItems: (cardCode?: string, rebateOnly?: boolean, currency?: string, date?: string): Promise<ApiResponse<SapItem[]>> =>
    apiClient.get('/sap/items', {
      params: { cardCode: cardCode || undefined, rebate: rebateOnly ? 'Y' : undefined, currency: currency || undefined, date: date || undefined },
    }),

  /** Discount Types: SAP's user table @DISCOUNTTYPE (none when the company has no such table) */
  getDiscountTypes: (): Promise<ApiResponse<SapDiscountType[]>> =>
    apiClient.get('/sap/discount-types'),

  /** SAP's Seller Banks (@SELLERBANK), for a sales document's Bank Info */
  getSellerBanks: (): Promise<ApiResponse<SapSellerBank[]>> =>
    apiClient.get('/sap/seller-banks'),

  /** SAP's currencies and the local currency; with a date (YYYY-MM-DD) also each one's rate that day */
  getCurrencies: (date?: string): Promise<ApiResponse<SapCurrencies>> =>
    apiClient.get('/sap/currencies', { params: { date: date || undefined } }),

  getTaxCodes: (): Promise<ApiResponse<SapTaxCode[]>> =>
    apiClient.get('/sap/tax-codes'),

  getWarehouses: (): Promise<ApiResponse<SapWarehouse[]>> =>
    apiClient.get('/sap/warehouses'),

  /** All SAP units of measure (OUOM), for a line's Sales UoM */
  getUoms: (): Promise<ApiResponse<SapUom[]>> =>
    apiClient.get('/sap/uoms'),

  getPriceLists: (): Promise<ApiResponse<SapPriceList[]>> =>
    apiClient.get('/sap/price-lists'),

  /** The units of these items' UoM Groups, priced for the customer (none for a Manual UoM item) */
  getItemUoms: (itemCodes: string[], cardCode?: string, currency?: string, date?: string): Promise<ApiResponse<SapItemUom[]>> =>
    apiClient.get('/sap/item-uoms', {
      params: { items: itemCodes.join(','), cardCode: cardCode || undefined, currency: currency || undefined, date: date || undefined },
    }),

  /** Countries, states and payment terms (a business partner's addresses and credit term) */
  getAddressLists: (): Promise<ApiResponse<SapAddressLists>> =>
    apiClient.get('/sap/address-lists'),

  /** The company's own bank accounts (house bank accounts, DSC1) */
  getHouseBanks: (): Promise<ApiResponse<SapHouseBank[]>> =>
    apiClient.get('/sap/house-banks'),

  /** Postable G/L accounts and credit cards (General Settings > Incoming Payment) */
  getPaymentAccounts: (): Promise<ApiResponse<SapPaymentAccounts>> =>
    apiClient.get('/sap/payment-accounts'),
};

// ============================================
// Sales documents API (Sales Quotation, Sales Order: same calls, own address)
// ============================================

/** The calls of one sales document type, e.g. salesDocumentAPI('/sales-orders') */
const salesDocumentAPI = (path: string) => ({
  getList: (): Promise<ApiResponse<SalesDocument[]>> =>
    apiClient.get(path),

  getById: (id: number): Promise<ApiResponse<SalesDocumentDetail>> =>
    apiClient.get(`${path}/${id}`),

  /** Saves as DRAFT */
  create: (data: SaveSalesDocumentDto): Promise<ApiResponse<SalesDocumentDetail>> =>
    apiClient.post(path, data),

  update: (id: number, data: SaveSalesDocumentDto): Promise<ApiResponse<SalesDocumentDetail>> =>
    apiClient.put(`${path}/${id}`, data),

  /** Assigns the No., status OPEN, locks the Posting Date; a Sales Order / Credit Memo is then posted to SAP (hence the timeout) */
  confirm: (id: number, docNum?: string): Promise<ApiResponse<SalesDocumentDetail>> =>
    apiClient.post(`${path}/${id}/confirm`, manualNoBody(docNum), { timeout: 150000 }),

  // Close / Cancel / Close Line: a sales order / credit memo posted to SAP is updated there too (DI API), hence the long timeout

  /** Close Doc: an OPEN document and its open lines become CLOSED */
  close: (id: number): Promise<ApiResponse<SalesDocumentDetail>> =>
    apiClient.post(`${path}/${id}/close`, undefined, { timeout: 150000 }),

  /** Cancel Doc: a DRAFT / OPEN document nothing was copied from becomes CANCELED */
  cancel: (id: number): Promise<ApiResponse<SalesDocumentDetail>> =>
    apiClient.post(`${path}/${id}/cancel`, undefined, { timeout: 150000 }),

  /** Close Line: those open lines (LineNum) become CLOSED */
  closeLines: (id: number, lineNums: number[]): Promise<ApiResponse<SalesDocumentDetail>> =>
    apiClient.post(`${path}/${id}/close-lines`, { lineNums }, { timeout: 150000 }),

  /** Copy From: open lines of OPEN source documents for a customer (only for documents that copy, e.g. Sales Order) */
  getCopySources: (cardCode: string): Promise<ApiResponse<CopySourceLine[]>> =>
    apiClient.get(`${path}/copy-from`, { params: { cardCode } }),

  /** Post to SAP through DI API (only documents that post, e.g. Sales Order); posted = false: SAP refused it, now FAILED */
  postToSap: (id: number): Promise<ApiResponse<{ posted: boolean; message: string; document: SalesDocumentDetail }>> =>
    apiClient.post(`${path}/${id}/post-to-sap`, undefined, { timeout: 150000 }),
});

export type SalesDocumentAPI = ReturnType<typeof salesDocumentAPI>;

// ============================================
// Leads API (FTS11LEAD)
// ============================================

export const leadsAPI = {
  getList: (): Promise<ApiResponse<Lead[]>> =>
    apiClient.get('/leads'),

  getById: (id: number): Promise<ApiResponse<Lead>> =>
    apiClient.get(`/leads/${id}`),

  create: (data: SaveLeadDto): Promise<ApiResponse<Lead>> =>
    apiClient.post('/leads', data),

  update: (id: number, data: SaveLeadDto): Promise<ApiResponse<Lead>> =>
    apiClient.put(`/leads/${id}`, data),

  /** Gives the Lead Code from its series, status OPEN */
  confirm: (id: number, docNum?: string): Promise<ApiResponse<Lead>> =>
    apiClient.post(`/leads/${id}/confirm`, manualNoBody(docNum)),
};

// ============================================
// Convert to Customer API (FTS11OCRD / FTS11CRD1)
// ============================================

export const customerConversionsAPI = {
  getList: (): Promise<ApiResponse<CustomerConversion[]>> =>
    apiClient.get('/customer-conversions'),

  getById: (id: number): Promise<ApiResponse<CustomerConversion>> =>
    apiClient.get(`/customer-conversions/${id}`),

  /** Saves as DRAFT */
  create: (data: SaveCustomerConversionDto): Promise<ApiResponse<CustomerConversion>> =>
    apiClient.post('/customer-conversions', data),

  update: (id: number, data: SaveCustomerConversionDto): Promise<ApiResponse<CustomerConversion>> =>
    apiClient.put(`/customer-conversions/${id}`, data),

  /** Form and BP code checked, then its No. and OPEN (posted to SAP straight away) — or sent for approval */
  confirm: (id: number): Promise<ApiResponse<CustomerConversion>> =>
    apiClient.post(`/customer-conversions/${id}/confirm`, undefined, { timeout: 150000 }),

  cancel: (id: number): Promise<ApiResponse<CustomerConversion>> =>
    apiClient.post(`/customer-conversions/${id}/cancel`),

  /** Post to SAP again after it FAILED; posted = false means SAP refused it (FAILED with the reason) */
  postToSap: (id: number): Promise<ApiResponse<{ posted: boolean; message: string; conversion: CustomerConversion }>> =>
    apiClient.post(`/customer-conversions/${id}/post-to-sap`, undefined, { timeout: 150000 }),

  /** Update Customer on a posted one: a new DRAFT filled from the customer's latest posted one (existing: one already on its way) */
  updateCustomer: (id: number): Promise<ApiResponse<{ docEntry: number; existing: boolean }>> =>
    apiClient.post(`/customer-conversions/${id}/update-customer`),
};

// ============================================
// Temporary Receipts API (FTS11TMPR)
// ============================================

export const temporaryReceiptsAPI = {
  getList: (): Promise<ApiResponse<TemporaryReceipt[]>> =>
    apiClient.get('/temporary-receipts'),

  getById: (id: number): Promise<ApiResponse<TemporaryReceipt>> =>
    apiClient.get(`/temporary-receipts/${id}`),

  /** Saves as DRAFT */
  create: (data: SaveTemporaryReceiptDto): Promise<ApiResponse<TemporaryReceipt>> =>
    apiClient.post('/temporary-receipts', data),

  update: (id: number, data: SaveTemporaryReceiptDto): Promise<ApiResponse<TemporaryReceipt>> =>
    apiClient.put(`/temporary-receipts/${id}`, data),

  /** Gives the No. from its series, status OPEN */
  confirm: (id: number, docNum?: string): Promise<ApiResponse<TemporaryReceipt>> =>
    apiClient.post(`/temporary-receipts/${id}/confirm`, manualNoBody(docNum), { timeout: 150000 }),

  /** The customer's open SAP items a receipt may pay; docEntry = the receipt being edited (its own lines stay) */
  /** currency + date (YYYY-MM-DD): the receipt's - items in it or the local currency, balances in it */
  getOpenItems: (cardCode: string, docEntry?: number, currency?: string, date?: string): Promise<ApiResponse<ReceiptOpenItem[]>> =>
    apiClient.get('/temporary-receipts/open-items', { params: { cardCode, docEntry, currency: currency || undefined, date: date || undefined } }),

  /** Cancel Doc: DRAFT / OPEN -> CANCELED; posted to SAP: the incoming payment is cancelled there too (hence the timeout) */
  cancel: (id: number): Promise<ApiResponse<TemporaryReceipt>> =>
    apiClient.post(`/temporary-receipts/${id}/cancel`, undefined, { timeout: 150000 }),

  /** Post to SAP as an Incoming Payment; posted = false means SAP refused it (FAILED with the reason) */
  postToSap: (id: number): Promise<ApiResponse<{ posted: boolean; message: string; receipt: TemporaryReceipt }>> =>
    apiClient.post(`/temporary-receipts/${id}/post-to-sap`, undefined, { timeout: 150000 }),
};

/** Temporary Receipt Requests (FTS11OTRQ / FTS11TRQ1): header + payment means, copied into Temporary Receipts */
export const receiptRequestsAPI = {
  getList: (): Promise<ApiResponse<ReceiptRequest[]>> =>
    apiClient.get('/receipt-requests'),

  getById: (id: number): Promise<ApiResponse<ReceiptRequest>> =>
    apiClient.get(`/receipt-requests/${id}`),

  /** Saves as DRAFT */
  create: (data: SaveReceiptRequestDto): Promise<ApiResponse<ReceiptRequest>> =>
    apiClient.post('/receipt-requests', data),

  update: (id: number, data: SaveReceiptRequestDto): Promise<ApiResponse<ReceiptRequest>> =>
    apiClient.put(`/receipt-requests/${id}`, data),

  /** Its No. and OPEN, or (approval needed) PENDING */
  confirm: (id: number, docNum?: string): Promise<ApiResponse<ReceiptRequest>> =>
    apiClient.post(`/receipt-requests/${id}/confirm`, manualNoBody(docNum)),

  /** Cancel Doc (not once copied into a receipt) */
  cancel: (id: number): Promise<ApiResponse<ReceiptRequest>> =>
    apiClient.post(`/receipt-requests/${id}/cancel`),

  /** Copy To Temporary Receipt: what is still left on it */
  getCopy: (id: number): Promise<ApiResponse<ReceiptRequestCopy>> =>
    apiClient.get(`/receipt-requests/${id}/copy`),
};

/** Inventory transfers (FTS11OWTR / FTS11WTR1) */
export const inventoryTransfersAPI = {
  getList: (): Promise<ApiResponse<InventoryTransfer[]>> =>
    apiClient.get('/inventory-transfers'),

  getById: (id: number): Promise<ApiResponse<InventoryTransfer>> =>
    apiClient.get(`/inventory-transfers/${id}`),

  /** Saves as DRAFT */
  create: (data: SaveInventoryTransferDto): Promise<ApiResponse<InventoryTransfer>> =>
    apiClient.post('/inventory-transfers', data),

  update: (id: number, data: SaveInventoryTransferDto): Promise<ApiResponse<InventoryTransfer>> =>
    apiClient.put(`/inventory-transfers/${id}`, data),

  /** Stock checked, then its No. and OPEN — or sent for approval */
  confirm: (id: number, docNum?: string): Promise<ApiResponse<InventoryTransfer>> =>
    apiClient.post(`/inventory-transfers/${id}/confirm`, manualNoBody(docNum), { timeout: 150000 }),

  cancel: (id: number): Promise<ApiResponse<InventoryTransfer>> =>
    apiClient.post(`/inventory-transfers/${id}/cancel`),

  /** Post to SAP as an Inventory Transfer Request; posted = false means SAP refused it (FAILED with the reason) */
  postToSap: (id: number): Promise<ApiResponse<{ posted: boolean; message: string; transfer: InventoryTransfer }>> =>
    apiClient.post(`/inventory-transfers/${id}/post-to-sap`, undefined, { timeout: 150000 }),

  /** Inventory items with their default warehouse (item's, else SAP's) and the stock there */
  getStockItems: (): Promise<ApiResponse<SapStockItem[]>> =>
    apiClient.get('/sap/stock-items'),
};

/** Roles (FTS11OROL): users and screen access */
export const rolesAPI = {
  getList: (): Promise<ApiResponse<Role[]>> =>
    apiClient.get('/roles'),

  getById: (id: number): Promise<ApiResponse<RoleDetail>> =>
    apiClient.get(`/roles/${id}`),

  create: (data: SaveRoleDto): Promise<ApiResponse<RoleDetail>> =>
    apiClient.post('/roles', data),

  update: (id: number, data: SaveRoleDto): Promise<ApiResponse<RoleDetail>> =>
    apiClient.put(`/roles/${id}`, data),

  /** What I may do (my roles): administrator, and access per screen */
  getMine: (): Promise<ApiResponse<{ isAdmin: boolean; screenList: { code: string; level: 'FULL' | 'READ' | 'NONE' }[] }>> =>
    apiClient.get('/my-access'),
};

/** Sales check-ins (FTS11SCIN): only my Sales Employee's (all, if I have none) */
export const salesCheckInsAPI = {
  getList: (): Promise<ApiResponse<SalesCheckIn[]>> =>
    apiClient.get('/sales-check-ins'),

  getById: (id: number): Promise<ApiResponse<SalesCheckIn>> =>
    apiClient.get(`/sales-check-ins/${id}`),

  /** Check In: a new OPEN visit with its No., the time and my location */
  checkIn: (data: CheckInDto): Promise<ApiResponse<SalesCheckIn>> =>
    apiClient.post('/sales-check-ins', data),

  /** Purpose / Remarks of my own visit */
  update: (id: number, data: { purpose: string; comments: string | null }): Promise<ApiResponse<SalesCheckIn>> =>
    apiClient.put(`/sales-check-ins/${id}`, data),

  /** Check Out: the time and my location, CLOSED */
  checkOut: (id: number, location: GpsLocation): Promise<ApiResponse<SalesCheckIn>> =>
    apiClient.post(`/sales-check-ins/${id}/check-out`, { location }),
};

/** Payment types (FTS_vw_PayTyp) */
export const payTypesAPI = {
  getList: (): Promise<ApiResponse<PayType[]>> =>
    apiClient.get('/pay-types'),
};

// ============================================
// Print Layouts API (FTS11SLYT; Crystal Reports)
// ============================================

export const printLayoutsAPI = {
  /** All layouts; with objDoc + activeOnly: what a document's Print button offers */
  getList: (objDoc?: string, activeOnly = false): Promise<ApiResponse<PrintLayout[]>> =>
    apiClient.get('/print-layouts', { params: { objDoc, active: activeOnly ? '1' : undefined } }),

  getById: (id: number): Promise<ApiResponse<PrintLayout>> =>
    apiClient.get(`/print-layouts/${id}`),

  create: (data: SavePrintLayoutDto): Promise<ApiResponse<PrintLayout>> =>
    apiClient.post('/print-layouts', data),

  update: (id: number, data: SavePrintLayoutDto): Promise<ApiResponse<PrintLayout>> =>
    apiClient.put(`/print-layouts/${id}`, data),

  /** The document printed with this layout, as a PDF (can take a while) */
  print: (id: number, objType: string, docEntry: number): Promise<Blob> =>
    apiClient.get(`/print-layouts/${id}/print`, { params: { objType, docEntry }, responseType: 'blob', timeout: 130000 }),

  /** The E-mail form for a document printed with this layout (the layout must allow e-mail) */
  getEmailDraft: (id: number, objType: string, docEntry: number): Promise<ApiResponse<ReportEmailDraft>> =>
    apiClient.post(`/print-layouts/${id}/email-draft`, { objType, docEntry }),

  /** Print the document again with this layout and e-mail the PDF (logged); sent = false: the mail server refused it */
  sendEmail: (
    id: number,
    data: { objType: string; docEntry: number } & EmailPdfFields
  ): Promise<ApiResponse<{ sent: boolean; message: string }>> =>
    apiClient.post(`/print-layouts/${id}/email`, data, { timeout: 180000 }),
};

/** Portal notifications (FTS11ONTF, the bell) */
export const notificationsAPI = {
  /** Unread count and the newest one's time: the bell's background check (no LOADING overlay) */
  getSummary: (): Promise<ApiResponse<NotificationSummary>> =>
    apiClient.get('/notifications', { params: { summary: '1' }, headers: { [SILENT]: '1' } }),

  /** Newest first; the bell shows 20, View all more */
  getList: (limit = 20, silent = false): Promise<ApiResponse<PortalNotification[]>> =>
    apiClient.get('/notifications', { params: { limit }, headers: silent ? { [SILENT]: '1' } : {} }),

  /** Mark these read, or all of mine */
  markRead: (ids: number[] | 'ALL'): Promise<ApiResponse<null>> =>
    apiClient.post('/notifications', ids === 'ALL' ? { all: true } : { ids }, { headers: { [SILENT]: '1' } }),
};

/** Relationship Map: documents linked by Copy From / Copy To */
export const relationshipMapAPI = {
  get: (objType: string, docEntry: number): Promise<ApiResponse<RelationshipMapData>> =>
    apiClient.get('/relationship-map', { params: { objType, docEntry } }),
};

// ============================================
// Report Settings API (FTS11SRPT; Crystal Reports with parameters and roles)
// ============================================

export const reportSettingsAPI = {
  getList: (): Promise<ApiResponse<ReportSetting[]>> =>
    apiClient.get('/report-settings'),

  getById: (id: number): Promise<ApiResponse<ReportSettingDetail>> =>
    apiClient.get(`/report-settings/${id}`),

  create: (data: SaveReportSettingDto): Promise<ApiResponse<ReportSettingDetail>> =>
    apiClient.post('/report-settings', data),

  update: (id: number, data: SaveReportSettingDto): Promise<ApiResponse<ReportSettingDetail>> =>
    apiClient.put(`/report-settings/${id}`, data),

  /** The parameters found in a .rpt file on the server */
  readParameters: (reportPath: string): Promise<ApiResponse<RptParameter[]>> =>
    apiClient.post('/report-settings/read-parameters', { reportPath }, { timeout: 130000 }),

  /**
   * Run a choose-from-list query (rolled back) and see what it returns; useSapConn = in the SAP company database
   * (as the report's Use SAP DB Connection), else the portal database
   */
  testQuery: (query: string, useSapConn: boolean): Promise<ApiResponse<{ columnList: { name: string }[]; rowList: { cells: unknown[] }[] }>> =>
    apiClient.post('/report-settings/test-query', { query, useSapConn }),
};

// ============================================
// Dashboard: My Work tiles and the widgets of the user's roles; Dashboard Settings (the widgets set up)
// ============================================

export const dashboardAPI = {
  /** My Work tiles and the widget definitions */
  get: (): Promise<ApiResponse<DashboardData>> =>
    apiClient.get('/dashboard'),

  /** One widget's data; loaded per widget in the background (no LOADING overlay) */
  getWidgetData: (id: number): Promise<ApiResponse<DashboardWidgetData>> =>
    apiClient.get(`/dashboard/widgets/${id}`, { headers: { [SILENT]: '1' }, timeout: 60000 }),
};

export const dashboardSettingsAPI = {
  getList: (): Promise<ApiResponse<DashboardWidgetSetting[]>> =>
    apiClient.get('/dashboard-settings'),

  getById: (id: number): Promise<ApiResponse<DashboardWidgetSettingDetail>> =>
    apiClient.get(`/dashboard-settings/${id}`),

  create: (data: SaveDashboardWidgetDto): Promise<ApiResponse<DashboardWidgetSettingDetail>> =>
    apiClient.post('/dashboard-settings', data),

  update: (id: number, data: SaveDashboardWidgetDto): Promise<ApiResponse<DashboardWidgetSettingDetail>> =>
    apiClient.put(`/dashboard-settings/${id}`, data),

  /** Run the query as typed, with my @variables (rolled back): what the widget would show */
  testQuery: (query: string, widgetType: string, useSapConn: boolean): Promise<ApiResponse<DashboardWidgetData>> =>
    apiClient.post('/dashboard-settings/test-query', { query, widgetType, useSapConn }),
};

// ============================================
// Reports API (the Reports module: reports the user may run)
// ============================================

export const reportsAPI = {
  getList: (): Promise<ApiResponse<MyReport[]>> =>
    apiClient.get('/reports'),

  getById: (id: number): Promise<ApiResponse<RunnableReport>> =>
    apiClient.get(`/reports/${id}`),

  /** Choices of a Choose from List parameter (its query's 1st / 2nd columns) */
  getChoices: (id: number, lineNum: number): Promise<ApiResponse<ReportChoice[]>> =>
    apiClient.get(`/reports/${id}/choices`, { params: { line: lineNum } }),

  /** The report run with these values, as a PDF (can take a while) */
  run: (id: number, values: Record<string, unknown>): Promise<Blob> =>
    apiClient.post(`/reports/${id}/run`, { values }, { responseType: 'blob', timeout: 130000 }),

  /** The E-mail form, filled in from the report's E-mail tab for these values */
  getEmailDraft: (id: number, values: Record<string, unknown>): Promise<ApiResponse<ReportEmailDraft>> =>
    apiClient.post(`/reports/${id}/email-draft`, { values }),

  /** Run the report again with these values and e-mail the PDF (logged); sent = false: the mail server refused it */
  sendEmail: (
    id: number,
    data: { values: Record<string, unknown> } & EmailPdfFields
  ): Promise<ApiResponse<{ sent: boolean; message: string }>> =>
    apiClient.post(`/reports/${id}/email`, data, { timeout: 180000 }),
};

/** Reports e-mailed from the portal */
export const emailLogAPI = {
  getList: (): Promise<ApiResponse<EmailLogEntry[]>> =>
    apiClient.get('/email-log'),
};

// ============================================
// Approvals API (FTS11WDD1)
// ============================================

export const approvalsAPI = {
  /** Documents waiting for my approval (my stage's turn) */
  getMine: (): Promise<ApiResponse<MyApproval[]>> =>
    apiClient.get('/approvals'),

  /** A document's approval rows, and whether I can approve / reject it now */
  getForDocument: (objType: string, docEntry: number): Promise<ApiResponse<DocumentApprovals>> =>
    apiClient.get(`/approvals/${objType}/${docEntry}`),

  /** Approve or Reject; answers with the document as it is afterwards (a sales document, Lead or Temporary Receipt) */
  decide: <T = SalesDocumentDetail>(
    objType: string,
    docEntry: number,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null
  ): Promise<ApiResponse<T>> =>
    apiClient.post(`/approvals/${objType}/${docEntry}`, { decision, remarks }, { timeout: 150000 }),
};

/** Sales Types (FTS_vw_SalesTyp) — the Sales Type drop-down of every sales document */
export const salesTypesAPI = {
  getList: (): Promise<ApiResponse<SalesType[]>> =>
    apiClient.get('/sales-types'),
};

export const salesQuotationsAPI = salesDocumentAPI('/sales-quotations');
export const salesOrdersAPI = salesDocumentAPI('/sales-orders');
export const creditMemosAPI = salesDocumentAPI('/credit-memos');

// ============================================
// General Settings API (FTS11OADM)
// ============================================

export const generalSettingsAPI = {
  /** null until the settings have been saved once */
  get: (): Promise<ApiResponse<GeneralSettings | null>> =>
    apiClient.get('/general-settings'),

  save: (data: SaveGeneralSettingsDto): Promise<ApiResponse<GeneralSettings>> =>
    apiClient.put('/general-settings', data),

  getServerTypes: (): Promise<ApiResponse<ServerType[]>> =>
    apiClient.get('/server-types'),

  /** Log on to SAP through DI API with these settings (empty passwords = the saved ones). Can take up to 90 s. */
  testConnection: (data: Partial<SaveGeneralSettingsDto>): Promise<ApiResponse<DiApiTestResult>> =>
    apiClient.post('/general-settings/test-connection', data, { timeout: 100000 }),

  /** Send a test e-mail to `to` with these SMTP settings (empty password = the saved one) */
  testEmail: (data: Partial<SaveGeneralSettingsDto> & { to: string }): Promise<ApiResponse<MailTestResult>> =>
    apiClient.post('/general-settings/test-email', data, { timeout: 90000 }),
};

// ============================================
// Attachments API (FTS11ATC1; files are kept in the attachment folder)
// ============================================

export const attachmentsAPI = {
  getList: (objType: string, docEntry: number): Promise<ApiResponse<Attachment[]>> =>
    apiClient.get('/attachments', { params: { objType, docEntry } }),

  add: (objType: string, docEntry: number, file: File, freeText: string | null): Promise<ApiResponse<Attachment>> => {
    const form = new FormData();
    form.append('objType', objType);
    form.append('docEntry', String(docEntry));
    form.append('file', file);
    if (freeText) form.append('freeText', freeText);
    // Overrides the JSON default so the file goes as a real upload
    return apiClient.post('/attachments', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
  },

  /** The file's contents */
  download: (absEntry: number): Promise<Blob> =>
    apiClient.get(`/attachments/${absEntry}`, { responseType: 'blob', timeout: 120000 }),

  updateText: (absEntry: number, freeText: string | null): Promise<ApiResponse<Attachment>> =>
    apiClient.put(`/attachments/${absEntry}`, { freeText }),

  remove: (absEntry: number): Promise<ApiResponse<null>> =>
    apiClient.delete(`/attachments/${absEntry}`),
};

export default apiClient;
