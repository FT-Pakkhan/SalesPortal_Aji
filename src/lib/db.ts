import sql from 'mssql';
import { AuthError } from './auth';
import { COMMON_DATABASE, currentCompany, isMultiCompany } from './companyContext';
import { decryptSecret } from './secretBox';

/** Where a portal database is and the SQL login used for it */
interface DbConnection {
  server: string;
  /** None for a named instance (name\instance) */
  port?: number;
  database: string;
  user: string;
  password: string;
}

/** From .env.local / portal.env: the one company's database, or (several companies) the server and login of DB_COMMON */
const envConnection: DbConnection = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'Portal_Sales_AJI',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  port: parseInt(process.env.DB_PORT || '1433'),
};

function poolConfig(c: DbConnection): sql.config {
  return {
    server: c.server,
    database: c.database,
    user: c.user,
    password: c.password,
    port: c.port,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      useUTC: false,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 10000,
    requestTimeout: 15000,
  };
}

// ---------------------------------------------------------------------------
// Several companies: the ODBC table of DB_COMMON

/** One company of the ODBC table */
export interface Company {
  database: string;
  name: string;
  connection: DbConnection;
}

interface OdbcRow {
  DbName: string;
  CompnyName: string;
  ServerName: string;
  DBUserId: string | null;
  DBPassword: string | null;
}

/** "name", "name\instance" or "name,port" */
function parseServer(server: string): { server: string; port?: number } {
  const [name, port] = server.split(',');
  if (port) return { server: name.trim(), port: parseInt(port) };
  // A named instance: SQL Browser gives its port
  return { server: name.trim(), port: name.includes('\\') ? undefined : 1433 };
}

/** A password kept encrypted (v1:..., like General Settings' passwords) or as typed */
const readPassword = (stored: string | null) => (stored?.startsWith('v1:') ? decryptSecret(stored) : stored ?? '');

// The list is read again after a minute, so a company added to ODBC shows without restarting the portal
const COMPANIES_FOR_MS = 60 * 1000;
const globalForCompanies = globalThis as unknown as { companies?: { at: number; list: Company[] } };

/** The companies of the ODBC table, by name */
export async function listCompanies(): Promise<Company[]> {
  const cached = globalForCompanies.companies;
  if (cached && Date.now() - cached.at < COMPANIES_FOR_MS) return cached.list;
  const rows = await queryOn<OdbcRow>(
    { ...envConnection, database: COMMON_DATABASE },
    `SELECT T0.[Database] AS DbName, T0.CompnyName, T0.[Server] AS ServerName, T0.DBUserId, T0.DBPassword
     FROM ODBC T0
     ORDER BY T0.CompnyName`
  );
  const list = rows.map((r) => ({
    database: r.DbName,
    name: r.CompnyName,
    connection: {
      ...parseServer(r.ServerName),
      database: r.DbName,
      // No login of its own: the one in portal.env
      user: r.DBUserId || envConnection.user,
      password: r.DBUserId ? readPassword(r.DBPassword) : envConnection.password,
    },
  }));
  globalForCompanies.companies = { at: Date.now(), list };
  return list;
}

/** A company of the ODBC table by its database; null if it isn't (or no longer) there */
export async function findCompany(database: string): Promise<Company | null> {
  return (await listCompanies()).find((c) => c.database.toLowerCase() === database.toLowerCase()) ?? null;
}

/** The portal database this request uses: the company's chosen at login, or the one company's */
async function currentConnection(): Promise<DbConnection> {
  if (!isMultiCompany()) return envConnection;
  const chosen = currentCompany();
  if (!chosen) throw new AuthError('No company chosen - please log in again');
  const company = await findCompany(chosen.database);
  if (!company) throw new AuthError(`The company database ${chosen.database} is no longer in the company list`);
  return company.connection;
}

/** Where the current portal database is, for programs that connect on their own (e.g. Crystal Reports layouts) */
export async function portalDbLogon() {
  const c = await currentConnection();
  return {
    server: c.port && c.port !== 1433 ? `${c.server},${c.port}` : c.server,
    database: c.database,
    user: c.user,
    password: c.password,
  };
}

