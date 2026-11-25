import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import {
  SERIES_SELECT,
  parseSeriesFields,
  assertObjTypeExists,
  assertSeriesAvailable,
  clearOtherDefaults,
  getSeriesDetail,
} from '@/lib/documentNumbering';

// GET /api/document-numbering - List numbering series
// ?objType=FTS11OQUT gives only that document type's active series (a document's Series drop-down)
export async function GET(request: NextRequest) {
  try {
    authenticateRequest(request);
    const objType = request.nextUrl.searchParams.get('objType');
    const data = objType
      ? await db.query(`${SERIES_SELECT} WHERE h.ObjType = @objType AND h.Active = 1 ORDER BY h.Series`, [
          { name: 'objType', value: objType },
        ])
      : await db.query(`${SERIES_SELECT} ORDER BY v.Name, h.Series`);
    return successResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/document-numbering - Create a numbering series
export async function POST(request: NextRequest) {
  try {
    const user = authenticateRequest(request);
    const fields = parseSeriesFields(await request.json());

    await assertObjTypeExists(fields.objType);
    await assertSeriesAvailable(fields.objType, fields.series);

    const transaction = await db.beginTransaction();
    let docEntry: number;
    try {
      // Before the insert: only one default series per document type is allowed
      if (fields.isDefault) await clearOtherDefaults(fields.objType, 0, transaction);
      const result = await db.query<{ DocEntry: number }>(
        `INSERT INTO FTS11NNM1 (ObjType, Series, SeriesName, Prefix, Seq, [Length], Suffix, [Month], [Year], IsDefault, Active, IsManual,
                                CreatedBy, CreatedDate, UpdatedBy, UpdatedDate)
         OUTPUT INSERTED.DocEntry
         VALUES (@objType, @series, @seriesName, @prefix, @seq, @length, @suffix, @month, @year, @isDefault, @active, @isManual,
                 @createdBy, GETDATE(), @createdBy, GETDATE())`,
        [
          { name: 'objType', value: fields.objType },
          { name: 'series', value: fields.series },
          { name: 'seriesName', value: fields.seriesName },
          { name: 'prefix', value: fields.prefix },
          { name: 'seq', value: fields.seq },
          { name: 'length', value: fields.length },
          { name: 'suffix', value: fields.suffix },
          { name: 'month', value: fields.month ? 1 : 0 },
          { name: 'year', value: fields.year ? 1 : 0 },
          { name: 'isDefault', value: fields.isDefault ? 1 : 0 },
          { name: 'active', value: fields.active ? 1 : 0 },
          { name: 'isManual', value: fields.isManual ? 1 : 0 },
          { name: 'createdBy', value: user.userName },
        ],
        transaction
      );
      docEntry = result[0].DocEntry;
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }

    return successResponse(await getSeriesDetail(docEntry), 'Document numbering created', 201);
  } catch (error) {
    return errorResponse(error);
  }
}
