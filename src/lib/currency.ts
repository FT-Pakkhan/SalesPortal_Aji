import { db } from './db';
import { sapTable } from './sapDb';
import { ValidationError } from './errors';

// Currencies as SAP B1 has them: the company's local currency (OADM.MainCurncy), the currencies (OCRN) and the daily
// exchange rates (ORTT). How a rate reads depends on OADM.DirectRate:
//   direct   ('Y'): 1 foreign = rate local   -> local = foreign x rate
//   indirect ('N'): 1 local = rate foreign   -> local = foreign / rate
// A document in the local currency has rate 1.

export interface CurrencySettings {
  /** The company's local currency, e.g. MYR */
  local: string;
  /** Direct rates (1 foreign = rate local) */
  direct: boolean;
}

/** SAP's "All currencies" business partner currency */
export const ALL_CURRENCIES = '##';

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export async function getCurrencySettings(): Promise<CurrencySettings> {
  const rows = await db.query<{ MainCurncy: string; DirectRate: string }>(
    `SELECT TOP 1 MainCurncy, DirectRate FROM ${sapTable('OADM')}`
  );
  return { local: (rows[0]?.MainCurncy ?? '').trim(), direct: rows[0]?.DirectRate === 'Y' };
}

/** 'YYYYMMDD' or 'YYYY-MM-DD' -> 'YYYYMMDD' */
const sqlDate = (date: string) => date.replace(/-/g, '');

/** dd.mm.yy, as the portal shows dates */
const shownDate = (date: string) => {
  const d = sqlDate(date);
  return `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(2, 4)}`;
};

/** SAP's rate of each currency on a date (missing or 0 = none); the local currency is always 1 */
export async function getRates(currencies: string[], date: string, settings?: CurrencySettings): Promise<Map<string, number>> {
  const s = settings ?? (await getCurrencySettings());
  const rates = new Map<string, number>([[s.local, 1]]);
  const wanted = [...new Set(currencies.filter((c) => c && c !== s.local))];
  if (wanted.length === 0) return rates;
  const rows = await db.query<{ Currency: string; Rate: number }>(
    `SELECT Currency, Rate FROM ${sapTable('ORTT')}
     WHERE RateDate = @date AND Rate <> 0 AND Currency IN (${wanted.map((_, i) => `@c${i}`).join(', ')})`,
    [{ name: 'date', value: sqlDate(date) }, ...wanted.map((c, i) => ({ name: `c${i}`, value: c }))]
  );
  for (const r of rows) rates.set(r.Currency.trim(), Number(r.Rate));
  return rates;
}

/** SAP's rate for a document in `currency` on `date`; refused when SAP has none, as SAP B1 does */
export async function getDocumentRate(currency: string, date: string, settings?: CurrencySettings): Promise<number> {
  const s = settings ?? (await getCurrencySettings());
  const rate = (await getRates([currency], date, s)).get(currency);
  if (!rate) {
    throw new ValidationError(`SAP has no ${currency} exchange rate for ${shownDate(date)}: enter it in SAP (Exchange Rates and Indexes) first`);
  }
  return rate;
}

/** An amount in a foreign currency (at `rate`) in the local currency */
export const toLocal = (amount: number, rate: number, direct: boolean) => (direct ? amount * rate : amount / rate);

/** An amount in the local currency in a foreign currency (at `rate`) */
export const fromLocal = (amount: number, rate: number, direct: boolean) => (direct ? amount / rate : amount * rate);

/**
 * An amount in currency `from` in currency `to`, through the local currency with each one's rate on the day.
 * Null when a rate is missing.
 */
export function convertAmount(amount: number, from: string, to: string, rates: Map<string, number>, settings: CurrencySettings): number | null {
  if (from === to) return amount;
  const fromRate = rates.get(from);
  const toRate = rates.get(to);
  if (!fromRate || !toRate) return null;
  return round(fromLocal(toLocal(amount, fromRate, settings.direct), toRate, settings.direct), 6);
}

/**
 * Rows with a price-list Price and its currency (PriceCur) -> the Price in `currency` at SAP's rates on `date`
 * (null when a rate is missing). No currency asked: unchanged.
 */
export async function pricesInCurrency<T extends { Price: number | null; PriceCur: string | null }>(
  rows: T[],
  currency: string | null,
  date: string | null
): Promise<T[]> {
  const target = (currency ?? '').trim().toUpperCase();
  if (!target || !date || !/^\d{4}-?\d{2}-?\d{2}$/.test(date)) return rows;
  const settings = await getCurrencySettings();
  const from = (r: T) => (r.PriceCur ?? '').trim() || settings.local;
  const rates = await getRates([target, ...rows.map(from)], date, settings);
  return rows.map((r) => ({
    ...r,
    Price: r.Price === null || r.Price === undefined ? null : convertAmount(Number(r.Price), from(r), target, rates, settings),
    PriceCur: target,
  }));
}

/** SQL: the company's local currency (OADM.MainCurncy), for documents saved before currencies (DocCur NULL) */
export const localCurrencySql = () => `(SELECT TOP 1 oa.MainCurncy FROM ${sapTable('OADM')} oa) COLLATE DATABASE_DEFAULT`;

