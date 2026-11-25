import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { runListQuery } from '@/lib/reports';

// POST /api/report-settings/test-query - { query, useSapConn }: run a choose-from-list query (always rolled back) and return
// its columns and rows as they came. Column names are kept as written (not camel-cased) under columns / rows.
export async function POST(request: NextRequest) {
  try {
    authenticateRequest(request);
    const body = await request.json();
    // useSapConn: as the report's Use SAP DB Connection tick on the screen (the SAP company database, else the portal's)
    const result = await runListQuery(String(body.query ?? ''), body.useSapConn === true);
    // Rows as arrays, so successResponse's camel-casing can't rename the query's own column names
    return successResponse({
      columnList: result.columns.map((name) => ({ name })),
      rowList: result.rows.map((r) => ({ cells: Object.values(r) })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
