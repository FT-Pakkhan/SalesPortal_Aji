'use client';

import React from 'react';
import { Form, Input, Select } from 'antd';
import { ReadOnlyText } from '@/components/ui/DetailView';
import detailStyles from '@/components/ui/DetailView.module.css';
import type { SapCurrencies } from '@/types';

/** A rate as SAP shows it: up to 6 decimals */
const formatRate = (rate: number) => Number(rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** An amount in a foreign currency at `rate` in the local currency (null without a rate) */
export const toLocalAmount = (amount: number, rate: number | null | undefined, direct: boolean | undefined) =>
  rate ? Math.round((direct ? amount * rate : amount / rate) * 100) / 100 : null;

/**
 * The currencies a receipt / request may be in, as SAP allows: a customer's own currency only; an "all currencies"
 * customer (or no customer yet) any
 */
export function receiptCurrencyOptions(currencies: SapCurrencies | null, cardCurrency: string | null | undefined) {
  const all = currencies?.currencies ?? [];
  const own = (cardCurrency ?? '').trim();
  const limited = own && own !== '##';
  return all
    .filter((c) => !limited || c.code === own)
    .map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }));
}

interface CurrencyFieldProps {
  editing: boolean;
  /** The currency can be chosen now (a draft without lines) */
  changeable: boolean;
  /** The currency shown */
  currency: string;
  isForeign: boolean;
  /** SAP's rate for the Posting Date (a confirmed document: its own); none = SAP has no rate that day */
  rate: number | null | undefined;
  /** The Posting Date as shown, for the "no rate" message */
  dateText: string;
  options: { value: string; label: string }[];
}

/**
 * Currency row of a receipt / request (form field "docCur"): the currency, and beside it SAP's rate for the Posting
 * Date (a foreign currency only), or a red note when SAP has none that day (it can't be saved then)
 */
export function CurrencyField({ editing, changeable, currency, isForeign, rate, dateText, options }: CurrencyFieldProps) {
  return (
    <Form.Item label="Currency">
      <div className={detailStyles.pair}>
        <Form.Item name="docCur" noStyle>
          {editing && changeable ? (
            <Select showSearch optionFilterProp="label" options={options} popupMatchSelectWidth={false} />
          ) : editing ? (
            <LockedText text={currency} />
          ) : (
            <ReadOnlyText value={currency} />
          )}
        </Form.Item>
        {isForeign &&
          (rate ? (
            editing ? (
              <Input value={`Rate ${formatRate(rate)}`} disabled />
            ) : (
              <ReadOnlyText value={`Rate ${formatRate(rate)}`} />
            )
          ) : (
            <span style={{ color: '#bb0000' }}>No SAP rate for {dateText || 'the Posting Date'}</span>
          ))}
      </div>
    </Form.Item>
  );
}

/** Greyed-out box showing `text` (ignores the value Form.Item passes) */
function LockedText({ text }: { text: string; value?: unknown }) {
  return <Input value={text} disabled />;
}
