import { db } from './db';
import { sapDatabase } from './sapDb';
import { ValidationError } from './errors';

// Bank Info: SAP's user table @SELLERBANK (Seller Bank: Code, Name), chosen on a sales document's header (BankInfo)
// and posted into the SAP document's header UDF U_BankInfo (sapPosting.ts). A company database without the table
// offers none.

/** [SAPDB].dbo.[@SELLERBANK] */
const udtTable = () => `[${sapDatabase()}].dbo.[@SELLERBANK]`;

async function udtExists(): Promise<boolean> {
  const rows = await db.query<{ Id: number | null }>(`SELECT OBJECT_ID(@name) AS Id`, [{ name: 'name', value: udtTable() }]);
  return rows[0]?.Id != null;
}

/** The Seller Banks (Code, Name), by Code; none when the company database has no such table */
export async function getSellerBanks(): Promise<{ Code: string; Name: string | null }[]> {
  if (!(await udtExists())) return [];
  return db.query(`SELECT Code, Name FROM ${udtTable()} ORDER BY Code`);
}

/** A Bank Info must be one of the table's Codes */
export async function assertSellerBank(code: string | null): Promise<void> {
  if (code === null) return;
  if (!(await udtExists())) throw new ValidationError('SAP has no Seller Bank table (@SELLERBANK)');
  const found = await db.query(`SELECT Code FROM ${udtTable()} WHERE Code = @code`, [{ name: 'code', value: code }]);
  if (found.length === 0) throw new ValidationError(`Bank Info ${code} is not in SAP's Seller Bank table`);
}
