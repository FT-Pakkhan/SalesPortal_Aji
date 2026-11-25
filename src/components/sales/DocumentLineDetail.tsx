'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Checkbox, Form, Input, InputNumber, Modal, Select } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ColDef } from 'ag-grid-community';
import { sapAPI } from '@/lib/apiClient';
import { findUom, lineWithUom, recalcLine, setFoc, withExportPrice } from '@/lib/documentLines';
import type { LineChange } from '@/lib/documentLines';
import { ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import { LookupListView } from '@/components/ui/LookupListView';
import type { SalesDocumentLine, SapItem, SapItemUom, SapTaxCode, SapUom, SapWarehouse } from '@/types';

interface DocumentLineDetailProps {
  /** The line to show; null closes the popup */
  line: SalesDocumentLine | null;
  /** True for a line that isn't on the quotation yet (New) */
  isNew: boolean;
  /** Fields can be changed (the quotation is in edit mode) */
  editable: boolean;
  /** Customer of the quotation — its price list gives the item prices */
  cardCode: string;
  /** Only rebate items (U_Rebate = 'Y') can be chosen — the Credit Memo */
  rebateItemsOnly?: boolean;
  /** Fields not shown; they keep their defaults (Credit Memo: quantity 1, the item's tax code) */
  hiddenFields?: HiddenLineField[];
  taxCodes: SapTaxCode[];
  warehouses: SapWarehouse[];
  /** The document Branch's default warehouse: a chosen item's line gets it */
  branchWhsCode?: string | null;
  /** SAP's units of measure, for Export UoM */
  salesUoms: SapUom[];
  /** The document's currency and Posting Date (YYYY-MM-DD): item prices come in that currency at SAP's rates */
  currency?: string;
  docDate?: string;
  onOk: (line: SalesDocumentLine) => void;
  onCancel: () => void;
}

/**
 * Line fields a document type can hide (Credit Memo: Quantity, UoM Code, FOC, Discount %, Price after Discount, Tax Code,
 * Tax %, MOQ, Export Qty / UoM / Unit Price); the Export ones are also hidden unless the Sales Type is EXPORT
 */
export type HiddenLineField =
  | 'quantity'
  | 'uomCode'
  | 'isFoc'
  | 'discPrcnt'
  | 'price'
  | 'vatGroup'
  | 'vatPrcnt'
  | 'moq'
  | 'moqUom'
  | 'salesQty'
  | 'salesUom'
  | 'salesPrice';

/** Columns of the Choose Item lookup (also used by the Details grid) */
export const itemLookupColumns: ColDef<SapItem>[] = [
  { field: 'itemCode', headerName: 'Item No.', sort: 'asc' },
  { field: 'itemName', headerName: 'Item Description' },
  { field: 'price', headerName: 'Price', cellDataType: 'number' },
];

/**
 * A line with a newly chosen item: its description, unit, price-list price, default warehouse and tax code,
 * as SAP B1 fills them. Quantity and Discount % are kept; Price after Discount and Total are worked out again.
 * With an Export Unit Price the Unit Price comes from it instead (withExportPrice).
 * The warehouse is the document Branch's default warehouse when it has one, else the item's default warehouse.
 */
export function lineWithItem(line: SalesDocumentLine, item: SapItem, taxCodes: SapTaxCode[], branchWhsCode?: string | null): SalesDocumentLine {
  const vatGroup = item.vatGroup ?? line.vatGroup;
  // An Export Unit Price filled in still decides the Unit Price (not the item's price-list price)
  return withExportPrice(recalcLine(
    {
      ...line,
      itemCode: item.itemCode,
      dscription: item.itemName,
      uomCode: item.salUnitMsr,
      moq: item.moq ?? null,
      moqUom: item.moqUom ?? null,
      priceBefDi: item.price ?? 0,
      // A FOC line stays at price 0; the item's price is kept for when FOC is unticked
      focPrevPrice: line.isFoc ? item.price ?? 0 : line.focPrevPrice,
      whsCode: branchWhsCode || item.dfltWH || line.whsCode,
      vatGroup,
      vatPrcnt: taxCodes.find((t) => t.code === vatGroup)?.rate ?? null,
    },
    'priceBefDi'
  ));
}

const amountText = (value: number | null | undefined) =>
  value === null || value === undefined
    ? ''
    : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Detail view of one quotation line, in a popup. Opened from a line's edit button or from New. */
export default function DocumentLineDetail({
  line,
  isNew,
  editable,
  cardCode,
  rebateItemsOnly = false,
  hiddenFields = [],
  taxCodes,
  warehouses,
  branchWhsCode,
  salesUoms,
  currency,
  docDate,
  onOk,
  onCancel,
}: DocumentLineDetailProps) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<SalesDocumentLine | null>(line);
  const [itemLookupOpen, setItemLookupOpen] = useState(false);
  // The units of the line item's UoM Group, priced for the customer (empty: a Manual UoM item, typed)
  const [uoms, setUoms] = useState<SapItemUom[]>([]);

  useEffect(() => {
    setDraft(line);
  }, [line]);

  const itemCode = draft?.itemCode ?? '';
  useEffect(() => {
    let current = true;
    setUoms([]);
    if (itemCode && editable) {
      sapAPI
        .getItemUoms([itemCode], cardCode, currency, docDate)
        .then((res) => current && res.success && setUoms(res.data))
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [itemCode, cardCode, editable, currency, docDate]);

  if (!draft) return null;

  const update = (changes: Partial<SalesDocumentLine>, changed: LineChange = 'other') =>
    setDraft((prev) => (prev ? recalcLine({ ...prev, ...changes }, changed) : prev));
  // Quantity / Export Qty / Export Unit Price changed: the Unit Price is worked out again from the Export Unit Price
  // (when it is filled in; it stays editable)
  const updateExport = (changes: Partial<SalesDocumentLine>, changed: LineChange = 'other') =>
    setDraft((prev) => (prev ? withExportPrice(recalcLine({ ...prev, ...changes }, changed)) : prev));

  const taxRate = (code: string | null) => taxCodes.find((t) => t.code === code)?.rate ?? null;

  // Choosing an item fills its description, unit, price-list price, default warehouse and tax code
  const handleItemPicked = (item: SapItem) => {
    setItemLookupOpen(false);
    setDraft((prev) => (prev ? lineWithItem(prev, item, taxCodes, branchWhsCode) : prev));
  };

  const handleOk = () => {
    if (!draft.itemCode) {
      message.error('Item is required');
      return;
    }
    if (!(Number(draft.quantity) > 0)) {
      message.error('Quantity must be more than 0');
      return;
    }
    onOk(draft);
  };

  const footer = editable
    ? [
        <Button key="cancel" onClick={onCancel}>Cancel</Button>,
        <Button key="ok" type="primary" onClick={handleOk}>OK</Button>,
      ]
    : [<Button key="close" onClick={onCancel}>Close</Button>];

  const value = (text: React.ReactNode) => <ReadOnlyText value={text} />;

  return (
    <>
      <Modal
        title={`Line ${isNew ? '- New' : (draft.visOrder ?? 0) + 1}`}
        open={!!line}
        onCancel={onCancel}
        footer={footer}
        width={620}
        destroyOnHidden
      >
        {/* Same look as a detail view: label : value rows */}
        <div className={detailStyles.fields}>
          <Form {...detailFormProps(editable)}>
            <Form.Item label="Item No." required>
              {/* A line copied from another document keeps its item (as in SAP B1) */}
              {editable && draft.baseEntry != null ? (
                <Input value={draft.itemCode} disabled />
              ) : editable ? (
                <Input
                  readOnly
                  value={draft.itemCode}
                  placeholder="Click to choose an item"
                  onClick={() => setItemLookupOpen(true)}
                  suffix={<SearchOutlined onClick={() => setItemLookupOpen(true)} style={{ cursor: 'pointer' }} />}
                />
              ) : (
                value(draft.itemCode)
              )}
            </Form.Item>
            <Form.Item label="Item Description">
              {editable ? (
                <Input value={draft.dscription ?? ''} maxLength={200} onChange={(e) => update({ dscription: e.target.value })} />
              ) : (
                value(draft.dscription)
              )}
            </Form.Item>
            {!hiddenFields.includes('quantity') && (
              <Form.Item label="Quantity" required>
                {editable ? (
                  <InputNumber min={0} value={draft.quantity} onChange={(v) => updateExport({ quantity: v ?? 0 }, 'quantity')} />
                ) : (
                  value(amountText(draft.quantity))
                )}
              </Form.Item>
            )}
            {!hiddenFields.includes('uomCode') && (
              <Form.Item label="UoM Code">
                {/* A UoM Group item: one of its group's units (the price follows); a Manual UoM item: typed.
                    A line copied from another document keeps its unit (its open quantity is in that unit). */}
                {editable && draft.baseEntry != null ? (
                  <Input value={draft.uomCode ?? ''} disabled />
                ) : editable && uoms.length > 0 ? (
                  <Select
                    value={findUom(uoms, draft.uomCode)?.uomCode ?? draft.uomCode ?? undefined}
                    options={uoms.map((u) => ({ value: u.uomCode, label: u.uomName && u.uomName !== u.uomCode ? `${u.uomCode} - ${u.uomName}` : u.uomCode }))}
                    onChange={(code: string) =>
                      setDraft((prev) => (prev ? lineWithUom({ ...prev, uomCode: code }, uoms, prev.uomCode) : prev))
                    }
                  />
                ) : editable ? (
                  <Input value={draft.uomCode ?? ''} maxLength={20} onChange={(e) => update({ uomCode: e.target.value })} />
                ) : (
                  value(draft.uomCode)
                )}
              </Form.Item>
            )}
            {/* Export Qty / Export UoM / Export Unit Price: Sales Type EXPORT only (SAP line UDFs U_SalesQty / U_SalesUoM /
                U_SalesPrice); the Unit Price is worked out from them */}
            {!hiddenFields.includes('salesQty') && (
              <Form.Item label="Export Qty">
                {editable ? (
                  <InputNumber min={0} controls={false} value={draft.salesQty ?? null} onChange={(v) => updateExport({ salesQty: v ?? null })} />
                ) : (
                  value(amountText(draft.salesQty))
                )}
              </Form.Item>
            )}
            {!hiddenFields.includes('salesUom') && (
              <Form.Item label="Export UoM">
                {editable ? (
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    value={draft.salesUom ?? undefined}
                    options={salesUoms.map((u) => ({ value: u.uomCode, label: u.uomName && u.uomName !== u.uomCode ? `${u.uomCode} - ${u.uomName}` : u.uomCode }))}
                    onChange={(code) => update({ salesUom: code ?? null })}
                  />
                ) : (
                  value(draft.salesUom)
                )}
              </Form.Item>
            )}
            {!hiddenFields.includes('salesPrice') && (
              <Form.Item label="Export Unit Price">
                {editable ? (
                  <InputNumber
                    min={0}
                    controls={false}
                    value={draft.salesPrice ?? null}
                    onChange={(v) => updateExport({ salesPrice: v ?? null })}
                  />
                ) : (
                  value(amountText(draft.salesPrice))
                )}
              </Form.Item>
            )}
            {/* From the item master in SAP: shown, never typed */}
            {!hiddenFields.includes('moq') && (
              <Form.Item label="MOQ">
                {editable ? <Input value={amountText(draft.moq)} disabled /> : value(amountText(draft.moq))}
              </Form.Item>
            )}
            {!hiddenFields.includes('moqUom') && (
              <Form.Item label="MOQ UoM">
                {editable ? <Input value={draft.moqUom ?? ''} disabled /> : value(draft.moqUom)}
              </Form.Item>
            )}
            {/* Free of charge: Unit Price 0 and the prices locked while ticked */}
            {!hiddenFields.includes('isFoc') && (
              <Form.Item label="FOC">
                <Checkbox
                  checked={!!draft.isFoc}
                  disabled={!editable}
                  onChange={(e) => setDraft((prev) => (prev ? setFoc(prev, e.target.checked) : prev))}
                />
              </Form.Item>
            )}
            <Form.Item label="Unit Price">
              {editable ? (
                <InputNumber
                  min={0}
                  controls={false}
                  disabled={!!draft.isFoc}
                  value={draft.priceBefDi}
                  onChange={(v) => update({ priceBefDi: v ?? 0 }, 'priceBefDi')}
                />
              ) : (
                value(amountText(draft.priceBefDi))
              )}
            </Form.Item>
            {!hiddenFields.includes('discPrcnt') && (
              <Form.Item label="Discount %">
                {editable ? (
                  <InputNumber
                    min={0}
                    max={100}
                    controls={false}
                    disabled={!!draft.isFoc}
                    value={draft.discPrcnt}
                    onChange={(v) => update({ discPrcnt: v ?? 0 }, 'discPrcnt')}
                  />
                ) : (
                  value(amountText(draft.discPrcnt))
                )}
              </Form.Item>
            )}
            {!hiddenFields.includes('price') && (
              <Form.Item label="Price after Discount">
                {editable ? (
                  <InputNumber min={0} controls={false} disabled={!!draft.isFoc} value={draft.price} onChange={(v) => update({ price: v ?? 0 }, 'price')} />
                ) : (
                  value(amountText(draft.price))
                )}
              </Form.Item>
            )}
            {!hiddenFields.includes('vatGroup') && (
              <Form.Item label="Tax Code">
                {editable ? (
                  <Select
                    allowClear
                    value={draft.vatGroup ?? undefined}
                    options={taxCodes.map((t) => ({ value: t.code, label: `${t.code} - ${t.name}` }))}
                    onChange={(code) => update({ vatGroup: code ?? null, vatPrcnt: taxRate(code ?? null) })}
                  />
                ) : (
                  value(draft.vatGroup)
                )}
              </Form.Item>
            )}
            {/* Calculated — shown, never typed */}
            {!hiddenFields.includes('vatPrcnt') && (
              <Form.Item label="Tax %">
                {editable ? <Input value={amountText(draft.vatPrcnt)} disabled /> : value(amountText(draft.vatPrcnt))}
              </Form.Item>
            )}
            <Form.Item label="Total (LC)">
              {editable ? <Input value={amountText(draft.lineTotal)} disabled /> : value(amountText(draft.lineTotal))}
            </Form.Item>
            <Form.Item label="Warehouse">
              {editable ? (
                <Select
                  allowClear
                  value={draft.whsCode ?? undefined}
                  options={warehouses.map((w) => ({ value: w.whsCode, label: `${w.whsCode} - ${w.whsName}` }))}
                  onChange={(code) => update({ whsCode: code ?? null })}
                />
              ) : (
                value(draft.whsCode)
              )}
            </Form.Item>
            <Form.Item label="Item Details">
              {editable ? (
                <Input.TextArea rows={4} value={draft.text ?? ''} onChange={(e) => update({ text: e.target.value })} />
              ) : (
                <ReadOnlyText value={draft.text} multiline />
              )}
            </Form.Item>
          </Form>
        </div>
      </Modal>

      <LookupListView<SapItem>
        open={itemLookupOpen}
        title={rebateItemsOnly ? 'Choose Rebate Item' : 'Choose Item'}
        searchPlaceholder="Search items..."
        columnDefs={itemLookupColumns}
        loadRows={async () => {
          const res = await sapAPI.getItems(cardCode, rebateItemsOnly, currency, docDate);
          return res.success ? res.data : [];
        }}
        getKey={(i) => i.itemCode}
        excludeKeys={[]}
        singleSelect
        onCancel={() => setItemLookupOpen(false)}
        onSelect={(picked) => handleItemPicked(picked[0])}
      />
    </>
  );
}
