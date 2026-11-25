import { listCompanies } from '@/lib/db';
import { isMultiCompany } from '@/lib/companyContext';
import { successResponse, errorResponse } from '@/lib/apiResponse';

// GET /api/auth/companies - The login screen's Company drop-down (no login needed): each company's database and name
// only, never its server or login. With one company: multiCompany false and no list.
export async function GET() {
  try {
    if (!isMultiCompany()) return successResponse({ multiCompany: false, companies: [] });
    const companies = (await listCompanies()).map((c) => ({ database: c.database, name: c.name }));
    return successResponse({ multiCompany: true, companies });
  } catch (error) {
    return errorResponse(error);
  }
}
