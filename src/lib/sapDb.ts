// Read access to the SAP B1 company database (same SQL Server as the portal).
// Queries use three-part names, e.g. `${sapTable('OCRD')}` -> [SBODemoGB].dbo.[OCRD].
import { companySapDatabase, isMultiCompany } from './companyContext';
import { db } from './db';

/**
 * SAP B1 company database name: SAP_DB_NAME in .env.local; with several companies, the chosen company's SAP Database
 * in its General Settings (SAP_DB_NAME if that is empty)
 */
export function sapDatabase(): string {
  const name = (isMultiCompany() && companySapDatabase()) || process.env.SAP_DB_NAME || '';
  // Only letters, digits, _ and - : the name is placed into SQL text, so anything else is refused
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(
      isMultiCompany()
        ? 'The SAP Database of this company is not set: fill it in General Settings > SAP DI API, then log in again'
        : 'SAP_DB_NAME is not set or not valid in .env.local'
    );
  }
  return name;
}

/** Fully qualified name of a SAP B1 table, e.g. sapTable('OCRD') -> [SBODemoGB].dbo.[OCRD] */
export function sapTable(table: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error(`Invalid SAP table name: ${table}`);
  return `[${sapDatabase()}].dbo.[${table}]`;
}

/**
 * `alias.column` when the SAP table has that column, else `fallback` — for a UDF (e.g. OCRD.U_CustType) that a
 * company database may not have: a query naming a missing column fails as a whole
 */
export async function sapColumnOr(table: string, column: string, alias: string, fallback = 'NULL'): Promise<string> {
  if (!/^[A-Za-z0-9_]+$/.test(column)) throw new Error(`Invalid SAP column name: ${column}`);
  const found = await db.query<{ Found: number | null }>(`SELECT COL_LENGTH(@table, @column) AS Found`, [
    { name: 'table', value: `${sapDatabase()}.dbo.${table}` },
    { name: 'column', value: column },
  ]);
  return found[0]?.Found ? `${alias}.[${column}]` : fallback;
}
