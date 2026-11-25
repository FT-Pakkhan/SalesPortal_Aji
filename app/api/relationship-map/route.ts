import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getRelationshipMap } from '@/lib/relationshipMap';

// GET /api/relationship-map?objType=FTS11OQUT&docEntry=1 - The document, the documents it was copied from and
// those copied from it (followed both ways): { startId, nodes: [...], edges: [{ from, to }], truncated }
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const objType = request.nextUrl.searchParams.get('objType') ?? '';
    const docEntry = Number(request.nextUrl.searchParams.get('docEntry'));
    return successResponse(await getRelationshipMap(objType, docEntry));
  } catch (error) {
    return errorResponse(error);
  }
}
