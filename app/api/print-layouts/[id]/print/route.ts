import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { errorResponse } from '@/lib/apiResponse';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { getPrintableLayout, printableDocument } from '@/lib/printLayouts';
import { renderLayoutPdf } from '@/lib/crystal';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/print-layouts/[id]/print?objType=FTS11OQUT&docEntry=1 - The document printed with this layout, as a PDF
// (the layout's DocKey@ parameter gets the document's DocEntry)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    const objType = request.nextUrl.searchParams.get('objType') ?? '';
    const docEntry = Number(request.nextUrl.searchParams.get('docEntry'));

    const doc = printableDocument(objType);
    if (!Number.isInteger(docEntry) || docEntry <= 0) throw new ValidationError('Document is not valid');
    // Any document, drafts too: the layout itself can mark a draft (e.g. a watermark when DocStatus is DRAFT)
    const found = await db.query(`SELECT DocEntry FROM ${doc.header} WHERE DocEntry = @docEntry`, [
      { name: 'docEntry', value: docEntry },
    ]);
    if (found.length === 0) throw new NotFoundError(doc.label);

    const layout = await getPrintableLayout(parseInt(id), objType);
    const pdf = await renderLayoutPdf(layout.LayoutPath, docEntry);

    // Shown in the browser (inline), so it can be printed or saved from there
    const fileName = `${layout.LayoutName}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
