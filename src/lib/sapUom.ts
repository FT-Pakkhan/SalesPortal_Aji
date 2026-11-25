import { sapTable } from './sapDb';
import { ValidationError } from './errors';

// A document line's UoM (free text in the portal, e.g. "Carton" or SAP's name "6 Pack") read against SAP B1:
// an item with a UoM group must use one of its group's units (by code or name); a manual-UoM item takes any text.

/**
 * SQL columns for a line `l` (with UomCode, ItemCode) joined to SAP's item `i` (OITM, see uomItemJoin):
 * UomCode (trimmed, NULL when empty), UgpEntry, UomEntry (the matching unit of the item's group, or NULL),
 * GroupUoms (the group's unit codes, for the message) and NumPerMsr (stock units in one of this unit; 1 if none).
 */
export const uomColumns = (l: string, i: string) => {
  const uom = `LTRIM(RTRIM(${l}.UomCode)) COLLATE DATABASE_DEFAULT`;
  const groupUnit = `FROM ${sapTable('UGP1')} g JOIN ${sapTable('OUOM')} o ON o.UomEntry = g.UomEntry
             WHERE g.UgpEntry = ${i}.UgpEntry AND (o.UomCode = ${uom} OR o.UomName = ${uom})`;
  return `NULLIF(LTRIM(RTRIM(${l}.UomCode)), '') AS UomCode, ${i}.UgpEntry,
            (SELECT TOP 1 o.UomEntry ${groupUnit}) AS UomEntry,
            (SELECT STRING_AGG(o.UomCode, ', ') FROM ${sapTable('UGP1')} g JOIN ${sapTable('OUOM')} o ON o.UomEntry = g.UomEntry
             WHERE g.UgpEntry = ${i}.UgpEntry) AS GroupUoms`;
};

/**
 * Inventory units (the item's IUoMEntry, which SAP's stock and inventory transfers count in) in one of the line's
 * unit: e.g. 1 Carton = 24 Pack. From UGP1 (BaseQty / AltQty, base units per unit) of the line's unit over the
 * inventory unit's. 1 for a manual-UoM item, an empty or unknown unit.
 */
export const uomFactor = (l: string, i: string) => {
  const uom = `LTRIM(RTRIM(${l}.UomCode)) COLLATE DATABASE_DEFAULT`;
  const baseUnits = (match: string) =>
    `(SELECT TOP 1 g.BaseQty / NULLIF(g.AltQty, 0) FROM ${sapTable('UGP1')} g JOIN ${sapTable('OUOM')} o ON o.UomEntry = g.UomEntry
      WHERE g.UgpEntry = ${i}.UgpEntry AND ${i}.UgpEntry <> -1 AND ${match})`;
  return `ISNULL(${baseUnits(`(o.UomCode = ${uom} OR o.UomName = ${uom})`)} / NULLIF(${baseUnits(`g.UomEntry = ${i}.IUoMEntry`)}, 0), 1)`;
};

/**
 * SQL for the price list a document's items are priced from: the customer `c`'s own (OCRD.ListNum), or else, for a
 * lead or no customer yet, the Default Price List in General Settings (FTS11OADM.DefaultPriceList)
 */
export const priceListSql = (c: string) =>
  `COALESCE(${c}.ListNum, (SELECT a.DefaultPriceList FROM FTS11OADM a WHERE a.DocEntry = 1))`;

/**
 * SQL for item `i`'s price in unit `uomEntry` (an SQL expression) from price-list row `p` (ITM1) of the price list of
 * customer `c` (priceListSql), as SAP B1 prices it: the price set for that unit in the price list (ITM9), else the list
 * price (which is per the item's pricing unit, OITM.PriceUnit) x base units in the unit / base units in the pricing
 * unit. A manual-UoM item: the list price. NULL when the price list has no price for the item.
 */
export const uomPriceSql = (i: string, p: string, c: string, uomEntry: string) => {
  const baseUnits = (entry: string) =>
    `(SELECT TOP 1 g.BaseQty / NULLIF(g.AltQty, 0) FROM ${sapTable('UGP1')} g WHERE g.UgpEntry = ${i}.UgpEntry AND g.UomEntry = ${entry})`;
  return `CASE WHEN ${i}.UgpEntry = -1 OR ${uomEntry} IS NULL THEN ${p}.Price
               ELSE COALESCE((SELECT TOP 1 x.Price FROM ${sapTable('ITM9')} x
                              WHERE x.ItemCode = ${i}.ItemCode AND x.PriceList = ${priceListSql(c)} AND x.UomEntry = ${uomEntry}),
                             ${p}.Price * ISNULL(${baseUnits(uomEntry)} / NULLIF(${baseUnits(`${i}.PriceUnit`)}, 0), 1)) END`;
};

/**
 * SQL for the currency of the price uomPriceSql gives: the unit's own price's currency (ITM9) when it has one, else the
 * price list price's (ITM1.Currency). NULL when there is no price.
 */
export const uomPriceCurrencySql = (i: string, p: string, c: string, uomEntry: string) =>
  `CASE WHEN ${i}.UgpEntry = -1 OR ${uomEntry} IS NULL THEN ${p}.Currency
        ELSE COALESCE((SELECT TOP 1 x.Currency FROM ${sapTable('ITM9')} x
                       WHERE x.ItemCode = ${i}.ItemCode AND x.PriceList = ${priceListSql(c)} AND x.UomEntry = ${uomEntry}),
                      ${p}.Currency) END`;

/** SAP's item for line `l`, as `i` */
export const uomItemJoin = (l: string, i: string) =>
  `LEFT JOIN ${sapTable('OITM')} ${i} ON ${i}.ItemCode = ${l}.ItemCode COLLATE DATABASE_DEFAULT`;

interface UomRow {
  ItemCode?: unknown;
  UomCode?: unknown;
  UgpEntry?: unknown;
  UomEntry?: unknown;
  GroupUoms?: unknown;
}

const usesGroup = (l: UomRow) => l.UgpEntry !== null && l.UgpEntry !== undefined && Number(l.UgpEntry) !== -1;

/** Refuse a line whose unit isn't in its item's UoM group */
export function assertUomsValid(lines: UomRow[]): void {
  const bad = lines.find((l) => l.UomCode && usesGroup(l) && (l.UomEntry === null || l.UomEntry === undefined));
  if (bad) {
    throw new ValidationError(`UoM "${bad.UomCode}" is not in item ${bad.ItemCode}'s UoM group in SAP (use one of: ${bad.GroupUoms})`);
  }
}

/** What DI API gets for the line: uomEntry (UoM group item) or measureUnit (manual UoM); both null = SAP's default */
export const uomForDi = (l: UomRow) => ({
  uomEntry: l.UomCode && usesGroup(l) ? l.UomEntry : null,
  measureUnit: l.UomCode && !usesGroup(l) ? l.UomCode : null,
});
