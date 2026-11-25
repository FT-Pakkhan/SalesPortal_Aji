'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { App, Button, DatePicker, Form, Input, InputNumber, Select, Tabs } from 'antd';
import {
  SaveOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  FileAddOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  StopOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  LikeOutlined,
  DislikeOutlined,
  PrinterOutlined,
  CloudUploadOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import { RelationshipMap } from './RelationshipMap';
import { ApprovalTab } from './ApprovalTab';
import type { CellValueChangedEvent, ColDef, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import dayjs, { type Dayjs } from 'dayjs';
import { approvalsAPI, documentNumberingAPI, leadsAPI, salesTypesAPI, sapAPI, usersAPI } from '@/lib/apiClient';
import { branchLabel, branchWarehouse, warehouseLabel } from '@/lib/branch';
import { buildAddressText } from '@/lib/addressText';
import { deliveryZoneLabel } from './ConversionAddressDetail';
import { usePrintDocument } from '@/components/ui/usePrintDocument';
import { MANUAL_NO_MAX, useConfirmPrompt } from '@/components/ui/useConfirmPrompt';
import { isDocumentEditable, isSynced } from '@/lib/postStatus';
import { useAuthStore } from '@/stores/authStore';
import { useCanChange } from '@/stores/accessStore';
import type { SalesDocumentAPI } from '@/lib/apiClient';
import { DetailView, DisplayText, ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { LookupListView } from '@/components/ui/LookupListView';
import { DataGrid } from '@/components/ui/DataGrid';
import type { DataGridHandle } from '@/components/ui/DataGrid';
import { AttachmentsTab } from '@/components/ui/AttachmentsTab';
import type { AttachmentsTabHandle } from '@/components/ui/AttachmentsTab';
import DocumentLineDetail, { itemLookupColumns, lineWithItem, type HiddenLineField } from '@/components/sales/DocumentLineDetail';
import {
  EXPORT_PRICE_FIELDS,
  SALES_TYPE_EXPORT,
  calcDocTotals,
  lineWithUom,
  recalcLine,
  renumberLines,
  setFoc,
  withExportPrice,
} from '@/lib/documentLines';
import type { LineChange } from '@/lib/documentLines';
import type {
  CopySourceLine,
  NumberingSeries,
  SalesDocumentDetail as DocumentDetail,
  SalesDocumentLine,
  SalesType,
  SaveSalesDocumentDto,
  SapContact,
  SapBranch,
  SapCurrencies,
  SapCustomer,
  SapDiscountType,
  SapSellerBank,
  SapCustomerAddresses,
  SapCustomerAddress,
  SapAddressLists,
  SapItem,
  SapSalesEmployee,
  SapTaxCode,
  SapUom,
  SapWarehouse,
  SapItemUom,
} from '@/types';

/** Date format on screen, as in SAP B1 (e.g. 12.08.26) */
export const DOC_DATE_FORMAT = 'DD.MM.YY';

/** What makes one sales document screen different from another (everything else is shared) */
export interface SalesDocumentScreen {
  /** Document type (FTS_vw_ObjType.Code); its numbering series and attachments are listed by it */
  objType: string;
  /** e.g. "Sales Quotation" — the title and messages */
  title: string;
  /** List view address, e.g. /sales-quotations */
  listPath: string;
  api: SalesDocumentAPI;
  /** Copy From: the document its lines can be copied from (e.g. "Sales Quotation" for a Sales Order); none = no Copy From */
  copyFrom?: string;
  /** Copy To: the document an OPEN one can be copied into (e.g. a Sales Quotation to a Sales Order) */
  copyTo?: { title: string; listPath: string };
  /** The customer may also be an OPEN lead (Sales Quotation, as in SAP B1) */
  allowsLeads?: boolean;
  /** Post to SAP: an OPEN document can be posted to SAP B1 as the same document (Sales Order, Credit Memo) */
  postToSap?: boolean;
  /** No Close Doc / Close Line: nothing stays open on it (Credit Memo: Cancel Doc only) */
  noClose?: boolean;
  /** No Cancel Doc button (Credit Memo, for now) */
  noCancel?: boolean;
  /** No Relationship Map: it is never copied from or to (Credit Memo) */
  noRelationshipMap?: boolean;
  /** No Sales Type field (Credit Memo) */
  noSalesType?: boolean;
  /** No Payment Terms field (Credit Memo) */
  noPaymentTerms?: boolean;
  /** No COA field (Credit Memo) */
  noCoa?: boolean;
  /** No Internal Remarks / T&C fields, and Remarks keeps its plain label (Credit Memo) */
  noExtraRemarks?: boolean;
  /** No Discount Type (SAP @DISCOUNTTYPE) on its header — the Credit Memo */
  noDiscType?: boolean;
  /** No Bank Info (Credit Memo) */
  noBankInfo?: boolean;
  /** No Delivery tab (Bill To / Ship To) — the Credit Memo */
  noAddresses?: boolean;
  /** Its lines can only have rebate items, SAP OITM.U_Rebate = 'Y' (Credit Memo) */
  rebateItemsOnly?: boolean;
  /** Line fields not shown in the Details grid or the line popup; they keep their defaults (Credit Memo) */
  hiddenLineFields?: HiddenLineField[];
  /** The label of DocDueDate, as in SAP B1 (default "Delivery Date"; "Due Date" on a Credit Memo) */
  dueDateLabel?: string;
  /** The label of NumAtCard (default "Customer Ref. No."; "Customer PO No." on a Sales Order) */
  numAtCardLabel?: string;
}

/** COA drop-down: SAP U_COA valid values */
const COA_OPTIONS = [
  { value: 'Y', label: 'Yes' },
  { value: 'N', label: 'No' },
];

/** Approval statuses a document can be posted to SAP with */
const POSTABLE_APPR_STATUSES = ['NO-APPROVAL', 'APPROVED'];

/**
 * Handed from a document's Copy To button to the new target document (kept in the browser session for that one step):
 * the source document, the lines to copy, and the header fields to start the new document with.
 */
interface PendingCopy {
  baseType: string;
  baseEntry: number;
  baseRef: string | null;
  lineNums: number[];
  header: {
    salesTyp: string | null;
    cardCode: string;
    cardName: string | null;
    cntctCode: number | null;
    slpCode: number | null;
    numAtCard: string | null;
    groupNum: number | null;
    coa?: string | null;
    branch?: string | null;
    /** The source's currency: the copied lines' prices are in it */
    docCur?: string | null;
    discType1?: string | null;
    discType2?: string | null;
    discType3?: string | null;
    discType4?: string | null;
    discType5?: string | null;
    bankInfo?: string | null;
    /** Bill To / Ship To; left out when the source was for a lead (the customer's own defaults are used then) */
    payToCode?: string | null;
    shipToCode?: string | null;
    address?: string | null;
    address2?: string | null;
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
    inComments?: string | null;
    tac?: string | null;
  };
  sourceTitle: string;
}

const PENDING_COPY_KEY = 'pendingCopyTo';

/** Document statuses (FTS_vw_DocStatus.Code) */
const STATUS_DRAFT = 'DRAFT';
const STATUS_OPEN = 'OPEN';
/** Approval status (FTS_vw_ApprStatus.Code) of a document waiting for approval */
const APPR_STATUS_PENDING = 'PENDING';
/** Line status (FTS_vw_LineStatus.Code) of a line that can still be copied */
const LINE_STATUS_OPEN = 'OPEN';

interface SalesDocumentDetailProps {
  /** Which sales document this screen is (Sales Quotation, Sales Order, ...) */
  config: SalesDocumentScreen;
  /** Omit to create a new document */
  docEntry?: number;
  /** Open an existing document directly in edit mode (list view's Edit button) */
  startInEdit?: boolean;
}

interface DocumentFormValues {
  series: number | null;
  /** Typed only on a manual series (draft) */
  docNum: string;
  salesTyp: string | null;
  cardCode: string;
  cardName: string;
  cntctCode: number | null;
  numAtCard: string;
  groupNum: number | null;
  coa: string | null;
  branch: string | null;
  comments: string;
  inComments: string;
  tac: string;
  docDate: Dayjs | null;
  docDueDate: Dayjs | null;
  taxDate: Dayjs | null;
  slpCode: number | null;
  /** Document currency (SAP OCRN) */
  docCur: string | null;
  /** Discount Type 1 .. 5 (SAP @DISCOUNTTYPE Codes, each one at most once) */
  discType1: string | null;
  discType2: string | null;
  discType3: string | null;
  discType4: string | null;
  discType5: string | null;
  /** Bank Info (SAP @SELLERBANK Code) */
  bankInfo: string | null;
  /** Delivery tab: Bill To / Ship To address names (SAP CRD1) and their text */
  payToCode: string | null;
  shipToCode: string | null;
  address: string;
  address2: string;
  /** Bill To / Ship To Address Line 1 .. 4 (SAP Street / StreetNo / Block / City) and Delivery Zone */
  billStreet: string | null;
  billStreetNo: string | null;
  billBlock: string | null;
  billCity: string | null;
  billDeliveryZone: string | null;
  shipStreet: string | null;
  shipStreetNo: string | null;
  shipBlock: string | null;
  shipCity: string | null;
  shipDeliveryZone: string | null;
}

const toFormValues = (q: DocumentDetail): DocumentFormValues => ({
  series: q.series,
  docNum: q.docNum ?? '',
  salesTyp: q.salesTyp,
  cardCode: q.cardCode,
  cardName: q.cardName || '',
  cntctCode: q.cntctCode,
  numAtCard: q.numAtCard || '',
  groupNum: q.groupNum,
  coa: q.coa ?? null,
  branch: q.branch ?? null,
  comments: q.comments || '',
  inComments: q.inComments || '',
  tac: q.tac || '',
  docDate: q.docDate ? dayjs(q.docDate) : null,
  docDueDate: q.docDueDate ? dayjs(q.docDueDate) : null,
  taxDate: q.taxDate ? dayjs(q.taxDate) : null,
  slpCode: q.slpCode,
  docCur: q.docCur ?? null,
  discType1: q.discType1 ?? null,
  discType2: q.discType2 ?? null,
  discType3: q.discType3 ?? null,
  discType4: q.discType4 ?? null,
  discType5: q.discType5 ?? null,
  bankInfo: q.bankInfo ?? null,
  payToCode: q.payToCode ?? null,
  shipToCode: q.shipToCode ?? null,
  address: q.address ?? '',
  address2: q.address2 ?? '',
  billStreet: q.billStreet ?? null,
  billStreetNo: q.billStreetNo ?? null,
  billBlock: q.billBlock ?? null,
  billCity: q.billCity ?? null,
  billDeliveryZone: q.billDeliveryZone ?? null,
  shipStreet: q.shipStreet ?? null,
  shipStreetNo: q.shipStreetNo ?? null,
  shipBlock: q.shipBlock ?? null,
  shipCity: q.shipCity ?? null,
  shipDeliveryZone: q.shipDeliveryZone ?? null,
});

/** Number shown with 2 decimals and thousands separators, e.g. 1,250.00 */
const formatAmount = (p: ValueFormatterParams<SalesDocumentLine, number | null>) =>
  p.value === null || p.value === undefined
    ? ''
    : Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const amountColumn = (field: keyof SalesDocumentLine, headerName: string, editable: ColDef<SalesDocumentLine>['editable'] = false): ColDef<SalesDocumentLine> => ({
  field,
  headerName,
  cellDataType: 'number',
  valueFormatter: formatAmount,
  editable,
});

/** Small icon button in a grid row (the row's edit buttons) */
const rowButton = (title: string, icon: React.ReactNode, onClick: () => void) => (
  <Button type="text" size="small" icon={icon} title={title} onClick={onClick} />
);

const buttonColumn = (colId: string, cellRenderer: ColDef<SalesDocumentLine>['cellRenderer']): ColDef<SalesDocumentLine> => ({
  colId,
  headerName: '',
  // Narrow, so the checkbox and the two row buttons sit close together
  width: 30,
  sortable: false,
  resizable: false,
  filter: false,
  suppressAutoSize: true,
  cellStyle: { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cellRenderer,
});

/**
 * Columns of the Details tab, in SAP B1's order.
 * In edit mode the values are changed right in the row (one click on a cell starts editing it);
 * the button on each row opens the line in a popup detail view.
 */
const buildLineColumns = (options: {
  editing: boolean;
  taxCodes: SapTaxCode[];
  warehouses: SapWarehouse[];
  /** SAP's units of measure, for Export UoM */
  salesUoms: SapUom[];
  /** The units of an item's UoM Group (none: a Manual UoM item, or not loaded yet) */
  getUoms: (itemCode: string) => SapItemUom[] | undefined;
  /** Header of the line Total column: "Total (LC)", or "Total (USD)" on a foreign-currency document */
  totalLabel: string;
  onOpenLine: (line: SalesDocumentLine) => void;
  hidden?: HiddenLineField[];
}): ColDef<SalesDocumentLine>[] => {
  const { editing, taxCodes, warehouses, salesUoms, getUoms, onOpenLine, hidden = [], totalLabel } = options;
  // Price cells: editable in edit mode, except on a FOC line
  const priceEditable = (p: { data?: SalesDocumentLine }) => editing && !p.data?.isFoc;
  // The row button is only for edit mode; in view mode clicking a line opens it (onOpenRecord)
  const rowButtons: ColDef<SalesDocumentLine>[] = editing
    ? [
        buttonColumn('openLine', (p: ICellRendererParams<SalesDocumentLine>) =>
          p.data ? rowButton('Edit line', <EditOutlined />, () => onOpenLine(p.data as SalesDocumentLine)) : null
        ),
      ]
    : [];
  const columns: ColDef<SalesDocumentLine>[] = [
    ...rowButtons,
    // Line # (position, VisOrder + 1): narrow, no sort / filter icons — the lines are already in their order
    {
      colId: 'lineNo',
      headerName: '#',
      valueGetter: (p) => (p.data ? (p.data.visOrder ?? p.node?.rowIndex ?? 0) + 1 : null),
      cellDataType: 'number',
      width: 44,
      sortable: false,
      filter: false,
      resizable: false,
      suppressAutoSize: true,
    },
    {
      field: 'itemCode',
      headerName: 'Item No.',
      // Edit mode: clicking the cell opens Choose Item to change the item (handled in onCellClicked).
      // A line copied from another document keeps its item (as in SAP B1), so it gets no search icon.
      context: { editableLook: (p: { data?: SalesDocumentLine }) => editing && p.data?.baseEntry == null },
      cellRenderer: editing
        ? (p: ICellRendererParams<SalesDocumentLine>) =>
            p.data?.baseEntry != null ? (
              p.value
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Click to change the item">
                {p.value}
                <SearchOutlined style={{ color: '#6A6D70' }} />
              </span>
            )
        : undefined,
    },
    { field: 'dscription', headerName: 'Item Description', editable: editing },
    amountColumn('quantity', 'Quantity', editing),
    {
      field: 'uomCode',
      headerName: 'UoM Code',
      // A UoM Group item: one of its group's units (the price follows); a Manual UoM item: typed.
      // A line copied from another document keeps its unit (as in SAP B1): its open quantity is in that unit.
      editable: (p) => editing && p.data?.baseEntry == null,
      cellEditorSelector: (p) => {
        const uoms = p.data ? getUoms(p.data.itemCode) : undefined;
        return uoms && uoms.length > 0 ? { component: 'agSelectCellEditor', params: { values: uoms.map((u) => u.uomCode) } } : undefined;
      },
    },
    // Export Qty / Export UoM (an SAP unit) / Export Unit Price: Sales Type EXPORT only, posted to SAP's line UDFs
    // U_SalesQty / U_SalesUoM / U_SalesPrice; the Unit Price is worked out from them (still editable)
    amountColumn('salesQty', 'Export Qty', editing),
    {
      field: 'salesUom',
      headerName: 'Export UoM',
      editable: editing,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: ['', ...salesUoms.map((u) => u.uomCode)] },
    },
    amountColumn('salesPrice', 'Export Unit Price', editing),
    // The item's Sales MOQ from the SAP item master: shown, never typed
    amountColumn('moq', 'MOQ'),
    { field: 'moqUom', headerName: 'MOQ UoM' },
    // Free of charge: Unit Price 0; its price cells are locked while ticked
    { field: 'isFoc', headerName: 'FOC', cellDataType: 'boolean', editable: editing, width: 70 },
    amountColumn('priceBefDi', 'Unit Price', priceEditable),
    amountColumn('discPrcnt', 'Discount %', priceEditable),
    amountColumn('price', 'Price after Discount', priceEditable),
    {
      field: 'vatGroup',
      headerName: 'Tax Code',
      editable: editing,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: { values: ['', ...taxCodes.map((t) => t.code)] },
    },
    amountColumn('vatPrcnt', 'Tax %'),
    amountColumn('lineTotal', totalLabel),
    {
      field: 'whsCode',
      headerName: 'Warehouse',
      minWidth: 190,
      editable: editing,
      cellEditor: 'agSelectCellEditor',
      // Code and name in the list and the cell; the line keeps the code
      valueFormatter: (p) => {
        const w = warehouses.find((x) => x.whsCode === p.value);
        return w ? warehouseLabel(w) : p.value ?? '';
      },
      cellEditorParams: {
        values: ['', ...warehouses.map((w) => w.whsCode)],
        formatValue: (code: string) => {
          const w = warehouses.find((x) => x.whsCode === code);
          return w ? warehouseLabel(w) : code ?? '';
        },
      },
    },
    { field: 'text', headerName: 'Item Details', editable: editing, cellEditor: 'agLargeTextCellEditor', cellEditorPopup: true },
    // Set by the server (copying, Close Line, Close / Cancel Doc); a new line is OPEN once saved
    { field: 'lineStatus', headerName: 'Line Status' },
  ];
  return columns.filter((c) => !hidden.includes(c.field as HiddenLineField));
};

/** A source line's key in the Copy From list */
const copyKey = (baseType: string, baseEntry: number, baseLine: number) => `${baseType}|${baseEntry}|${baseLine}`;

/** Columns of the Copy From list: which source document and line, and what is still open on it */
const copySourceColumns = (sourceTitle: string): ColDef<CopySourceLine>[] => [
  { field: 'baseRef', headerName: `${sourceTitle} No.`, sort: 'asc' },
  {
    colId: 'docDate',
    headerName: 'Posting Date',
    valueGetter: (p) => (p.data?.docDate ? dayjs(p.data.docDate).format(DOC_DATE_FORMAT) : ''),
  },
  { colId: 'line', headerName: '#', valueGetter: (p) => (p.data ? (p.data.baseVisOrder ?? p.data.baseLine) + 1 : null), cellDataType: 'number' },
  { field: 'itemCode', headerName: 'Item No.' },
  { field: 'dscription', headerName: 'Item Description' },
  { field: 'openQty', headerName: 'Open Qty', cellDataType: 'number' },
  { field: 'isFoc', headerName: 'FOC', cellDataType: 'boolean' },
  { field: 'priceBefDi', headerName: 'Unit Price', cellDataType: 'number' },
  { field: 'discPrcnt', headerName: 'Discount %', cellDataType: 'number' },
];

/** Which recalculation a changed grid cell needs */
const changeForField = (field: string | undefined): LineChange =>
  field === 'quantity' || field === 'priceBefDi' || field === 'discPrcnt' || field === 'price' ? field : 'other';

/** The header's Discount Type 1 .. 5 fields */
const DISC_TYPE_FIELDS = ['discType1', 'discType2', 'discType3', 'discType4', 'discType5'] as const;

let newLineCounter = 0;
/** Empty line for New: today's defaults, no item yet */
const emptyLine = (): SalesDocumentLine => ({
  rowKey: `new-${++newLineCounter}`,
  lineNum: -1,
  itemCode: '',
  dscription: null,
  quantity: 1,
  uomCode: null,
  priceBefDi: 0,
  discPrcnt: 0,
  price: 0,
  vatGroup: null,
  vatPrcnt: null,
  lineTotal: 0,
  whsCode: null,
  text: null,
});

const customerLookupColumns: ColDef<SapCustomer>[] = [
  { field: 'cardCode', headerName: 'Customer Code', width: 180, sort: 'asc' },
  { field: 'cardName', headerName: 'Customer Name', flex: 1, minWidth: 220 },
];

/** With leads in the list: a Type column says which is which */
const customerAndLeadColumns: ColDef<SapCustomer>[] = [
  ...customerLookupColumns,
  { field: 'cardType', headerName: 'Type', width: 110 },
];

/** Customers to choose from: SAP customers, and for a quotation also the OPEN leads (no SAP defaults but their Credit Term) */
const loadCustomers = async (withLeads: boolean): Promise<SapCustomer[]> => {
  const [customers, leads] = await Promise.all([
    sapAPI.getCustomers(),
    withLeads ? leadsAPI.getList() : Promise.resolve(null),
  ]);
  const list: SapCustomer[] = customers.success ? customers.data.map((c) => ({ ...c, cardType: 'Customer' })) : [];
  if (leads?.success) {
    for (const lead of leads.data) {
      if (lead.docStatus === 'OPEN' && lead.leadCode) {
        list.push({
          cardCode: lead.leadCode,
          cardName: lead.leadName,
          cntctPrsn: null,
          slpCode: null,
          groupNum: lead.groupNum,
          custType: null,
          cardType: 'Lead',
          // A quotation for a lead is in the lead's currency
          currency: lead.currency ?? null,
        });
      }
    }
  }
  return list;
};

/** Lines from the server (in VisOrder order) get a screen key so rows stay stable while editing */
const withRowKeys = (lines: SalesDocumentLine[]): SalesDocumentLine[] =>
  lines.map((line, index) => ({ ...line, rowKey: `line-${line.lineNum}`, visOrder: index }));

/** Screen date -> 'YYYY-MM-DD' for the API */
const apiDate = (value: Dayjs | null) => (value ? value.format('YYYY-MM-DD') : null);

/** Original LineNum of a loaded line (its rowKey is line-N); null for a line added on screen */
const origLineNum = (line: SalesDocumentLine) =>
  line.rowKey?.startsWith('line-') ? Number(line.rowKey.slice(5)) : null;

const seriesLabel = (code: string | null, name: string | null) => [code, name].filter(Boolean).join(' - ');

/** View-mode date: Form.Item passes a dayjs value */
function DateText({ value }: { value?: Dayjs | null }) {
  return <ReadOnlyText value={value ? value.format(DOC_DATE_FORMAT) : ''} />;
}

/** Number with thousands separators, e.g. 1,250.00 */
const formatNumber = (value: number, minDecimals = 2, maxDecimals = minDecimals) =>
  Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: minDecimals, maximumFractionDigits: maxDecimals });

/** A calculated amount in the totals: greyed-out box in edit mode, plain text in view mode */
function AmountText({ value, editing }: { value: number | null; editing: boolean }) {
  const text = value === null ? '' : formatNumber(value);
  return editing ? <Input value={text} disabled /> : <ReadOnlyText value={text} />;
}

/** Greyed-out box showing `text` (ignores the code Form.Item passes as `value`) */
function LockedBox({ text }: { text: string; value?: unknown }) {
  return <Input value={text} disabled />;
}

/** View-mode value shown as the label of the matching option (contact person, sales employee, sales type) */
function OptionText({
  value,
  options,
  fallback = '',
}: {
  value?: number | string | null;
  options: { value: number | string; label: string }[];
  /** Shown when the value isn't among the options */
  fallback?: string;
}) {
  return <ReadOnlyText value={options.find((o) => o.value === value)?.label ?? fallback} />;
}

/**
 * Detail view of a sales document — Sales Quotation (FTS11OQUT / FTS11QUT1), Sales Order (FTS11ORDR / FTS11RDR1),
 * Credit Memo (FTS11ORIN / FTS11RIN1).
 * Same fields and behaviour for each; `config` says which one. Existing documents open in view mode.
 * Save stores it as DRAFT with no No.; Confirm assigns the No. from the series, makes it OPEN
 * and locks the Posting Date and Series.
 */
export default function SalesDocumentDetail({ config, docEntry, startInEdit = false }: SalesDocumentDetailProps) {
  const isNew = docEntry === undefined;
  const { message, modal } = App.useApp();
  // Read Only screen (the user's roles): no New / Edit / Confirm / Copy To / Close / Cancel (Print and Approve /
  // Reject stay: approvals are per stage)
  const canChange = useCanChange();
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  // Active numbering series of this document type (FTS11NNM1) for the Series drop-down
  const [seriesList, setSeriesList] = useState<NumberingSeries[]>([]);
  // Detail views open in view mode; Edit switches to edit mode
  const [editing, setEditing] = useState(isNew || startInEdit);
  // ?edit=1 (a list's Edit button) on one that can no longer be changed (posted, closed, in approval...): view mode
  useEffect(() => {
    if (doc && !isDocumentEditable(doc)) setEditing(false);
  }, [doc]);

  const [customerLookupOpen, setCustomerLookupOpen] = useState(false);
  const [contacts, setContacts] = useState<SapContact[]>([]);
  const [salesEmployees, setSalesEmployees] = useState<SapSalesEmployee[]>([]);
  const [salesTypes, setSalesTypes] = useState<SalesType[]>([]);
  // SAP payment terms (OCTG) for the Payment Terms drop-down
  const [paymentTerms, setPaymentTerms] = useState<{ groupNum: number; pymntGroup: string }[]>([]);
  // SAP cost centres of Dimension 1 (OOCR) for the Branch drop-down
  const [branches, setBranches] = useState<SapBranch[]>([]);
  // Lines (FTS11QUT1) being shown / edited; saved together with the header
  const [lines, setLines] = useState<SalesDocumentLine[]>([]);
  const [taxCodes, setTaxCodes] = useState<SapTaxCode[]>([]);
  const [warehouses, setWarehouses] = useState<SapWarehouse[]>([]);
  const [salesUoms, setSalesUoms] = useState<SapUom[]>([]);
  // SAP's currencies, the local one and their rates on the Posting Date; the customer's own currency ('##' = all)
  const [currencies, setCurrencies] = useState<SapCurrencies | null>(null);
  const [cardCurrency, setCardCurrency] = useState<string | null>(null);
  // Discount Types: SAP's user table @DISCOUNTTYPE
  const [discountTypes, setDiscountTypes] = useState<SapDiscountType[]>([]);
  // Bank Info choices: SAP's user table @SELLERBANK
  const [sellerBanks, setSellerBanks] = useState<SapSellerBank[]>([]);
  // Delivery tab: the customer's SAP addresses (none for a lead, whose addresses are typed)
  const [addressBook, setAddressBook] = useState<SapCustomerAddresses | null>(null);
  const [customerIsLead, setCustomerIsLead] = useState(false);
  // Delivery Zone choices: SAP's user table @DELIVERYZONE
  const [deliveryZones, setDeliveryZones] = useState<SapAddressLists['deliveryZones']>([]);
  // Document discount %; kept when lines change (the amount follows), as in SAP B1
  const [discPrcnt, setDiscPrcnt] = useState(0);
  // Copy From lookup open
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  // Line whose item is being changed from the Details grid (Choose Item lookup open)
  const [itemLookupFor, setItemLookupFor] = useState<SalesDocumentLine | null>(null);
  // Line open in the popup detail view, and whether it's a New line
  const [openLine, setOpenLine] = useState<{ line: SalesDocumentLine; isNew: boolean } | null>(null);
  // Print (Crystal Reports layouts, System Initialization > Layouts): only when this document type has an active one
  const { canPrint, print: handlePrint, modals: printModals } = usePrintDocument(config.objType, docEntry, config.title, doc?.docNum);
  const confirmPrompt = useConfirmPrompt();
  const [mapOpen, setMapOpen] = useState(false);
  // Logged-in user (their Sales Employee is the default on a new document)
  const authUser = useAuthStore((s) => s.user);
  // Approval: whether I can approve / reject it now, and a counter that reloads the Approval tab after a decision
  const [canDecide, setCanDecide] = useState(false);
  const [approvalRefresh, setApprovalRefresh] = useState(0);
  const [form] = Form.useForm<DocumentFormValues>();
  const attachmentsRef = useRef<AttachmentsTabHandle>(null);
  // Details grid — Copy To reads its ticked lines
  const linesGridRef = useRef<DataGridHandle<SalesDocumentLine>>(null);
  const cardCode = Form.useWatch('cardCode', form) ?? '';
  // A manual series is chosen: the No. is typed in the No. field
  const seriesValue = Form.useWatch('series', form);
  // Delivery tab: the chosen Ship To (its Delivery Zone is shown)
  const billZoneValue = Form.useWatch('billDeliveryZone', form) as string | null | undefined;
  const shipZoneValue = Form.useWatch('shipDeliveryZone', form) as string | null | undefined;
  // The Branch's default warehouse (OWHS.U_Branch + U_Default = Y): a line's chosen item gets it
  const branchValue = Form.useWatch('branch', form) as string | null | undefined;
  const branchWhsCode = branchWarehouse(warehouses, branchValue);
  // Discount Type 1 .. 5 as chosen: one chosen in a field isn't offered in the others
  const discTypeValues = (Form.useWatch((v: Record<string, unknown>) => DISC_TYPE_FIELDS.map((f) => v?.[f] ?? null), form) ?? []) as (string | null)[];
  // Currency and Posting Date: item prices come in this currency at SAP's rates that day
  const docCurValue = Form.useWatch('docCur', form) as string | null | undefined;
  // Sales Type EXPORT: the lines show Export Qty / Export UoM / Export Unit Price
  const salesTypValue = Form.useWatch('salesTyp', form) as string | null | undefined;
  const isExport = salesTypValue === SALES_TYPE_EXPORT;
  const hiddenLineFields = useMemo<HiddenLineField[]>(
    () => [...(config.hiddenLineFields ?? []), ...(isExport ? [] : (['salesQty', 'salesUom', 'salesPrice'] as HiddenLineField[]))],
    [config.hiddenLineFields, isExport]
  );
  const docDateValue = Form.useWatch('docDate', form) as Dayjs | null | undefined;
  const docDateText = docDateValue ? dayjs(docDateValue).format('YYYY-MM-DD') : '';
  const localCur = currencies?.local ?? '';
  const docCurrency = docCurValue || doc?.docCur || localCur;
  const isForeign = !!docCurrency && !!localCur && docCurrency !== localCur;
  const manualSeries = !!seriesList.find((s) => s.docEntry === seriesValue)?.isManual;

  // The UoM Group units of the lines' items, priced for the customer: loaded in edit mode for items not loaded yet,
  // and again for every item when the customer changes (another price list)
  const [itemUoms, setItemUoms] = useState<Record<string, SapItemUom[]>>({});
  const itemUomsRef = useRef(itemUoms);
  itemUomsRef.current = itemUoms;
  const uomsFor = useRef({ cardCode: '', requested: new Set<string>() });
  useEffect(() => {
    if (!editing) return;
    const key = `${cardCode}|${docCurrency}|${docDateText}`;
    if (uomsFor.current.cardCode !== key) {
      uomsFor.current = { cardCode: key, requested: new Set() };
      setItemUoms({});
    }
    const asked = uomsFor.current;
    const missing = [...new Set(lines.map((l) => l.itemCode).filter(Boolean))].filter((c) => !asked.requested.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => asked.requested.add(c));
    sapAPI
      .getItemUoms(missing, cardCode, docCurrency, docDateText)
      .then((res) => {
        if (!res.success || uomsFor.current !== asked) return;
        setItemUoms((prev) => ({ ...prev, ...Object.fromEntries(missing.map((c) => [c, res.data.filter((u) => u.itemCode === c)])) }));
      })
      .catch(() => missing.forEach((c) => asked.requested.delete(c)));
  }, [editing, lines, cardCode, docCurrency, docDateText]);

  // SAP's currencies and their rates on the Posting Date (again when it changes)
  useEffect(() => {
    sapAPI
      .getCurrencies(docDateText || undefined)
      .then((res) => res.success && setCurrencies(res.data))
      .catch(() => undefined);
  }, [docDateText]);
  // A new document starts in the local currency until a customer is chosen
  useEffect(() => {
    if (isNew && localCur && !form.getFieldValue('docCur')) form.setFieldsValue({ docCur: localCur });
  }, [localCur]);
  // Footer totals, worked out again whenever a line or the discount changes
  const totals = useMemo(() => calcDocTotals(lines, { by: 'prcnt', value: discPrcnt }), [lines, discPrcnt]);

  const loadContacts = async (cardCode: string): Promise<SapContact[]> => {
    if (!cardCode) {
      setContacts([]);
      return [];
    }
    try {
      const res = await sapAPI.getContacts(cardCode);
      const list = res.success ? res.data : [];
      setContacts(list);
      return list;
    } catch {
      message.error('Failed to load contact persons');
      return [];
    }
  };

  // Delivery tab, per side: the address ID, Address Line 1 .. 4, Delivery Zone and the text built from them
  const ADDRESS_SIDES = {
    B: { code: 'payToCode', text: 'address', lines: ['billStreet', 'billStreetNo', 'billBlock', 'billCity'], zone: 'billDeliveryZone' },
    S: { code: 'shipToCode', text: 'address2', lines: ['shipStreet', 'shipStreetNo', 'shipBlock', 'shipCity'], zone: 'shipDeliveryZone' },
  } as const;
  // Choosing an SAP address (or none) fills the side's fields from it; its text as SAP lays it out
  const addressValues = (type: 'B' | 'S', a: SapCustomerAddress | null): Partial<DocumentFormValues> => {
    const side = ADDRESS_SIDES[type];
    const [l1, l2, l3, l4] = side.lines;
    return {
      [side.code]: a?.address ?? null,
      [l1]: a?.street ?? null,
      [l2]: a?.streetNo ?? null,
      [l3]: a?.block ?? null,
      [l4]: a?.city ?? null,
      [side.zone]: a?.deliveryZone ?? null,
      [side.text]: a?.text ?? '',
    };
  };
  // A changed Address Line: the side's text is built again from the lines and the rest of the chosen SAP address
  const rebuildAddressText = (type: 'B' | 'S') => {
    const side = ADDRESS_SIDES[type];
    const code = form.getFieldValue(side.code) as string | null;
    const tail = addressBook?.addresses.find((a) => a.adresType === type && a.address === code)?.textTail ?? '';
    form.setFieldsValue({
      [side.text]: buildAddressText(side.lines.map((f) => form.getFieldValue(f) as string | null), tail),
    });
  };

  // A document saved before Address Lines existed (094) has an address ID but no lines: in edit mode they are filled
  // from that SAP address (its text is kept until a line is changed)
  useEffect(() => {
    if (!editing || !addressBook || config.noAddresses) return;
    for (const type of ['B', 'S'] as const) {
      const side = ADDRESS_SIDES[type];
      const code = form.getFieldValue(side.code) as string | null;
      const hasOwn = [...side.lines, side.zone].some((f) => form.getFieldValue(f));
      const found = addressBook.addresses.find((a) => a.adresType === type && a.address === code);
      if (!code || hasOwn || !found) continue;
      const { [side.text]: _text, ...rest } = addressValues(type, found);
      form.setFieldsValue(rest);
    }
  }, [editing, addressBook]);

  // The customer's Bill To / Ship To addresses in SAP (Delivery tab); a lead has none
  const loadAddresses =async (code: string, isLead: boolean): Promise<SapCustomerAddresses | null> => {
    setCustomerIsLead(isLead);
    if (config.noAddresses || !code || isLead) {
      setAddressBook(null);
      return null;
    }
    try {
      const res = await sapAPI.getCustomerAddresses(code);
      const book = res.success ? res.data : null;
      setAddressBook(book);
      return book;
    } catch {
      message.error('Failed to load the customer addresses');
      setAddressBook(null);
      return null;
    }
  };

  // Bill To / Ship To become the customer's default addresses (a lead's: empty, to be typed)
  const applyDefaultAddresses = (book: SapCustomerAddresses | null) => {
    if (config.noAddresses) return;
    const pick = (type: 'B' | 'S', name: string | null) =>
      book?.addresses.find((a) => a.adresType === type && a.address === name) ?? null;
    form.setFieldsValue({
      ...addressValues('B', pick('B', book?.billToDef ?? null)),
      ...addressValues('S', pick('S', book?.shipToDef ?? null)),
    });
  };

  // Sales employees (SAP OSLP) and Sales Types (FTS_vw_SalesTyp)
  useEffect(() => {
    salesTypesAPI
      .getList()
      .then((res) => res.success && setSalesTypes(res.data))
      .catch(() => message.error('Failed to load sales types'));
    sapAPI
      .getSalesEmployees()
      .then((res) => res.success && setSalesEmployees(res.data))
      .catch(() => message.error('Failed to load sales employees'));
    // Branch: SAP cost centres of Dimension 1 (OOCR)
    sapAPI
      .getBranches()
      .then((res) => res.success && setBranches(res.data))
      .catch(() => message.error('Failed to load branches'));
    if (!config.noPaymentTerms || !config.noAddresses) {
      sapAPI
        .getAddressLists()
        .then((res) => {
          if (!res.success) return;
          if (!config.noPaymentTerms) setPaymentTerms(res.data.paymentTerms);
          if (!config.noAddresses) setDeliveryZones(res.data.deliveryZones);
        })
        .catch(() => message.error('Failed to load payment terms and delivery zones'));
    }
    // Choices for the lines' Tax Code and Warehouse
    sapAPI.getTaxCodes().then((res) => res.success && setTaxCodes(res.data)).catch(() => undefined);
    sapAPI.getWarehouses().then((res) => res.success && setWarehouses(res.data)).catch(() => undefined);
    if (!config.noDiscType) {
      sapAPI.getDiscountTypes().then((res) => res.success && setDiscountTypes(res.data)).catch(() => undefined);
    }
    if (!config.noBankInfo) {
      sapAPI.getSellerBanks().then((res) => res.success && setSellerBanks(res.data)).catch(() => undefined);
    }
    if (!config.hiddenLineFields?.includes('salesUom')) {
      sapAPI.getUoms().then((res) => res.success && setSalesUoms(res.data)).catch(() => undefined);
    }
    // Series choices; a new document starts with the series ticked Default in Document Numbering
    documentNumberingAPI
      .getList(config.objType)
      .then((res) => {
        if (!res.success) return;
        setSeriesList(res.data);
        const defaultSeries = res.data.find((s) => s.isDefault);
        if (isNew && defaultSeries && !form.getFieldValue('series')) form.setFieldsValue({ series: defaultSeries.docEntry });
      })
      .catch(() => message.error('Failed to load numbering series'));
  }, []);

  useEffect(() => {
    if (isNew) {
      // New document: posting, delivery and document dates default to today
      form.setFieldsValue({ docDate: dayjs(), docDueDate: dayjs(), taxDate: dayjs() });
      // Sales Employee and Branch default to the logged-in user's (Users > Sales Employee / Branch), unless already
      // filled (Copy To)
      if (authUser?.id) {
        usersAPI
          .getById(authUser.id)
          .then((res) => {
            if (res.success && res.data.slpCode !== null && form.getFieldValue('slpCode') == null) {
              form.setFieldsValue({ slpCode: res.data.slpCode });
            }
            if (res.success && res.data.branch && !form.getFieldValue('branch')) {
              form.setFieldsValue({ branch: res.data.branch });
            }
          })
          .catch(() => undefined);
      }
      // Started from another document's Copy To: read it once (then forget it) and fill this document from it
      if (config.copyFrom) {
        let pending: PendingCopy | null = null;
        try {
          const raw = sessionStorage.getItem(PENDING_COPY_KEY);
          sessionStorage.removeItem(PENDING_COPY_KEY);
          pending = raw ? (JSON.parse(raw) as PendingCopy) : null;
        } catch {
          pending = null;
        }
        if (pending) applyPendingCopy(pending);
      }
      return;
    }
    const load = async () => {
      try {
        const res = await config.api.getById(docEntry);
        if (res.success) {
          setDoc(res.data);
          setLines(withRowKeys(res.data.lines));
          setDiscPrcnt(res.data.discPrcnt);
          setCardCurrency(res.data.cardCurrency ?? null);
          await loadContacts(res.data.cardCode);
          await loadAddresses(res.data.cardCode, res.data.isLead);
        }
      } catch {
        message.error(`Failed to load ${config.title.toLowerCase()}`);
        router.push(config.listPath);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [docEntry]);

  // Fill the form once it is on screen (it isn't rendered while loading)
  useEffect(() => {
    if (!loading && doc) form.setFieldsValue(toFormValues(doc));
  }, [loading]);

  // Picking a customer fills its name, default contact person and default sales employee, as SAP B1 does.
  // A customer without one (SAP's -1 "No Sales Employee") keeps the one already there, e.g. the user's.
  // Payment Terms becomes the customer's (a lead's Credit Term; empty if it has none). Sales Type becomes the one
  // named like its Customer Type (U_CustType LOCAL -> LOCAL); no Customer Type, or none that matches: kept as it is.
  const handleCustomerPicked = async (customer: SapCustomer) => {
    setCustomerLookupOpen(false);
    form.setFieldsValue({ cardCode: customer.cardCode, cardName: customer.cardName, cntctCode: null });
    if (customer.slpCode !== null && customer.slpCode >= 0) form.setFieldsValue({ slpCode: customer.slpCode });
    if (!config.noPaymentTerms) form.setFieldsValue({ groupNum: customer.groupNum ?? null });
    const custType = customer.custType?.trim().toUpperCase();
    const salesType = custType ? salesTypes.find((s) => s.name.trim().toUpperCase() === custType) : undefined;
    if (!config.noSalesType && salesType) {
      form.setFieldsValue({ salesTyp: salesType.code });
      clearExportUnlessExport(salesType.code);
    }
    // Currency: the local one for an "all currencies" or local-currency customer (or a lead), else the customer's own
    const own = (customer.currency ?? '').trim();
    const defaultCur = !own || own === '##' ? localCur : own;
    setCardCurrency(own || null);
    if (defaultCur && defaultCur !== form.getFieldValue('docCur')) {
      if (lines.length > 0) message.warning(`Currency is now ${defaultCur}: check the line prices`);
      form.setFieldsValue({ docCur: defaultCur });
    }
    const list = await loadContacts(customer.cardCode);
    const defaultContact = list.find((c) => c.name === customer.cntctPrsn);
    if (defaultContact) form.setFieldsValue({ cntctCode: defaultContact.cntctCode });
    // Bill To / Ship To: the customer's default addresses in SAP (a lead: empty, typed in the Delivery tab)
    applyDefaultAddresses(await loadAddresses(customer.cardCode, customer.cardType === 'Lead'));
  };

  const handleCancelEdit = () => {
    if (isNew) {
      router.push(config.listPath);
      return;
    }
    form.resetFields();
    if (doc) {
      form.setFieldsValue(toFormValues(doc));
      setLines(withRowKeys(doc.lines));
      setDiscPrcnt(doc.discPrcnt);
      loadContacts(doc.cardCode);
      loadAddresses(doc.cardCode, doc.isLead);
    }
    setEditing(false);
  };

  // A loaded / saved document on screen: header, lines and contact persons
  const showDocument = (q: DocumentDetail) => {
    setDoc(q);
    setLines(withRowKeys(q.lines));
    setDiscPrcnt(q.discPrcnt);
    setCardCurrency(q.cardCurrency ?? null);
    form.setFieldsValue(toFormValues(q));
  };

  const errorText = (error: unknown, fallback: string) =>
    (error as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  // Save: a new document is stored as DRAFT (no No. yet)
  const handleSave = async (values: DocumentFormValues) => {
    if (!editing) return;
    const payload: SaveSalesDocumentDto = {
      series: values.series ?? null,
      // Manual series: the No. typed in the No. field (checked on Confirm)
      docNum: manualSeries ? values.docNum?.trim() || null : null,
      salesTyp: values.salesTyp as string,
      cardCode: values.cardCode,
      cardName: values.cardName || null,
      cntctCode: values.cntctCode ?? null,
      numAtCard: values.numAtCard || null,
      groupNum: values.groupNum ?? null,
      coa: config.noCoa ? null : values.coa ?? null,
      branch: values.branch ?? null,
      comments: values.comments || null,
      inComments: config.noExtraRemarks ? null : values.inComments || null,
      tac: config.noExtraRemarks ? null : values.tac || null,
      docDate: apiDate(values.docDate) as string,
      docDueDate: apiDate(values.docDueDate) as string,
      taxDate: apiDate(values.taxDate),
      slpCode: values.slpCode ?? null,
      lines: lines.map((line) => ({ ...line, origLineNum: origLineNum(line) })),
      discPrcnt: totals.discPrcnt,
      docCur: values.docCur || null,
      discType1: config.noDiscType ? null : values.discType1 || null,
      discType2: config.noDiscType ? null : values.discType2 || null,
      discType3: config.noDiscType ? null : values.discType3 || null,
      discType4: config.noDiscType ? null : values.discType4 || null,
      discType5: config.noDiscType ? null : values.discType5 || null,
      bankInfo: config.noBankInfo ? null : values.bankInfo || null,
      payToCode: config.noAddresses ? null : values.payToCode ?? null,
      shipToCode: config.noAddresses ? null : values.shipToCode ?? null,
      address: config.noAddresses ? null : values.address?.trim() || null,
      address2: config.noAddresses ? null : values.address2?.trim() || null,
      billStreet: config.noAddresses ? null : values.billStreet?.trim() || null,
      billStreetNo: config.noAddresses ? null : values.billStreetNo?.trim() || null,
      billBlock: config.noAddresses ? null : values.billBlock?.trim() || null,
      billCity: config.noAddresses ? null : values.billCity?.trim() || null,
      billDeliveryZone: config.noAddresses ? null : values.billDeliveryZone?.trim() || null,
      shipStreet: config.noAddresses ? null : values.shipStreet?.trim() || null,
      shipStreetNo: config.noAddresses ? null : values.shipStreetNo?.trim() || null,
      shipBlock: config.noAddresses ? null : values.shipBlock?.trim() || null,
      shipCity: config.noAddresses ? null : values.shipCity?.trim() || null,
      shipDeliveryZone: config.noAddresses ? null : values.shipDeliveryZone?.trim() || null,
    };

    setSaving(true);
    try {
      if (isNew) {
        const res = await config.api.create(payload);
        if (res.success) {
          // Files chosen before the first Save are attached now that the document exists
          await attachmentsRef.current?.save(res.data.docEntry);
          message.success(`${config.title} saved as draft`);
          router.replace(`${config.listPath}/${res.data.docEntry}`);
        }
      } else {
        const res = await config.api.update(docEntry, payload);
        if (res.success) {
          await attachmentsRef.current?.save(docEntry);
          message.success(`${config.title} updated`);
          showDocument(res.data);
          setEditing(false);
        }
      }
    } catch (error) {
      message.error(errorText(error, `Failed to save ${config.title.toLowerCase()}`));
    } finally {
      setSaving(false);
    }
  };

  // A popup's OK: the popup closes at once and the work runs behind the portal's LOADING overlay — returning the
  // promise to the popup would show Ant Design's spinner on its button instead
  const closeThenRun = <A extends unknown[]>(work: (...args: A) => Promise<void>) => (...args: A) => {
    void work(...args);
  };

  // Confirm: assigns the No. from the series (a manual series: the No. keyed in here), status OPEN, Posting Date locked
  const handleConfirm = () => {
    if (isNew) return;
    const manual = !!seriesList.find((s) => s.docEntry === doc?.series)?.isManual;
    confirmPrompt.confirm({
      title: `Confirm ${config.title}`,
      content: `${manual ? 'The No. keyed in below is given to it' : 'The No. will be assigned'} and the Posting Date and Series can no longer be changed.${
        config.postToSap ? ' It is then posted to SAP (after approval, if approval is needed).' : ''
      } Continue?`,
      manual,
      initialNo: doc?.docNum ?? '',
      onConfirm: closeThenRun(async (docNum?: string) => {
        try {
          const res = await config.api.confirm(docEntry, docNum);
          if (res.success) {
            // Approval needed: it stays a draft, without a No., until approved. Confirmed: the answer also says
            // how posting to SAP went - a warning when SAP refused it (it stays confirmed, FAILED, to post again)
            if (res.data.apprStatus === APPR_STATUS_PENDING) message.info(res.message || `${config.title} sent for approval`);
            else if (res.data.postStatus === 'FAILED') message.warning(res.message, 10);
            else message.success(res.message || `${config.title} confirmed: No. ${res.data.docNum}`);
            showDocument(res.data);
          }
        } catch (error) {
          message.error(errorText(error, `Failed to confirm ${config.title.toLowerCase()}`));
        }
      }),
    });
  };

  // ---- Approval ----

  // Waiting for approval: can I approve / reject it now (my stage's turn)? Asked only for documents still waiting.
  useEffect(() => {
    if (isNew || doc?.apprStatus !== APPR_STATUS_PENDING) {
      setCanDecide(false);
      return;
    }
    approvalsAPI
      .getForDocument(config.objType, docEntry as number)
      .then((res) => setCanDecide(res.success && res.data.canDecide))
      .catch(() => setCanDecide(false));
    // Also after my own decision: the stage may now be done, or it's someone else's turn
  }, [doc?.docEntry, doc?.apprStatus, approvalRefresh]);

  // Approve / Reject, with an optional remark; asked first, then done straight away
  const handleDecide = (decision: 'APPROVED' | 'REJECTED') => {
    const approve = decision === 'APPROVED';
    let remarks = '';
    modal.confirm({
      title: `${approve ? 'Approve' : 'Reject'} ${config.title}`,
      content: (
        <>
          <p>
            {approve
              ? 'Approve this document?'
              : "Reject this document? It can't be changed or confirmed again afterwards."}
          </p>
          <Input.TextArea rows={3} maxLength={254} placeholder="Remarks (optional)" onChange={(e) => (remarks = e.target.value)} />
        </>
      ),
      okText: approve ? 'Approve' : 'Reject',
      okButtonProps: { danger: !approve },
      cancelText: 'No',
      onOk: closeThenRun(async () => {
        try {
          const res = await approvalsAPI.decide(config.objType, docEntry as number, decision, remarks.trim() || null);
          if (res.success) {
            // The last approval also posts it to SAP: a warning when SAP refused it
            if (res.data.postStatus === 'FAILED') message.warning(res.message, 10);
            else message.success(res.message || (approve ? 'Approved' : 'Rejected'));
            showDocument(res.data);
            setApprovalRefresh((n) => n + 1);
          }
        } catch (error) {
          message.error(errorText(error, `Failed to ${approve ? 'approve' : 'reject'}`));
        }
      }),
    });
  };

  // Close Doc / Cancel Doc / Close Line: asked first, then done straight away (no Save needed), as in SAP B1
  const runStatusAction = (
    title: string,
    content: string,
    okText: string,
    call: () => Promise<{ success: boolean; data: DocumentDetail }>,
    done: string
  ) => {
    modal.confirm({
      title,
      content,
      okText,
      okButtonProps: { danger: true },
      cancelText: 'No',
      onOk: closeThenRun(async () => {
        try {
          const res = await call();
          if (res.success) {
            message.success(done);
            showDocument(res.data);
          }
        } catch (error) {
          message.error(errorText(error, `Failed: ${title}`));
        }
      }),
    });
  };

  // Posted to SAP: Close / Cancel / Close Line are done in SAP too (if SAP refuses, nothing changes in the portal)
  const inSapNote = doc?.postStatus === 'SUCCESS' ? ' It is done in SAP too.' : '';

  const handleCloseDoc = () =>
    runStatusAction(
      `Close ${config.title}`,
      `Close this document? It can't be reopened, edited or copied any more.${inSapNote}`,
      'Close Doc',
      () => config.api.close(docEntry as number),
      `${config.title} closed`
    );

  const handleCancelDoc = () =>
    runStatusAction(
      `Cancel ${config.title}`,
      `Cancel this document? It can't be undone.${inSapNote}`,
      'Cancel Doc',
      () => config.api.cancel(docEntry as number),
      `${config.title} canceled`
    );

  // Post to SAP: asked first, then posted behind the LOADING overlay. SAP's refusal leaves it FAILED with the
  // reason in the Posting tab (it can then be corrected and posted again).
  const handlePostToSap = () => {
    modal.confirm({
      title: 'Post to SAP',
      content: `Post this ${config.title.toLowerCase()} to SAP? Once posted it can't be changed in the portal.`,
      okText: 'Post',
      onOk: closeThenRun(async () => {
        try {
          const res = await config.api.postToSap(docEntry as number);
          if (res.success) {
            if (res.data.posted) message.success(res.data.message);
            else message.error(res.data.message, 8);
            showDocument(res.data.document);
          }
        } catch (error) {
          message.error(errorText(error, 'Failed to post to SAP'));
        }
      }),
    });
  };

  // Close Line: the ticked lines that are still open
  const handleCloseLines = () => {
    const ticked = linesGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the lines to close');
      return;
    }
    const open = ticked.filter((l) => l.lineStatus === LINE_STATUS_OPEN);
    if (open.length === 0) {
      message.warning('The ticked lines are already closed');
      return;
    }
    runStatusAction(
      'Close Line',
      `Close ${open.length} line${open.length > 1 ? 's' : ''}? ${open.length > 1 ? 'They' : 'It'} can't be reopened or copied any more.${inSapNote}`,
      'Close Line',
      () => config.api.closeLines(docEntry as number, open.map((l) => l.lineNum)),
      `${open.length} line${open.length > 1 ? 's' : ''} closed`
    );
  };

  // ---- Lines ----

  // Delete (edit mode): the ticked lines leave the grid and the rest are numbered again; it takes effect on Save
  // (Cancel brings them back). A line already copied to a later document can't be deleted — the server checks it
  // again on Save. Deleting a line that was itself copied (e.g. an SO line from a quotation) gives its quantity back.
  const handleDeleteLines = () => {
    const ticked = linesGridRef.current?.getSelectedRows() ?? [];
    if (ticked.length === 0) {
      message.warning('Tick the lines to delete');
      return;
    }
    // Copied on = the saved line's quantity no longer open (lines added on screen were never copied)
    const copiedOn = ticked.filter((l) => {
      const orig = origLineNum(l);
      const saved = orig === null ? undefined : doc?.lines.find((s) => s.lineNum === orig);
      return !!saved && Number(saved.quantity) - Number(saved.openQty ?? saved.quantity) > 0;
    });
    if (copiedOn.length > 0) {
      const which = copiedOn.map((l) => (l.visOrder ?? 0) + 1).join(', ');
      message.error(`Line ${which} was copied to a later document and can't be deleted`);
      return;
    }
    modal.confirm({
      title: 'Delete',
      content: `Delete ${ticked.length} line${ticked.length > 1 ? 's' : ''}? This takes effect when you Save.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'No',
      onOk: () => {
        const remove = new Set(ticked.map((l) => l.rowKey));
        setLines((prev) => renumberLines(prev.filter((l) => !remove.has(l.rowKey))));
      },
    });
  };

  // Sales Type changed to one other than EXPORT: the lines' Export Qty / Export UoM / Export Unit Price are emptied
  // (they are hidden then; the Unit Price worked out from them stays)
  const clearExportUnlessExport = (code: string | null | undefined) => {
    if (code === SALES_TYPE_EXPORT) return;
    setLines((prev) =>
      prev.some((l) => l.salesQty != null || l.salesUom || l.salesPrice != null)
        ? prev.map((l) => ({ ...l, salesQty: null, salesUom: null, salesPrice: null }))
        : prev
    );
  };

  // A value typed in a row: recalculate that line (discount / price / total, tax %)
  const handleLineCellChanged = (e: CellValueChangedEvent<SalesDocumentLine>) => {
    if (!e.data) return;
    const field = e.colDef.field;
    let changed = { ...e.data };
    if (field === 'vatGroup') changed.vatPrcnt = taxCodes.find((t) => t.code === changed.vatGroup)?.rate ?? null;
    if (field === 'vatGroup' || field === 'whsCode') changed = { ...changed, [field]: changed[field] || null };
    // Another unit: the Unit Price in that unit
    if (field === 'uomCode') {
      Object.assign(e.data, lineWithUom(changed, itemUomsRef.current[changed.itemCode], e.oldValue ?? null));
      e.api.refreshCells({ rowNodes: [e.node], force: true });
      setLines((prev) => [...prev]);
      return;
    }
    // Update the row's own object and redraw its cells, so the grid keeps editing the next cell (Tab).
    // FOC ticked / unticked: price 0 (the price before remembered) / that price back
    // Quantity / Export Qty / Export Unit Price: the Unit Price is worked out again from the Export Unit Price
    const recalculated = recalcLine(changed, changeForField(field));
    Object.assign(
      e.data,
      field === 'isFoc'
        ? setFoc({ ...changed, isFoc: !changed.isFoc }, !!changed.isFoc)
        : EXPORT_PRICE_FIELDS.includes(field ?? '')
          ? withExportPrice(recalculated)
          : recalculated
    );
    e.api.refreshCells({ rowNodes: [e.node], force: true });
    setLines((prev) => [...prev]);
  };

  // Another Branch: open lines with an item whose warehouse is empty or the old Branch's default warehouse get the new
  // Branch's default warehouse (a warehouse picked by hand stays; a Branch without one changes nothing)
  const handleBranchChange = (next: string | null | undefined) => {
    const newWhs = branchWarehouse(warehouses, next);
    if (!newWhs) return;
    const oldWhs = branchWarehouse(warehouses, branchValue);
    setLines((prev) =>
      prev.map((l) =>
        l.itemCode && (!l.lineStatus || l.lineStatus === 'OPEN') &&(!l.whsCode || l.whsCode === oldWhs) && l.whsCode !== newWhs ? { ...l, whsCode: newWhs } : l
      )
    );
  };

  // An item chosen for a line in the Details grid: refill the line from the item, keep quantity and discount
  const handleRowItemPicked = (item: SapItem) => {
    const target = itemLookupFor;
    setItemLookupFor(null);
    if (!target) return;
    setLines((prev) => prev.map((l) => (l.rowKey === target.rowKey ? lineWithItem(l, item, taxCodes, branchWhsCode) : l)));
  };

  // ---- Copy From ----

  // Copy From needs the customer: only that customer's open source documents are offered
  const handleOpenCopyFrom = () => {
    if (!cardCode) {
      message.warning('Choose a customer first');
      return;
    }
    setCopyFromOpen(true);
  };

  // Ticked source lines are added at the end with all of their open quantity (it can be lowered in the row);
  // they keep where they came from, which the server checks and takes off the source document on Save
  const handleCopyLinesPicked = (picked: CopySourceLine[]) => {
    setCopyFromOpen(false);
    const added = picked.map(
      (src): SalesDocumentLine =>
        recalcLine(
          {
            rowKey: `new-${++newLineCounter}`,
            lineNum: -1,
            itemCode: src.itemCode,
            dscription: src.dscription,
            quantity: Number(src.openQty),
            uomCode: src.uomCode,
            moq: src.moq ?? null,
            moqUom: src.moqUom ?? null,
            priceBefDi: src.priceBefDi,
            discPrcnt: src.discPrcnt,
            price: src.price,
            vatGroup: src.vatGroup,
            vatPrcnt: src.vatPrcnt,
            lineTotal: 0,
            whsCode: src.whsCode,
            text: src.text,
            isFoc: !!src.isFoc,
            salesQty: src.salesQty ?? null,
            salesUom: src.salesUom ?? null,
            salesPrice: src.salesPrice ?? null,
            baseType: src.baseType,
            baseEntry: src.baseEntry,
            baseLine: src.baseLine,
            baseRef: src.baseRef,
          },
          'discPrcnt'
        )
    );
    setLines((prev) => renumberLines([...prev, ...added]));
    // The source's document Discount % comes along (as in SAP B1) when every line is from the same document and
    // this one has no discount yet; lines from several documents with different discounts: none is guessed
    const discounts = [...new Set(picked.map((s) => Number(s.baseDiscPrcnt) || 0))];
    if (discounts.length === 1 && discounts[0] > 0) setDiscPrcnt((current) => (current === 0 ? discounts[0] : current));
  };

  // Source lines already on this document aren't offered again
  const copiedKeys = lines
    .filter((l) => l.baseEntry != null)
    .map((l) => copyKey(l.baseType ?? '', l.baseEntry as number, l.baseLine as number));

  // A new document started by another document's Copy To: take its header and copy the chosen lines in
  const applyPendingCopy = async (pending: PendingCopy) => {
    const h = pending.header;
    form.setFieldsValue({
      salesTyp: h.salesTyp,
      cardCode: h.cardCode,
      cardName: h.cardName ?? '',
      cntctCode: null,
      slpCode: h.slpCode,
      numAtCard: h.numAtCard ?? '',
      groupNum: h.groupNum ?? null,
      coa: h.coa ?? null,
      // The source's Branch; none there: the user's (filled when the document opened) stays
      ...(h.branch ? { branch: h.branch } : {}),
      // The source's currency: its prices come over as they are
      ...(h.docCur ? { docCur: h.docCur } : {}),
      discType1: h.discType1 ?? null,
      discType2: h.discType2 ?? null,
      discType3: h.discType3 ?? null,
      discType4: h.discType4 ?? null,
      discType5: h.discType5 ?? null,
      bankInfo: h.bankInfo ?? null,
      comments: `Based On ${pending.sourceTitle} ${pending.baseRef ?? ''}.`,
      inComments: h.inComments ?? '',
      tac: h.tac ?? '',
    });
    const contactList = await loadContacts(h.cardCode);
    if (h.cntctCode !== null && contactList.some((c) => c.cntctCode === h.cntctCode)) form.setFieldsValue({ cntctCode: h.cntctCode });
    // Bill To / Ship To as on the source; a source for a lead had none in SAP: the customer's default addresses
    const book = await loadAddresses(h.cardCode, false);
    if (h.payToCode === undefined) applyDefaultAddresses(book);
    else
      form.setFieldsValue({
        payToCode: h.payToCode,
        shipToCode: h.shipToCode ?? null,
        address: h.address ?? '',
        address2: h.address2 ?? '',
        billStreet: h.billStreet ?? null,
        billStreetNo: h.billStreetNo ?? null,
        billBlock: h.billBlock ?? null,
        billCity: h.billCity ?? null,
        billDeliveryZone: h.billDeliveryZone ?? null,
        shipStreet: h.shipStreet ?? null,
        shipStreetNo: h.shipStreetNo ?? null,
        shipBlock: h.shipBlock ?? null,
        shipCity: h.shipCity ?? null,
        shipDeliveryZone: h.shipDeliveryZone ?? null,
      });
    try {
      const res = await config.api.getCopySources(h.cardCode);
      const picked = (res.success ? res.data : [])
        .filter((s) => s.baseType === pending.baseType && s.baseEntry === pending.baseEntry && pending.lineNums.includes(s.baseLine))
        .sort((a, b) => a.baseLine - b.baseLine);
      if (picked.length < pending.lineNums.length) message.warning('Some lines are no longer open and were not copied');
      handleCopyLinesPicked(picked);
    } catch {
      message.error(`Failed to copy the ${pending.sourceTitle.toLowerCase()} lines`);
    }
  };

  // ---- Copy To ----

  // Copy this (OPEN) document into a new target document: the ticked lines, or else every line still open.
  // Nothing is taken off this document until the new one is saved (Copy From rules apply there).
  const handleCopyTo = () => {
    if (!doc || !config.copyTo) return;
    // A quotation for a lead: the target needs an SAP customer, so the lead must have been posted to SAP as one
    if (doc.isLead && !doc.leadCardCode) {
      message.error(
        `Lead ${doc.cardCode} is not an SAP customer yet, so it can't be copied to a ${config.copyTo.title}. Convert the lead to a customer first (A/R Sales > Convert to Customer).`
      );
      return;
    }
    const ticked = linesGridRef.current?.getSelectedRows() ?? [];
    // Only lines that are OPEN and still have quantity open
    const toCopy = (ticked.length > 0 ? ticked : lines).filter(
      (l) => l.lineStatus === LINE_STATUS_OPEN && Number(l.openQty ?? 0) > 0
    );
    if (toCopy.length === 0) {
      message.warning(ticked.length > 0 ? 'The ticked lines have nothing open to copy' : 'Nothing is open to copy');
      return;
    }
    const pending: PendingCopy = {
      baseType: config.objType,
      baseEntry: doc.docEntry,
      baseRef: doc.docNum,
      lineNums: toCopy.map((l) => l.lineNum),
      header: {
        salesTyp: doc.salesTyp,
        // For a lead: the SAP customer it was posted as
        cardCode: doc.isLead ? (doc.leadCardCode as string) : doc.cardCode,
        cardName: doc.isLead ? doc.leadCardName ?? doc.cardName : doc.cardName,
        cntctCode: doc.isLead ? null : doc.cntctCode,
        slpCode: doc.slpCode,
        numAtCard: doc.numAtCard,
        groupNum: doc.groupNum,
        coa: doc.coa,
        branch: doc.branch,
        docCur: doc.docCur ?? null,
        discType1: doc.discType1 ?? null,
        discType2: doc.discType2 ?? null,
        discType3: doc.discType3 ?? null,
        discType4: doc.discType4 ?? null,
        discType5: doc.discType5 ?? null,
        bankInfo: doc.bankInfo ?? null,
        // A lead's addresses were typed: the new document takes the SAP customer's own instead
        ...(doc.isLead
          ? {}
          : {
              payToCode: doc.payToCode ?? null,
              shipToCode: doc.shipToCode ?? null,
              address: doc.address ?? null,
              address2: doc.address2 ?? null,
              billStreet: doc.billStreet ?? null,
              billStreetNo: doc.billStreetNo ?? null,
              billBlock: doc.billBlock ?? null,
              billCity: doc.billCity ?? null,
              billDeliveryZone: doc.billDeliveryZone ?? null,
              shipStreet: doc.shipStreet ?? null,
              shipStreetNo: doc.shipStreetNo ?? null,
              shipBlock: doc.shipBlock ?? null,
              shipCity: doc.shipCity ?? null,
              shipDeliveryZone: doc.shipDeliveryZone ?? null,
            }),
        inComments: doc.inComments,
        tac: doc.tac,
      },
      sourceTitle: config.title,
    };
    try {
      sessionStorage.setItem(PENDING_COPY_KEY, JSON.stringify(pending));
    } catch {
      message.error(`Couldn't start the ${config.copyTo.title.toLowerCase()}`);
      return;
    }
    router.push(`${config.copyTo.listPath}/new`);
  };

  // OK in the line popup: replace the line, or add a New one at the end
  const handleLineOk = (line: SalesDocumentLine) => {
    setLines((prev) =>
      renumberLines(openLine?.isNew ? [...prev, line] : prev.map((l) => (l.rowKey === line.rowKey ? line : l)))
    );
    setOpenLine(null);
  };

  const lineColumns = useMemo(
    () =>
      buildLineColumns({
        editing,
        taxCodes,
        warehouses,
        salesUoms,
        getUoms: (itemCode) => itemUomsRef.current[itemCode],
        onOpenLine: (line) => setOpenLine({ line, isNew: false }),
        hidden: hiddenLineFields,
        totalLabel: isForeign ? `Total (${docCurrency})` : 'Total (LC)',
      }),
    [editing, taxCodes, warehouses, salesUoms, isForeign, docCurrency, hiddenLineFields]
  );

  if (loading) {
    // The portal's own loading overlay (LOADING... bar) shows while the data is fetched; nothing else is drawn meanwhile
    return null;
  }

  if (!isNew && !doc) return null;

  const contactOptions = contacts.map((c) => ({ value: c.cntctCode, label: c.name }));
  const salesEmployeeOptions = salesEmployees.map((s) => ({ value: s.slpCode, label: s.slpName }));
  const salesTypeOptions = salesTypes.map((s) => ({ value: s.code, label: s.name }));
  const paymentTermOptions = paymentTerms.map((t) => ({ value: t.groupNum, label: t.pymntGroup }));
  const branchOptions = branches.map((b) => ({ value: b.ocrCode, label: branchLabel(b) }));
  const sellerBankOptions = sellerBanks.map((b) => ({ value: b.code, label: b.name && b.name !== b.code ? `${b.code} - ${b.name}` : b.code }));
  const discountTypeOptions = discountTypes.map((d) => ({ value: d.code, label: d.name && d.name !== d.code ? `${d.code} - ${d.name}` : d.code }));

  // ---- Delivery tab: Bill To / Ship To ----
  // Address ID: one of the customer's SAP addresses; choosing it fills Address Line 1 .. 4 and the Delivery Zone,
  // which can then be changed. The Address text (hidden) is built from the lines. A lead has no SAP addresses:
  // the lines are typed.
  const addressOptions = (type: 'B' | 'S') =>
    (addressBook?.addresses ?? []).filter((a) => a.adresType === type).map((a) => ({ value: a.address, label: a.address }));
  const handleAddressChosen = (type: 'B' | 'S', name: string | undefined) => {
    const found = addressBook?.addresses.find((a) => a.adresType === type && a.address === name) ?? null;
    form.setFieldsValue(addressValues(type, found));
  };
  const zoneOptions = deliveryZones.map((z) => ({ value: z.code, label: deliveryZoneLabel(z) }));
  const zoneText = (code: string | null | undefined) => {
    const z = deliveryZones.find((d) => d.code === code);
    return z ? deliveryZoneLabel(z) : code ?? '';
  };
  const addressColumn = (type: 'B' | 'S') => {
    const label = type === 'B' ? 'Bill To' : 'Ship To';
    const side = ADDRESS_SIDES[type];
    const options = addressOptions(type);
    return (
      <div className={detailStyles.fields}>
        <div className={detailStyles.sectionTitle}>{label}</div>
        {!customerIsLead && (
          <Form.Item label="Address ID" name={side.code}>
            {editing ? (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={!cardCode ? 'Choose the customer first' : options.length ? `Select a ${label} address` : `No ${label} addresses in SAP`}
                options={options}
                onChange={(v: string | undefined) => handleAddressChosen(type, v)}
              />
            ) : (
              <ReadOnlyText />
            )}
          </Form.Item>
        )}
        {side.lines.map((f, i) => (
          <Form.Item key={f} label={`Address Line ${i + 1}`} name={f} rules={[{ max: 100, message: 'Maximum 100 characters' }]}>
            {editing ? <Input maxLength={100} onChange={() => rebuildAddressText(type)} /> : <ReadOnlyText />}
          </Form.Item>
        ))}
        {/* Bill To's Delivery Zone is hidden (user, 2026-11-15): filled from the chosen SAP address behind the scenes, saved and posted */}
        <Form.Item label="Delivery Zone" name={side.zone} hidden={type === 'B'}>
          {editing ? (
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={zoneOptions.length ? 'Select a delivery zone' : 'No delivery zones in SAP'}
              options={zoneOptions}
            />
          ) : (
            <DisplayText text={zoneText(type === 'B' ? billZoneValue : shipZoneValue)} />
          )}
        </Form.Item>
        {/* The Address text (SAP Address / Address2) is not shown: it is built from the lines behind the scenes, saved and posted */}
        <Form.Item name={side.text} hidden>
          <Input />
        </Form.Item>
      </div>
    );
  };
  const deliveryTab = (
    <div className={`${detailStyles.tabPanel} ${detailStyles.pairPanel}`}>
      <div className={detailStyles.pairColumns}>
        {addressColumn('B')}
        {addressColumn('S')}
      </div>
    </div>
  );

  const status = doc?.docStatus ?? STATUS_DRAFT;
  const isDraft = status === STATUS_DRAFT;
  // Been through approval (waiting, approved or rejected): never editable again. Still possible: Cancel Doc, and
  // on an approved (OPEN) document Copy To / Close Doc / Close Line.
  const inApproval = doc?.apprStatus === APPR_STATUS_PENDING || !!doc?.apprLocked;
  // CLOSED / CANCELED documents can't be changed, nor one synced to SAP (or being synced)
  const canEdit = (isDraft || status === STATUS_OPEN) && !inApproval && !isSynced(doc?.postStatus) && canChange;
  // The customer is fixed once confirmed, and while any line is copied from that customer's documents (Copy From)
  const customerLocked = !isDraft || lines.some((l) => l.baseEntry != null);
  // Sales Type is fixed once confirmed — except on a document confirmed before Sales Type existed, which may set it once
  const salesTypeLocked = !isDraft && !!doc?.salesTyp;
  // Branch is fixed once confirmed, the same way
  const branchLocked = !isDraft && !!doc?.branch;
  // Currency: chosen only for an "all currencies" customer, on a draft without lines (their prices are in it)
  const currencyChangeable = isDraft && cardCurrency === '##' && lines.length === 0;
  // SAP's rate: today's for the Posting Date while it can change, the saved one once confirmed
  const shownRate = isDraft ? currencies?.currencies.find((c) => c.code === docCurrency)?.rate : doc?.docRate;
  const toLocalAmount = (amount: number) =>
    shownRate ? Math.round((currencies?.direct ? amount * shownRate : amount / shownRate) * 100) / 100 : null;
  const currencyOptions = (currencies?.currencies ?? []).map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }));

  // The box shows the series code (as in SAP B1); the drop-down list shows code and name
  const seriesOptions = seriesList.map((s) => ({
    value: s.docEntry,
    label: s.series,
    listLabel: seriesLabel(s.series, s.seriesName),
  }));
  // A confirmed document's series may since have been made inactive; show it from the document itself
  const savedSeriesLabel = doc?.seriesCode ?? '';

  // Button order: New, Edit, then the rest
  const toolbar = editing ? (
    <>
      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
        Save
      </Button>
      <Button disabled={saving} onClick={handleCancelEdit}>Cancel</Button>
    </>
  ) : (
    <>
      {/* Read Only screen (the user's roles): only Print, and Approve / Reject (approvals are per stage) */}
      {canChange && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push(`${config.listPath}/new`)}>
          New
        </Button>
      )}
      {canEdit && (
        <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
          Edit
        </Button>
      )}
      {/* Beside Edit, only when a layout exists for this document type; any saved document, drafts too (the layout
          itself marks a draft, e.g. with a watermark) */}
      {!isNew && canPrint && (
        <Button icon={<PrinterOutlined />} onClick={handlePrint}>
          Print
        </Button>
      )}
      {isDraft && !inApproval && canChange && (
        <Button icon={<CheckCircleOutlined />} onClick={handleConfirm}>
          Confirm
        </Button>
      )}
      {/* Waiting for approval and it's my stage's turn */}
      {canDecide && (
        <>
          <Button icon={<LikeOutlined />} onClick={() => handleDecide('APPROVED')}>
            Approve
          </Button>
          <Button danger icon={<DislikeOutlined />} onClick={() => handleDecide('REJECTED')}>
            Reject
          </Button>
        </>
      )}
      {/* OPEN, needing no (more) approval, not posted yet (or failed before) */}
      {config.postToSap &&
        status === STATUS_OPEN &&
        POSTABLE_APPR_STATUSES.includes(doc?.apprStatus ?? '') &&
        !isSynced(doc?.postStatus) &&
        canChange && (
          <Button icon={<CloudUploadOutlined />} onClick={handlePostToSap}>
            Post to SAP
          </Button>
        )}
      {/* Only an OPEN document can be copied on: the ticked lines, or else every line still open */}
      {config.copyTo && status === STATUS_OPEN && canChange && (
        <Button icon={<CopyOutlined />} onClick={handleCopyTo}>
          Copy To {config.copyTo.title}
        </Button>
      )}
      {!config.noClose && status === STATUS_OPEN && canChange && (
        <Button icon={<StopOutlined />} onClick={handleCloseDoc}>
          Close Doc
        </Button>
      )}
      {/* DRAFT or OPEN (also while waiting for approval); refused by the server once something was copied from it */}
      {!config.noCancel && (isDraft || status === STATUS_OPEN) && canChange && (
        <Button danger icon={<CloseCircleOutlined />} onClick={handleCancelDoc}>
          Cancel Doc
        </Button>
      )}
      {/* Last: the documents it was copied from / into (also on a Read Only screen) */}
      {!isNew && !config.noRelationshipMap && (
        <Button icon={<ApartmentOutlined />} onClick={() => setMapOpen(true)}>
          Relationship Map
        </Button>
      )}
    </>
  );

  return (
    <>
      {/* The Form wraps the whole view: header rows in two columns, and footer rows under the lines */}
      <Form form={form} {...detailFormProps(editing)} onFinish={handleSave}>
        <DetailView
          toolbar={toolbar}
          title={`${config.title} - ${isNew ? 'New' : doc?.docNum ?? 'Draft'}`}
          // Right column, as in SAP B1: Status and dates
          sideFields={
            <>
              <Form.Item label="Status">
                {editing ? (
                  <Input value={doc?.docStatusName ?? status} disabled />
                ) : (
                  <ReadOnlyText value={doc?.docStatusName ?? status} />
                )}
              </Form.Item>
              {/* Set by the approval process, never typed (a new document has none yet) */}
              <Form.Item label="Approval Status">
                {editing ? (
                  <Input value={doc?.apprStatusName ?? doc?.apprStatus ?? ''} disabled />
                ) : (
                  <ReadOnlyText value={doc?.apprStatusName ?? doc?.apprStatus ?? ''} />
                )}
              </Form.Item>
              <Form.Item
                label="Posting Date"
                name="docDate"
                rules={[{ required: true, message: 'Posting date is required' }]}
              >
                {/* Locked once confirmed: the No. was made from it */}
                {editing ? <DatePicker format={DOC_DATE_FORMAT} disabled={!isDraft} /> : <DateText />}
              </Form.Item>
              <Form.Item
                label={config.dueDateLabel ?? 'Delivery Date'}
                name="docDueDate"
                rules={[{ required: true, message: `${config.dueDateLabel ?? 'Delivery Date'} is required` }]}
              >
                {editing ? <DatePicker format={DOC_DATE_FORMAT} /> : <DateText />}
              </Form.Item>
              <Form.Item label="Document Date" name="taxDate">
                {editing ? <DatePicker format={DOC_DATE_FORMAT} /> : <DateText />}
              </Form.Item>
              {/* Discount Type 1 .. 5 (SAP user table @DISCOUNTTYPE) — optional, each one at most once; not on a Credit Memo */}
              {!config.noDiscType &&
                DISC_TYPE_FIELDS.map((field, i) => (
                  <Form.Item key={field} label={`Discount Type ${i + 1}`} name={field}>
                    {editing ? (
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder={discountTypes.length ? 'Select a discount type' : 'No discount types in SAP'}
                        // The ones chosen in the other four aren't offered
                        options={discountTypeOptions.filter((o) => !discTypeValues.some((v, j) => j !== i && v === o.value))}
                      />
                    ) : (
                      <OptionText options={discountTypeOptions} />
                    )}
                  </Form.Item>
                ))}
            </>
          }
          below={
            <>
              {/* Tabbed group under the header; Details = the document lines */}
              <Tabs
                type="card"
                items={[
                  {
                    key: 'details',
                    label: 'Details',
                    children: (
                      <DataGrid<SalesDocumentLine>
                        handleRef={linesGridRef}
                        settingsKey={`lines:${config.objType}`}
                        showToolbar
                        // View mode: clicking a line opens it in the line popup (read-only). Edit mode: cells are edited in the row.
                        onOpenRecord={editing ? undefined : (line) => setOpenLine({ line, isNew: false })}
                        // Edit mode: New adds a line through the popup; Copy From (e.g. a Sales Order from Sales Quotations)
                        // adds lines copied from another document. Reset View Settings is added by the grid.
                        toolbar={
                          editing ? (
                            <>
                              <Button size="small" icon={<FileAddOutlined />} onClick={() => setOpenLine({ line: emptyLine(), isNew: true })}>
                                New
                              </Button>
                              {/* Beside New; Copy From after them */}
                              <Button size="small" danger icon={<DeleteOutlined />} onClick={handleDeleteLines}>
                                Delete
                              </Button>
                              {config.copyFrom && (
                                <Button size="small" icon={<CopyOutlined />} onClick={handleOpenCopyFrom}>
                                  Copy From {config.copyFrom}
                                </Button>
                              )}
                            </>
                          ) : !config.noClose && status === STATUS_OPEN && canChange ? (
                            // View mode on an OPEN document: close the ticked lines straight away
                            <Button size="small" icon={<StopOutlined />} onClick={handleCloseLines}>
                              Close Line
                            </Button>
                          ) : null
                        }
                        gridProps={{
                          rowData: lines,
                          columnDefs: lineColumns,
                          getRowId: (p) => p.data.rowKey ?? String(p.data.lineNum),
                          // Cells take focus so Tab / Enter move between the values being typed
                          suppressCellFocus: false,
                          singleClickEdit: true,
                          stopEditingWhenCellsLoseFocus: true,
                          onCellValueChanged: handleLineCellChanged,
                          onCellClicked: (e) => {
                            if (editing && e.colDef.field === 'itemCode' && e.data && e.data.baseEntry == null) setItemLookupFor(e.data);
                          },
                        }}
                      />
                    ),
                  },
                  // Delivery: Bill To / Ship To. Rendered at once so its fields are part of the form (saved even
                  // when the tab was never opened). Not on a Credit Memo.
                  ...(config.noAddresses
                    ? []
                    : [
                        {
                          key: 'delivery',
                          label: 'Delivery',
                          forceRender: true,
                          children: deliveryTab,
                        },
                      ]),
                  {
                    // Files of the document header; changes are applied on Save (still allowed after Confirm)
                    key: 'attachments',
                    label: 'Attachments',
                    children: (
                      <AttachmentsTab
                        handleRef={attachmentsRef}
                        objType={config.objType}
                        docEntry={docEntry}
                        editing={editing}
                      />
                    ),
                  },
                  // Posting to SAP B1: set by the posting, never typed, so always read-only. Only documents that are
                  // posted (Sales Order) have it; a quotation stays in the portal.
                  ...(!config.postToSap
                    ? []
                    : [
                        {
                          key: 'posting',
                          label: 'Posting',
                          children: (
                            // Full width like the grids; the rows inside keep the usual field width
                            <div className={detailStyles.tabPanel}>
                              <div className={detailStyles.fields}>
                                <Form.Item label="SAP Document No.">
                                  <ReadOnlyText value={doc?.sapDocNum != null ? String(doc.sapDocNum) : ''} />
                                </Form.Item>
                                <Form.Item label="Posting Status">
                                  <ReadOnlyText value={doc?.postStatusName ?? doc?.postStatus ?? ''} />
                                </Form.Item>
                                <Form.Item label="Error Description">
                                  <ReadOnlyText value={doc?.errorDesc ?? ''} multiline />
                                </Form.Item>
                              </div>
                            </div>
                          ),
                        },
                    ]),
                  // Approval history (FTS11WDD1); a new document has none. Loaded only when this tab is opened.
                  ...(isNew
                    ? []
                    : [
                        {
                          key: 'approval',
                          label: 'Approval',
                          children: (
                            <ApprovalTab objType={config.objType} docEntry={docEntry as number} refreshKey={approvalRefresh} />
                          ),
                        },
                      ]),
                ]}
              />
              {/* Footer under the lines, as in SAP B1: remarks on the left, totals on the right */}
              <div className={`${detailStyles.columns} ${detailStyles.footer}`}>
                <div className={detailStyles.fields}>
                  {/* Trade Remarks = SAP Comments ("Remarks" on a Credit Memo) */}
                  <Form.Item
                    label={config.noExtraRemarks ? 'Remarks' : 'Trade Remarks'}
                    name="comments"
                    rules={[{ max: 254, message: 'Maximum 254 characters' }]}
                  >
                    {editing ? <Input.TextArea rows={3} /> : <ReadOnlyText multiline />}
                  </Form.Item>
                  {/* Internal Remarks (SAP UDF U_InComments) and T&C (U_TAC) — not on a Credit Memo */}
                  {!config.noExtraRemarks && (
                    <>
                      <Form.Item label="Internal Remarks" name="inComments" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
                        {editing ? <Input.TextArea rows={3} /> : <ReadOnlyText multiline />}
                      </Form.Item>
                      <Form.Item label="T&amp;C" name="tac" rules={[{ max: 254, message: 'Maximum 254 characters' }]}>
                        {editing ? <Input.TextArea rows={3} /> : <ReadOnlyText multiline />}
                      </Form.Item>
                    </>
                  )}
                </div>
                <div className={`${detailStyles.fields} ${detailStyles.side} ${detailStyles.amounts}`}>
                  <Form.Item label="Total Before Discount">
                    <AmountText value={totals.totalBefDisc} editing={editing} />
                  </Form.Item>
                  {/* Discount % or amount; typing one works out the other */}
                  <Form.Item label="Discount">
                    {editing ? (
                      <div className={detailStyles.discount}>
                        <InputNumber
                          min={0}
                          max={100}
                          value={discPrcnt}
                          onChange={(v) => setDiscPrcnt(Number(v) || 0)}
                        />
                        <span>%</span>
                        <InputNumber
                          min={0}
                          max={totals.totalBefDisc}
                          precision={2}
                          value={totals.discSum}
                          onChange={(v) => setDiscPrcnt(calcDocTotals(lines, { by: 'sum', value: Number(v) || 0 }).discPrcnt)}
                        />
                      </div>
                    ) : (
                      <div className={detailStyles.discount}>
                        <ReadOnlyText value={formatNumber(totals.discPrcnt, 2, 6)} />
                        <span>%</span>
                        <ReadOnlyText value={formatNumber(totals.discSum)} />
                      </div>
                    )}
                  </Form.Item>
                  <Form.Item label="Tax">
                    <AmountText value={totals.vatSum} editing={editing} />
                  </Form.Item>
                  <Form.Item label={isForeign ? `Total (${docCurrency})` : 'Total'}>
                    <AmountText value={totals.docTotal} editing={editing} />
                  </Form.Item>
                  {/* A foreign currency: the total in the local currency at SAP's rate (saved: as SAP keeps it) */}
                  {isForeign && (
                    <Form.Item label={`Total (${localCur})`}>
                      <AmountText value={!editing && doc ? doc.docTotal : toLocalAmount(totals.docTotal)} editing={editing} />
                    </Form.Item>
                  )}
                </div>
              </div>
            </>
          }
        >
          <Form.Item label="No.">
            <div className={detailStyles.pair}>
              {/* The No. comes from this series when the document is confirmed; locked after that */}
              <Form.Item name="series" noStyle>
                {editing && isDraft ? (
                  <Select
                    allowClear
                    placeholder="Series"
                    options={seriesOptions}
                    optionRender={(option) => option.data.listLabel}
                    popupMatchSelectWidth={false}
                  />
                ) : editing ? (
                  <LockedBox text={savedSeriesLabel} />
                ) : (
                  <OptionText options={seriesOptions} fallback={savedSeriesLabel} />
                )}
              </Form.Item>
              {/* Assigned by document numbering on Confirm; typed here on a manual series (checked on Confirm) */}
              {editing && isDraft && manualSeries ? (
                <Form.Item name="docNum" noStyle>
                  <Input maxLength={MANUAL_NO_MAX} placeholder="Key in the No." />
                </Form.Item>
              ) : editing ? (
                <Input value={isDraft ? '' : (doc?.docNum ?? '')} placeholder="On confirm" disabled />
              ) : (
                <ReadOnlyText value={doc?.docNum} />
              )}
            </div>
          </Form.Item>
          {/* Sales Type (FTS_vw_SalesTyp) — mandatory, except on a document without one (Credit Memo) */}
          {!config.noSalesType && (
          <Form.Item label="Sales Type" name="salesTyp" rules={[{ required: true, message: 'Sales Type is required' }]}>
            {editing && salesTypeLocked ? (
              // Locked once confirmed, like Customer
              <LockedBox text={doc?.salesTypName ?? doc?.salesTyp ?? ''} />
            ) : editing ? (
              <Select placeholder="Select a sales type" options={salesTypeOptions} onChange={(code: string) => clearExportUnlessExport(code)} />
            ) : (
              <OptionText options={salesTypeOptions} fallback={doc?.salesTypName ?? ''} />
            )}
          </Form.Item>
          )}
          <Form.Item
            label="Customer"
            name="cardCode"
            rules={[{ required: true, message: 'Customer is required' }]}
          >
            {editing && customerLocked ? (
              // Locked once confirmed, or once lines were copied from this customer's documents (as in SAP B1)
              <Input disabled />
            ) : editing ? (
              // Chosen from the SAP customer list, not typed
              <Input
                readOnly
                placeholder="Click to choose a customer"
                onClick={() => setCustomerLookupOpen(true)}
                suffix={<SearchOutlined onClick={() => setCustomerLookupOpen(true)} style={{ cursor: 'pointer' }} />}
              />
            ) : (
              <ReadOnlyText />
            )}
          </Form.Item>
          <Form.Item label="Name" name="cardName" rules={[{ max: 200, message: 'Maximum 200 characters' }]}>
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          {/* Currency: the customer's (the local one for an "all currencies" customer, who may choose another on a draft
              without lines); SAP's rate for the Posting Date, as SAP B1 takes it */}
          <Form.Item label="Currency">
            <div className={detailStyles.pair}>
              <Form.Item name="docCur" noStyle>
                {editing && currencyChangeable ? (
                  <Select showSearch optionFilterProp="label" options={currencyOptions} popupMatchSelectWidth={false} />
                ) : editing ? (
                  <LockedBox text={docCurrency} />
                ) : (
                  <ReadOnlyText value={docCurrency} />
                )}
              </Form.Item>
              {isForeign &&
                (shownRate ? (
                  editing ? (
                    <Input value={`Rate ${formatNumber(shownRate, 2, 6)}`} disabled />
                  ) : (
                    <ReadOnlyText value={`Rate ${formatNumber(shownRate, 2, 6)}`} />
                  )
                ) : (
                  <span style={{ color: '#bb0000' }}>
                    No SAP rate for {docDateValue ? dayjs(docDateValue).format(DOC_DATE_FORMAT) : 'the Posting Date'}
                  </span>
                ))}
            </div>
          </Form.Item>
          <Form.Item label="Contact Person" name="cntctCode">
            {editing ? (
              <Select
                allowClear
                placeholder={contacts.length ? 'Select a contact person' : 'Choose a customer first'}
                options={contactOptions}
              />
            ) : (
              <OptionText options={contactOptions} />
            )}
          </Form.Item>
          <Form.Item label="Sales Employee" name="slpCode">
            {editing ? (
              <Select allowClear placeholder="Select a sales employee" options={salesEmployeeOptions} />
            ) : (
              <OptionText options={salesEmployeeOptions} />
            )}
          </Form.Item>
          {/* Branch (SAP Dimension 1 cost centre) — optional; starts as the user's; posted as every line's cost centre */}
          <Form.Item label="Branch" name="branch">
            {editing && branchLocked ? (
              <LockedBox text={doc?.branch ? branchLabel({ ocrCode: doc.branch, ocrName: doc.branchName ?? '' }) : ''} />
            ) : editing ? (
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Select a branch"
                options={branchOptions}
                onChange={handleBranchChange}
              />
            ) : (
              <OptionText
                options={branchOptions}
                fallback={doc?.branch ? branchLabel({ ocrCode: doc.branch, ocrName: doc.branchName ?? '' }) : ''}
              />
            )}
          </Form.Item>
          <Form.Item label={config.numAtCardLabel ?? 'Customer Ref. No.'} name="numAtCard" rules={[{ max: 200, message: 'Maximum 200 characters' }]}>
            {editing ? <Input /> : <ReadOnlyText />}
          </Form.Item>
          {/* Payment Terms (SAP OCTG) — optional: empty = the customer's own in SAP; not on a Credit Memo */}
          {!config.noPaymentTerms && (
            <Form.Item label="Payment Terms" name="groupNum">
              {editing ? (
                <Select allowClear placeholder="Customer's payment terms" options={paymentTermOptions} />
              ) : (
                <OptionText options={paymentTermOptions} fallback={doc?.pymntGroup ?? ''} />
              )}
            </Form.Item>
          )}
          {/* COA (SAP UDF U_COA: Y = Yes, N = No) — optional; not on a Credit Memo */}
          {!config.noCoa && (
            <Form.Item label="COA" name="coa">
              {editing ? (
                <Select allowClear placeholder="Select Yes or No" options={COA_OPTIONS} />
              ) : (
                <OptionText options={COA_OPTIONS} />
              )}
            </Form.Item>
          )}
          {/* Bank Info (SAP user table @SELLERBANK, posted to U_BankInfo) — optional, starts empty; not on a Credit Memo */}
          {!config.noBankInfo && (
            <Form.Item label="Bank Info" name="bankInfo">
              {editing ? (
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder={sellerBanks.length ? 'Select a bank' : 'No seller banks in SAP'}
                  options={sellerBankOptions}
                />
              ) : (
                <OptionText options={sellerBankOptions} />
              )}
            </Form.Item>
          )}
        </DetailView>
      </Form>

      <DocumentLineDetail
        line={openLine?.line ?? null}
        isNew={!!openLine?.isNew}
        editable={editing}
        cardCode={cardCode ?? ''}
        rebateItemsOnly={config.rebateItemsOnly}
        hiddenFields={hiddenLineFields}
        taxCodes={taxCodes}
        warehouses={warehouses}
        branchWhsCode={branchWhsCode}
        salesUoms={salesUoms}
        currency={docCurrency}
        docDate={docDateText}
        onOk={handleLineOk}
        onCancel={() => setOpenLine(null)}
      />

      {/* Print: choose a layout (several active ones) and the printed PDF */}
      {printModals}
      {confirmPrompt.modal}
      {!isNew && !config.noRelationshipMap && <RelationshipMap open={mapOpen} objType={config.objType} docEntry={docEntry as number} onClose={() => setMapOpen(false)} />}

      {/* Copy From: tick open lines of the customer's OPEN source documents */}
      {config.copyFrom && (
        <LookupListView<CopySourceLine>
          open={copyFromOpen}
          title={`Copy From ${config.copyFrom}`}
          searchPlaceholder="Search..."
          width={1000}
          columnDefs={copySourceColumns(config.copyFrom)}
          loadRows={async () => {
            const res = await config.api.getCopySources(cardCode);
            // Only documents in this document's currency (the copied prices are in it)
            return res.success ? res.data.filter((s) => !s.baseDocCur || s.baseDocCur === docCurrency) : [];
          }}
          getKey={(s) => copyKey(s.baseType, s.baseEntry, s.baseLine)}
          excludeKeys={copiedKeys}
          onCancel={() => setCopyFromOpen(false)}
          onSelect={handleCopyLinesPicked}
        />
      )}

      {/* Change a line's item straight from the Details grid */}
      <LookupListView<SapItem>
        open={!!itemLookupFor}
        title={config.rebateItemsOnly ? 'Choose Rebate Item' : 'Choose Item'}
        searchPlaceholder="Search items..."
        columnDefs={itemLookupColumns}
        loadRows={async () => {
          const res = await sapAPI.getItems(cardCode, config.rebateItemsOnly, docCurrency, docDateText);
          return res.success ? res.data : [];
        }}
        getKey={(i) => i.itemCode}
        excludeKeys={[]}
        singleSelect
        onCancel={() => setItemLookupFor(null)}
        onSelect={(picked) => handleRowItemPicked(picked[0])}
      />

      <LookupListView<SapCustomer>
        open={customerLookupOpen}
        title={config.allowsLeads ? 'Choose Customer / Lead' : 'Choose Customer'}
        searchPlaceholder={config.allowsLeads ? 'Search customers and leads...' : 'Search customers...'}
        columnDefs={config.allowsLeads ? customerAndLeadColumns : customerLookupColumns}
        loadRows={() => loadCustomers(!!config.allowsLeads)}
        getKey={(c) => c.cardCode}
        excludeKeys={[]}
        singleSelect
        onCancel={() => setCustomerLookupOpen(false)}
        onSelect={(picked) => handleCustomerPicked(picked[0])}
      />
    </>
  );
}