/**
 * The currency a Temporary Receipt / Receipt Request is in: the one chosen, else the customer's default (the local one
 * for an "all currencies" or local-currency customer, or a typed name without a customer). As SAP allows it (tested
 * 2026-11-15: "The document currency does not match the business partner's currency"): a customer pays in its own
 * currency only; an "all currencies" customer (or no customer yet) in any SAP currency - e.g. USD paying MYR invoices
 * needs the customer set to All Currencies in SAP.
 */
export async function resolveReceiptCurrency(cardCode: string | null, chosen: string | null, settings?: CurrencySettings): Promise<string> {
  const s = settings ?? (await getCurrencySettings());
  const rules = cardCode ? await getCustomerCurrency(cardCode, s) : null;
  const defaultCurrency = rules?.defaultCurrency ?? s.local;
  const currency = (chosen ?? '').trim().toUpperCase() || defaultCurrency;
  if (currency === defaultCurrency) return currency;
  if (rules && rules.cardCurrency !== ALL_CURRENCIES) {
    throw new ValidationError(
      `This customer's currency in SAP is ${rules.cardCurrency}: the receipt must be in ${rules.cardCurrency} (to receive other currencies, set the customer to All Currencies in SAP)`
    );
  }
  const known = await db.query(`SELECT CurrCode FROM ${sapTable('OCRN')} WHERE CurrCode = @currency`, [{ name: 'currency', value: currency }]);
  if (known.length === 0) throw new ValidationError(`Currency ${currency} is not a currency in SAP`);
  return currency;
}

/**
 * A receipt / request's currency settled: SAP's rate for its Posting Date (1 for the local currency; `keep` = a
 * confirmed one keeps its currency and rate) and its Amount in the local currency (DocTotal) and in its own (DocTotalFC,
 * 0 when local).
 */
export async function settleReceiptCurrency(
  cardCode: string | null,
  chosen: string | null,
  docDate: string,
  amount: number,
  keep?: { docCur: string; docRate: number }
): Promise<{ docCur: string; docRate: number; docTotalLC: number; docTotalFC: number }> {
  const s = await getCurrencySettings();
  const docCur = await resolveReceiptCurrency(cardCode, chosen, s);
  if (keep && docCur !== keep.docCur) throw new ValidationError("Currency can't be changed after confirming");
  if (docCur === s.local) return { docCur, docRate: 1, docTotalLC: amount, docTotalFC: 0 };
  const docRate = keep ? keep.docRate : await getDocumentRate(docCur, docDate, s);
  return { docCur, docRate, docTotalLC: round(toLocal(amount, docRate, s.direct), 2), docTotalFC: amount };
}

export interface CustomerCurrency {
  /** The customer's currency in SAP (OCRD.Currency), '##' = all currencies; the local currency for a lead */
  cardCurrency: string;
  /** What a new document starts with: the local currency for "all currencies" / local customers, else their own */
  defaultCurrency: string;
  /** The user may choose another currency ("all currencies" customers only) */
  changeable: boolean;
}

/** A customer's (or lead's) currency rules; null when it is neither */
export async function getCustomerCurrency(cardCode: string, settings?: CurrencySettings): Promise<CustomerCurrency | null> {
  const s = settings ?? (await getCurrencySettings());
  const rows = await db.query<{ Currency: string | null }>(
    `SELECT c.Currency FROM ${sapTable('OCRD')} c WHERE c.CardCode = @cardCode`,
    [{ name: 'cardCode', value: cardCode }]
  );
  if (rows.length === 0) {
    // A lead: its own currency (local when none)
    const lead = await db.query<{ Currency: string | null }>(`SELECT Currency FROM FTS11LEAD WHERE LeadCode = @cardCode`, [{ name: 'cardCode', value: cardCode }]);
    if (lead.length === 0) return null;
    const own = (lead[0].Currency ?? '').trim() || s.local;
    return { cardCurrency: own, defaultCurrency: own, changeable: false };
  }
  const own = (rows[0].Currency ?? '').trim() || s.local;
  const all = own === ALL_CURRENCIES;
  return { cardCurrency: own, defaultCurrency: all ? s.local : own, changeable: all };
}

/**
 * The currency a document of this customer is saved in: the one chosen (an "all currencies" customer: any SAP
 * currency), else the customer's default. Refused when the customer can't use it, as SAP B1 does.
 */
export async function resolveDocumentCurrency(cardCode: string, chosen: string | null, settings?: CurrencySettings): Promise<string> {
  const s = settings ?? (await getCurrencySettings());
  const rules = await getCustomerCurrency(cardCode, s);
  if (!rules) return s.local;
  const currency = (chosen ?? '').trim().toUpperCase() || rules.defaultCurrency;
  if (currency === rules.defaultCurrency) return currency;
  if (!rules.changeable) {
    throw new ValidationError(`This customer's currency in SAP is ${rules.cardCurrency}: the document must be in ${rules.defaultCurrency}`);
  }
  const known = await db.query(`SELECT CurrCode FROM ${sapTable('OCRN')} WHERE CurrCode = @currency`, [{ name: 'currency', value: currency }]);
  if (known.length === 0) throw new ValidationError(`Currency ${currency} is not a currency in SAP`);
  return currency;
}
