import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { ValidationError } from '@/lib/errors';
import { assertDocumentExists, assertAttachmentsChangeable, listAttachments, addAttachment } from '@/lib/attachments';

// GET /api/attachments?objType=FTS11OQUT&docEntry=15 - Attachments of a document
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const objType = request.nextUrl.searchParams.get('objType') ?? '';
    const docEntry = Number(request.nextUrl.searchParams.get('docEntry'));
    await assertDocumentExists(objType, docEntry);
    return successResponse(await listAttachments(objType, docEntry));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/attachments - Attach a file to a document (multipart form: objType, docEntry, file, freeText)
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const form = await request.formData();
    const objType = String(form.get('objType') ?? '');
    const docEntry = Number(form.get('docEntry'));
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('Choose a file to attach');

    await assertAttachmentsChangeable(objType, docEntry, user.userId);
    const freeText = String(form.get('freeText') ?? '').trim() || null;
    const saved = await addAttachment(
      objType,
      docEntry,
      { name: file.name, size: file.size, bytes: Buffer.from(await file.arrayBuffer()) },
      freeText,
      user.userName
    );
    return successResponse(saved, 'File attached', 201);
  } catch (error) {
    return errorResponse(error);
  }
}
