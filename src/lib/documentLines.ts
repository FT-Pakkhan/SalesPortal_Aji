// Line calculations for sales documents, the way SAP B1 does them:
//   Price after Discount = Unit Price x (1 - Discount % / 100)
//   Total (LC)           = Price after Discount x Quantity   (before tax)
// Typing Price after Discount instead works the Discount % out backwards.
// Document totals (footer): see calcDocTotals.

import type { SalesDocumentLine, SapItemUom } from '@/types';

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Which value the user just changed, so the others follow from it */
export type LineChange = 'quantity' | 'priceBefDi' | 'discPrcnt' | 'price' | 'other';

/**
 * Recalculate Price after Discount, Discount % and Total after one value changed.
 * A FOC (free of charge) line is always Unit Price 0, no discount, Total 0.
 */
export function recalcLine(line: SalesDocumentLine, changed: LineChange): SalesDocumentLine {
  const quantity = Number(line.quantity) || 0;
  const unitPrice = line.isFoc ? 0 : Number(line.priceBefDi) || 0;
  let discount = line.isFoc ? 0 : Number(line.discPrcnt) || 0;
  let price = line.isFoc ? 0 : Number(line.price) || 0;

  if (changed === 'price') {
    // Price after Discount typed: work out the discount from the unit price
    discount = unitPrice > 0 ? round((1 - price / unitPrice) * 100, 6) : 0;
  } else {
    price = round(unitPrice * (1 - discount / 100), 6);
  }

  return {
    ...line,
    quantity,
    priceBefDi: unitPrice,
    discPrcnt: discount,
    price,
    lineTotal: round(price * quantity, 2),
  };
}

/** Sales Type EXPORT (FTS_vw_SalesTyp.Code): the lines show Export Qty / Export UoM / Export Unit Price */
export const SALES_TYPE_EXPORT = 'EX';

/**
 * Export Unit Price (per Export UoM) filled in: Unit Price = Export Unit Price x Export Qty / Quantity, e.g.
 * 200 x 2 MT / 100 CTN = 4; Price after Discount and Total follow. Only when all three are more than 0 and the line
 * isn't FOC; otherwise the line is given back as it is. The Unit Price can still be typed over afterwards.
 */
export function withExportPrice(line: SalesDocumentLine): SalesDocumentLine {
  const quantity = Number(line.quantity) || 0;
  const exportQty = Number(line.salesQty) || 0;
  const exportPrice = Number(line.salesPrice) || 0;
  if (line.isFoc || !(quantity > 0 && exportQty > 0 && exportPrice > 0)) return line;
  return recalcLine({ ...line, priceBefDi: round((exportPrice * exportQty) / quantity, 6) }, 'priceBefDi');
}

/** The line fields whose change works the Unit Price out from the Export Unit Price */
export const EXPORT_PRICE_FIELDS = ['quantity', 'salesQty', 'salesPrice'];

/**
 * Tick / untick FOC on a line. Ticked: Unit Price 0 (the price before is remembered on screen); unticked: that price
 * comes back (a line saved as FOC earlier has none remembered: its Unit Price stays 0 to be typed).
 */
export function setFoc(line: SalesDocumentLine, isFoc: boolean): SalesDocumentLine {
  if (isFoc) return recalcLine({ ...line, isFoc: true, focPrevPrice: line.isFoc ? line.focPrevPrice : Number(line.priceBefDi) || 0 }, 'priceBefDi');
  return recalcLine({ ...line, isFoc: false, priceBefDi: line.isFoc ? line.focPrevPrice ?? 0 : line.priceBefDi, focPrevPrice: null }, 'priceBefDi');
}

/** The unit of an item's UoM Group with this code (or SAP name, as older lines may hold) */
export const findUom = (uoms: SapItemUom[] | undefined, code: string | null | undefined) =>
  code ? uoms?.find((u) => u.uomCode === code || u.uomName === code) : undefined;

/**
 * Another UoM chosen for a line (`fromCode` = the unit it had): the Unit Price becomes the price-list price in that
 * unit, as in SAP B1. Without a price-list price the old price is scaled by the units' sizes (1 Pack 10 -> 1 Carton of
 * 24 Packs 240). A FOC line stays at 0 and only remembers the new price.
 */
export function lineWithUom(line: SalesDocumentLine, uoms: SapItemUom[] | undefined, fromCode: string | null): SalesDocumentLine {
  const to = findUom(uoms, line.uomCode);
  if (!to) return recalcLine(line, 'other');
  const from = findUom(uoms, fromCode);
  const oldPrice = line.isFoc ? Number(line.focPrevPrice) || 0 : Number(line.priceBefDi) || 0;
  const price =
    to.price ?? (from?.factor && to.factor ? round((oldPrice * to.factor) / from.factor, 6) : oldPrice);
  const withCode = { ...line, uomCode: to.uomCode };
  // An Export Unit Price filled in still decides the Unit Price
  return line.isFoc
    ? recalcLine({ ...withCode, focPrevPrice: price }, 'priceBefDi')
    : withExportPrice(recalcLine({ ...withCode, priceBefDi: price }, 'priceBefDi'));
}

/** Document totals, as in the footer of an SAP B1 sales document */
export interface DocTotals {
  /** Sum of the lines' Total (LC) */
  totalBefDisc: number;
  /** Document discount % */
  discPrcnt: number;
  /** Document discount amount */
  discSum: number;
  /** Tax after the document discount */
  vatSum: number;
  /** Total Before Discount - Discount + Tax */
  docTotal: number;
}

/**
 * Work out the document totals from the lines and the discount.
 * The discount is given either as a % (`by: 'prcnt'`) or as an amount (`by: 'sum'`); the other one is
 * calculated from it. Each line's tax is on its total after the document discount, rounded per line as SAP does.
 */
export function calcDocTotals(
  lines: Pick<SalesDocumentLine, 'lineTotal' | 'vatPrcnt'>[],
  discount: { by: 'prcnt' | 'sum'; value: number }
): DocTotals {
  const totalBefDisc = round(lines.reduce((sum, line) => sum + (Number(line.lineTotal) || 0), 0), 2);

  let discPrcnt: number;
  let discSum: number;
  if (discount.by === 'sum') {
    discSum = Math.min(Math.max(round(Number(discount.value) || 0, 2), 0), totalBefDisc);
    discPrcnt = totalBefDisc > 0 ? round((discSum / totalBefDisc) * 100, 6) : 0;
  } else {
    discPrcnt = Math.min(Math.max(Number(discount.value) || 0, 0), 100);
    discSum = round((totalBefDisc * discPrcnt) / 100, 2);
  }

  const vatSum = round(
    lines.reduce(
      (sum, line) =>
        sum + round((Number(line.lineTotal) || 0) * (1 - discPrcnt / 100) * ((Number(line.vatPrcnt) || 0) / 100), 2),
      0
    ),
    2
  );

  return { totalBefDisc, discPrcnt, discSum, vatSum, docTotal: round(totalBefDisc - discSum + vatSum, 2) };
}

/** Positions 0, 1, 2 ... (VisOrder) in the lines' current order; LineNum, the line's permanent key, stays as it is */
export function renumberLines(lines: SalesDocumentLine[]): SalesDocumentLine[] {
  return lines.map((line, index) => (line.visOrder === index ? line : { ...line, visOrder: index }));
}
