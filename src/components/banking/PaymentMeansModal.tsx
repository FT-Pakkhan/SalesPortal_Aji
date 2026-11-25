'use client';

import React, { useEffect } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Select, Tabs } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { ReadOnlyText, detailFormProps } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import type { ReceiptCheque, ReceiptPaymentMeans, SapHouseBank } from '@/types';

/** No payment yet */
export const EMPTY_MEANS: ReceiptPaymentMeans = {
  cheques: [],
  checkSum: 0,
  trsfrSum: 0,
  trsfrBank: null,
  creditSum: 0,
  cashSum: 0,
  bcgSum: 0,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Copy To: a Temporary Receipt Request handed to the new Temporary Receipt (browser session, for that one step) */
export const RECEIPT_COPY_KEY = 'portal:receiptRequestCopy';

/** The cheques' total */
export const chequesTotal = (cheques: ReceiptCheque[]) => round2(cheques.reduce((sum, c) => sum + Number(c?.checkSum || 0), 0));
/** What the customer paid (the payment means, without the bank charge) */
export const paidOf = (m: ReceiptPaymentMeans) =>
  round2(chequesTotal(m.cheques ?? []) + Number(m.trsfrSum || 0) + Number(m.creditSum || 0) + Number(m.cashSum || 0));
/** The receipt's Amount: what was paid + the bank charge (the bank kept it, but it still settles the customer's items) */
export const totalOf = (m: ReceiptPaymentMeans) => round2(paidOf(m) + Number(m.bcgSum || 0));

/** The Payment Type that follows from the means: the one used, or MP (Multiple Type); null = nothing keyed in yet */
export function payTypeOf(m: ReceiptPaymentMeans): string | null {
  const used = (
    [
      ['CH', chequesTotal(m.cheques ?? [])],
      ['BT', m.trsfrSum],
      ['CC', m.creditSum],
      ['CA', m.cashSum],
    ] as const
  ).filter(([, amount]) => Number(amount) > 0);
  if (used.length === 0) return null;
  return used.length === 1 ? used[0][0] : 'MP';
}

const money = (v: number) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Payment Means popup (as in SAP B1's Incoming Payment): how the customer paid — Cheques (each with its No. and amount),
 * Bank Transfer (bank + amount), Credit Card (amount), Cash (amount) — and one Bank Charge for the whole receipt. Below
 * the tabs: the total paid, the Amount and the documents' Total Applied (Details tab). Read-only in view mode.
 */
export function PaymentMeansModal({
  open,
  means,
  editing,
  houseBanks,
  totalApplied,
  onOk,
  onCancel,
}: {
  open: boolean;
  means: ReceiptPaymentMeans;
  editing: boolean;
  houseBanks: SapHouseBank[];
  /** The Details tab's Total Amount Applied, shown for comparison (a request has none: left out) */
  totalApplied?: number;
  onOk: (means: ReceiptPaymentMeans) => void;
  onCancel: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ReceiptPaymentMeans>();
  const values = Form.useWatch([], form) as ReceiptPaymentMeans | undefined;
  const current = { ...EMPTY_MEANS, ...(values ?? means) };
  const chequeTotal = chequesTotal(current.cheques ?? []);
  const paid = paidOf(current);
  const total = totalOf(current);

  // Starts from the receipt's means each time it opens (Cancel discards what was typed); one empty cheque row to fill
  useEffect(() => {
    if (open) form.setFieldsValue({ ...means, cheques: means.cheques.length > 0 ? means.cheques : editing ? [{ checkNum: '', checkSum: 0 }] : [] });
  }, [open]);

  const handleOk = () => {
    const v = { ...EMPTY_MEANS, ...form.getFieldsValue(true) } as ReceiptPaymentMeans;
    // Rows left completely empty are dropped; a half-filled one must be finished
    const rows = (v.cheques ?? [])
      .map((c) => ({ checkNum: String(c?.checkNum ?? '').trim(), checkSum: round2(Number(c?.checkSum || 0)) }))
      .filter((c) => c.checkNum || c.checkSum);
    const half = rows.findIndex((c) => !c.checkNum || c.checkSum <= 0);
    if (half >= 0) {
      message.warning(`Cheque tab, row ${half + 1}: key in both the Cheque No. and the amount`);
      return;
    }
    const twice = rows.find((c, i) => rows.findIndex((x) => x.checkNum.toLowerCase() === c.checkNum.toLowerCase()) !== i);
    if (twice) {
      message.warning(`Cheque tab: cheque ${twice.checkNum} is listed twice`);
      return;
    }
    const m: ReceiptPaymentMeans = {
      cheques: rows,
      checkSum: chequesTotal(rows),
      trsfrSum: round2(Number(v.trsfrSum || 0)),
      trsfrBank: v.trsfrBank ?? null,
      creditSum: round2(Number(v.creditSum || 0)),
      cashSum: round2(Number(v.cashSum || 0)),
      bcgSum: round2(Number(v.bcgSum || 0)),
    };
    if (m.trsfrSum > 0 && m.trsfrBank === null) {
      message.warning('Bank Transfer tab: choose the Bank');
      return;
    }
    if (paidOf(m) <= 0) {
      message.warning('Key in the amount received on one of the tabs');
      return;
    }
    // A transfer not used keeps no bank
    if (m.trsfrSum === 0) m.trsfrBank = null;
    onOk(m);
  };

  const amount = (name: keyof ReceiptPaymentMeans, label = 'Amount') => (
    <Form.Item label={label} name={name}>
      {editing ? (
        <InputNumber min={0} precision={2} controls={false} style={{ width: '100%' }} />
      ) : (
        <ReadOnlyText value={money(Number(means[name] ?? 0))} />
      )}
    </Form.Item>
  );

  const panel = (rows: React.ReactNode) => (
    <div className={detailStyles.tabPanel} style={{ minHeight: 0 }}>
      <div className={detailStyles.fields}>{rows}</div>
    </div>
  );

  const bankName = (absEntry: number | null) => {
    const b = houseBanks.find((h) => h.absEntry === absEntry);
    return b ? `${b.bankCode} - ${b.account}` : '';
  };

  /** Cheque tab: one row per cheque (No. + amount), Add / delete in edit mode, their total under them */
  const chequeTab = (
    <div className={detailStyles.tabPanel} style={{ minHeight: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 32px', gap: 6, alignItems: 'center', fontWeight: 600, marginBottom: 6 }}>
        <span>Cheque No.</span>
        <span style={{ textAlign: 'right' }}>Amount</span>
        <span />
      </div>
      {editing ? (
        <Form.List name="cheques">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 32px', gap: 6, marginBottom: 6 }}>
                  <Form.Item name={[f.name, 'checkNum']} noStyle>
                    <Input maxLength={20} placeholder="Cheque No." />
                  </Form.Item>
                  <Form.Item name={[f.name, 'checkSum']} noStyle>
                    <InputNumber min={0} precision={2} controls={false} style={{ width: '100%' }} />
                  </Form.Item>
                  <Button type="text" icon={<DeleteOutlined />} title="Remove this cheque" onClick={() => remove(f.name)} />
                </div>
              ))}
              <Button size="small" icon={<PlusOutlined />} onClick={() => add({ checkNum: '', checkSum: 0 })}>
                Add Cheque
              </Button>
            </>
          )}
        </Form.List>
      ) : means.cheques.length === 0 ? (
        <div style={{ color: '#6a6d70' }}>No cheques</div>
      ) : (
        means.cheques.map((c) => (
          <div key={c.checkNum} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 32px', gap: 6, marginBottom: 4 }}>
            <span>{c.checkNum}</span>
            <span style={{ textAlign: 'right' }}>{money(c.checkSum)}</span>
            <span />
          </div>
        ))
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 32px', gap: 6, marginTop: 8, borderTop: '1px solid #e5e5e5', paddingTop: 6 }}>
        <span style={{ fontWeight: 600 }}>Total Cheques</span>
        <span style={{ textAlign: 'right', fontWeight: 600 }}>{money(chequeTotal)}</span>
        <span />
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title="Payment Means"
      width={620}
      // Above the receipt; a click outside doesn't close it (what was typed isn't lost)
      zIndex={1100}
      mask={{ closable: false }}
      onCancel={onCancel}
      forceRender
      footer={
        editing
          ? [
              <Button key="cancel" onClick={onCancel}>
                Cancel
              </Button>,
              <Button key="ok" type="primary" onClick={handleOk}>
                OK
              </Button>,
            ]
          : [
              <Button key="close" onClick={onCancel}>
                Close
              </Button>,
            ]
      }
    >
      <Form form={form} {...detailFormProps(editing, 130)} initialValues={EMPTY_MEANS}>
        <Tabs
          type="card"
          items={[
            { key: 'cheque', label: 'Cheque', forceRender: true, children: chequeTab },
            {
              key: 'transfer',
              label: 'Bank Transfer',
              forceRender: true,
              children: panel(
                <>
                  {/* The company's bank account the money went to (SAP house bank account) */}
                  <Form.Item label="Bank" name="trsfrBank">
                    {editing ? (
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder="Select the bank"
                        options={houseBanks.map((b) => ({
                          value: b.absEntry,
                          label: `${b.bankCode} - ${b.account}${b.bankName ? ` (${b.bankName})` : ''}`,
                        }))}
                      />
                    ) : (
                      <ReadOnlyText value={bankName(means.trsfrBank)} />
                    )}
                  </Form.Item>
                  {amount('trsfrSum')}
                </>
              ),
            },
            { key: 'credit', label: 'Credit Card', forceRender: true, children: panel(amount('creditSum')) },
            { key: 'cash', label: 'Cash', forceRender: true, children: panel(amount('cashSum')) },
          ]}
        />
        {/* Under the tabs, as in SAP B1: one bank charge for the whole payment, and the totals */}
        <div className={detailStyles.fields} style={{ marginTop: 12 }}>
          {amount('bcgSum', 'Bank Charge')}
          <Form.Item label="Total Paid">
            <ReadOnlyText value={money(paid)} />
          </Form.Item>
          <Form.Item label="Amount">
            <ReadOnlyText value={money(total)} />
          </Form.Item>
          {totalApplied !== undefined && (
            <Form.Item label="Total Applied">
              <ReadOnlyText value={money(totalApplied)} />
            </Form.Item>
          )}
        </div>
      </Form>
    </Modal>
  );
}
