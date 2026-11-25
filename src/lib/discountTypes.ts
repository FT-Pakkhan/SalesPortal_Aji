import { db } from './db';
import { sapDatabase } from './sapDb';
import { ValidationError } from './errors';

// Discount Types: SAP's user table @DISCOUNTTYPE (Code, Name). A sales document's header has five of them
// (DiscType1 .. DiscType5), all from the same table, each one at most once; posted into the SAP document's header
// UDFs U_DiscType1 .. U_DiscType5 (sapPosting.ts). A company database without the table offers none.

/** The user table's name in SAP (without the @) */
const UDT = 'DISCOUNTTYPE';

/** [SAPDB].dbo.[@DISCOUNTTYPE] */
const udtTable = () => `[${sapDatabase()}].dbo.[@${UDT}]`;

async function udtExists(): Promise<boolean> {
  const rows = await db.query<{ Id: number | null }>(`SELECT OBJECT_ID(@name) AS Id`, [{ name: 'name', value: `[${sapDatabase()}].dbo.[@${UDT}]` }]);
  return rows[0]?.Id != null;
}

/** The Discount Types (Code, Name), by Code; none when the company database has no such table */
export async function getDiscountTypes(): Promise<{ Code: string; Name: string | null }[]> {
  if (!(await udtExists())) return [];
  return db.query(`SELECT Code, Name FROM ${udtTable()} ORDER BY Code`);
}

/** A document's Discount Type 1 .. 5, in order */
export const discountTypesOf = (f: {
  discType1: string | null;
  discType2: string | null;
  discType3: string | null;
  discType4: string | null;
  discType5: string | null;
}): (string | null)[] => [f.discType1, f.discType2, f.discType3, f.discType4, f.discType5];

/**
 * Discount Type 1 .. 5: the same one can't be chosen twice, and each must be one of the table's Codes. `saved` (the
 * document's values as saved): a value kept where it was isn't looked up again.
 */
export async function assertDiscountTypes(codes: (string | null)[], saved: (string | null)[] = []): Promise<void> {
  const seen = new Map<string, number>();
  codes.forEach((code, i) => {
    if (code === null) return;
    const key = code.trim().toUpperCase();
    const first = seen.get(key);
    if (first !== undefined) throw new ValidationError(`Discount Type ${i + 1} is the same as Discount Type ${first + 1} (${code})`);
    seen.set(key, i);
  });
  const toCheck = codes.filter((code, i): code is string => code !== null && code !== saved[i]);
  if (toCheck.length === 0) return;
  if (!(await udtExists())) throw new ValidationError('SAP has no Discount Type table (@DISCOUNTTYPE)');
  const found = await db.query<{ Code: string }>(
    `SELECT Code FROM ${udtTable()} WHERE Code IN (${toCheck.map((_, i) => `@c${i}`).join(', ')})`,
    toCheck.map((code, i) => ({ name: `c${i}`, value: code }))
  );
  const known = new Set(found.map((r) => r.Code.toUpperCase()));
  const missing = toCheck.find((code) => !known.has(code.toUpperCase()));
  if (missing) throw new ValidationError(`Discount Type ${missing} is not in SAP's Discount Type table`);
}
