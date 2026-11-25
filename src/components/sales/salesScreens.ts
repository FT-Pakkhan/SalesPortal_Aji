import { creditMemosAPI, salesOrdersAPI, salesQuotationsAPI } from '@/lib/apiClient';
import type { SalesDocumentScreen } from './SalesDocumentDetail';

// The sales document screens. They share one detail view (SalesDocumentDetail) and one list view
// (SalesDocumentList); these settings are all that differ between them.

export const SALES_QUOTATION_SCREEN: SalesDocumentScreen = {
  objType: 'FTS11OQUT',
  title: 'Sales Quotation',
  listPath: '/sales-quotations',
  api: salesQuotationsAPI,
  copyTo: { title: 'Sales Order', listPath: '/sales-orders' },
  // Its customer may be an OPEN lead (as in SAP B1); Copy To Sales Order then needs the lead posted to SAP
  allowsLeads: true,
};

export const SALES_ORDER_SCREEN: SalesDocumentScreen = {
  objType: 'FTS11ORDR',
  title: 'Sales Order',
  listPath: '/sales-orders',
  api: salesOrdersAPI,
  copyFrom: 'Sales Quotation',
  // Posted to SAP B1 as a Sales Order
  postToSap: true,
  numAtCardLabel: 'Customer PO No.',
};

export const CREDIT_MEMO_SCREEN: SalesDocumentScreen = {
  objType: 'FTS11ORIN',
  title: 'Credit Memo',
  listPath: '/credit-memos',
  api: creditMemosAPI,
  // Posted to SAP B1 as an A/R Credit Memo; nothing stays open on it: no Close Doc / Close Line (Cancel Doc only),
  // and no documents linked to it (no Relationship Map)
  postToSap: true,
  noClose: true,
  // Cancel Doc hidden for now (user, 2026-11-15)
  noCancel: true,
  noRelationshipMap: true,
  noSalesType: true,
  noPaymentTerms: true,
  noCoa: true,
  // No Internal Remarks / T&C; its Remarks keeps the plain label
  noExtraRemarks: true,
  noDiscType: true,
  noBankInfo: true,
  noAddresses: true,
  // Only rebate items (SAP OITM.U_Rebate = 'Y') can be chosen
  rebateItemsOnly: true,
  // Not shown on its lines: Quantity stays 1, the Tax Code is the item's, Price after Discount is worked out
  hiddenLineFields: ['quantity', 'uomCode', 'isFoc', 'discPrcnt', 'price', 'vatGroup', 'vatPrcnt', 'moq', 'moqUom', 'salesQty', 'salesUom', 'salesPrice'],
  dueDateLabel: 'Due Date',
};