// ---------------------------------------------------------------------------
// Connection pools: one per database (and login)

// Use globalThis to persist pools across hot-reloads in dev
const globalForDb = globalThis as unknown as { dbPools?: Map<string, Promise<sql.ConnectionPool>> };
const pools = (globalForDb.dbPools ??= new Map<string, Promise<sql.ConnectionPool>>());

const poolKey = (c: DbConnection) => [c.server, c.port, c.database, c.user, c.password].join('|');

async function closePool(pool: sql.ConnectionPool | null): Promise<void> {
  if (!pool) return;
  try { await pool.close(); } catch { /* ignore close errors on stale pool */ }
}

/** Forget a pool (it is made again on the next query) */
async function dropPool(key: string): Promise<void> {
  const stale = pools.get(key);
  pools.delete(key);
  await closePool(await stale?.catch(() => null) ?? null);
}

async function poolFor(c: DbConnection): Promise<sql.ConnectionPool> {
  const key = poolKey(c);
  const existing = pools.get(key);
  if (existing) {
    const pool = await existing.catch(() => null);
    if (pool && pool.connected && !pool.connecting) return pool;
    // Pool failed, disconnected or stuck connecting — tear down and recreate
    if (pools.get(key) === existing) await dropPool(key);
    else return poolFor(c);
  }

  const pool = new sql.ConnectionPool(poolConfig(c));
  // Auto-reset pool on connection errors so next query gets a fresh pool
  pool.on('error', (err: Error) => {
    console.error('[DB] Pool connection error, will reconnect on next query:', err.message);
    if (pools.get(key)) void dropPool(key);
  });
  const connecting = pool.connect();
  pools.set(key, connecting);
  try {
    return await connecting;
  } catch (err) {
    if (pools.get(key) === connecting) pools.delete(key);
    throw err;
  }
}

export async function getPool(): Promise<sql.ConnectionPool> {
  return poolFor(await currentConnection());
}

/** Retry a DB operation once on connection failure (stale pool recovery) */
async function withRetry<T>(c: DbConnection, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isConnectionError = /ECONN|ESOCKET|ETIMEOUT|connection.*closed|connection.*lost|not connected|pool.*destroyed/i.test(msg);
    if (!isConnectionError) throw err;

    // Connection-level failure — reset pool and retry once
    console.warn('[DB] Connection error, retrying with fresh pool:', msg);
    await dropPool(poolKey(c));
    return await operation();
  }
}

interface QueryParam {
  name: string;
  /** e.g. sql.Int, or sql.NVarChar(50) — give text types a length, or they are 1 character */
  type?: sql.ISqlTypeFactoryWithNoParams | sql.ISqlType;
  value: unknown;
}

async function queryOn<T>(c: DbConnection, queryText: string, params: QueryParam[] = []): Promise<T[]> {
  return withRetry(c, async () => {
    const p = await poolFor(c);
    const request = p.request();
    for (const param of params) {
      if (param.type) request.input(param.name, param.type, param.value);
      else request.input(param.name, param.value);
    }
    const result = await request.query(queryText);
    return result.recordset as T[];
  });
}

export const db = {
  async query<T = Record<string, unknown>>(
    queryText: string,
    params: QueryParam[] = [],
    transaction?: sql.Transaction
  ): Promise<T[]> {
    // Transactions can't be retried — they're tied to a specific connection
    if (transaction) {
      const request = new sql.Request(transaction);
      for (const param of params) {
        if (param.type) request.input(param.name, param.type, param.value);
        else request.input(param.name, param.value);
      }
      const result = await request.query(queryText);
      return result.recordset as T[];
    }

    return queryOn<T>(await currentConnection(), queryText, params);
  },

  async beginTransaction(): Promise<sql.Transaction> {
    const p = await getPool();
    const transaction = new sql.Transaction(p);
    await transaction.begin();
    return transaction;
  },

  async commitTransaction(transaction: sql.Transaction): Promise<void> {
    await transaction.commit();
  },

  async rollbackTransaction(transaction: sql.Transaction): Promise<void> {
    await transaction.rollback();
  },
};
