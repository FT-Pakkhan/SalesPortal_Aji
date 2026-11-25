import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { readAttachmentFile, updateAttachmentText, deleteAttachment, assertAttachmentChangeable } from '@/lib/attachments';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/attachments/[id] - The file itself (download)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    const { fileName, bytes } = await readAttachmentFile(parseInt(id));
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/attachments/[id] - Change the Remarks (FreeText)
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const body = await request.json();
    const freeText = String(body.freeText ?? '').trim() || null;
    await assertAttachmentChangeable(parseInt(id), user.userId);
    return successResponse(await updateAttachmentText(parseInt(id), freeText, user.userName), 'Attachment updated');
  } catch (error) {
    return errorResponse(error);
  }
}

// DELETE /api/attachments/[id] - Remove the attachment and its file
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    await assertAttachmentChangeable(parseInt(id), user.userId);
    await deleteAttachment(parseInt(id));
    return successResponse(null, 'Attachment deleted');
  } catch (error) {
    return errorResponse(error);
  }
}
