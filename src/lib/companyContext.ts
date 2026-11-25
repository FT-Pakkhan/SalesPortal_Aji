import { AsyncLocalStorage } from 'node:async_hooks';

// Several companies: with DB_COMMON set, the companies are listed in that database's ODBC table and the user chooses
// one at login. The chosen company travels in the login token; every request runs in it (its portal database, and
// the SAP database from its General Settings). Without DB_COMMON the portal has one company: DB_DATABASE / SAP_DB_NAME.

/** The database listing the companies (ODBC table); empty = one company */
export const COMMON_DATABASE = process.env.DB_COMMON || '';

export const isMultiCompany = (): boolean => !!COMMON_DATABASE;

/** The company a request works in */
export interface CompanyContext {
  /** Its portal database (ODBC.[Database]) */
  database: string;
  /** Its SAP company database (General Settings > SAP Database when the user logged in); null = not set */
  sapDatabase: string | null;
}

const store = new AsyncLocalStorage<CompanyContext>();

/** The rest of this request runs in `company` (called once its login token is checked) */
export function enterCompany(company: CompanyContext): void {
  store.enterWith(company);
}

/** Run `work` in `company` (e.g. the login, before there is a token) */
export function runInCompany<T>(company: CompanyContext, work: () => Promise<T>): Promise<T> {
  return store.run(company, work);
}

/** The company this request works in; undefined before login (or with one company) */
export function currentCompany(): CompanyContext | undefined {
  return store.getStore();
}

// SAP Database changed in General Settings since users logged in: used instead of the one in their token
const globalForSap = globalThis as unknown as { sapDatabaseChanged?: Map<string, string> };
const sapDatabaseChanged = (globalForSap.sapDatabaseChanged ??= new Map<string, string>());

/** General Settings saved with this SAP Database for the current company */
export function rememberSapDatabase(name: string | null): void {
  const company = currentCompany();
  if (company && name) sapDatabaseChanged.set(company.database, name);
}

/** The current company's SAP database (several companies only): as last saved in General Settings, else from the login */
export function companySapDatabase(): string | null {
  const company = currentCompany();
  if (!company) return null;
  return sapDatabaseChanged.get(company.database) ?? company.sapDatabase;
}
