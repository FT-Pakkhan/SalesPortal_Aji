import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { authenticateRequest } from '@/lib/auth';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { NotFoundError } from '@/lib/errors';
import {
  parseSeriesFields,
  assertObjTypeExists,
  assertSeriesAvailable,
  clearOtherDefaults,
  saveDateNumbering,
  getSeriesDetail,
} from '@/lib/documentNumbering';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/document-numbering/[id] - A series with its Date Numbering rows
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    authenticateRequest(request);
    const { id } = await context.params;
    return successResponse(await getSeriesDetail(parseInt(id)));
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/document-numbering/[id] - Update a series and the Seq of its Date Numbering rows
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = authenticateRequest(request);
    const { id } = await context.params;
    const docEntry = parseInt(id);
    const fields = parseSeriesFields(await request.json());

    const existing = await db.query(`SELECT DocEntry FROM FTS11NNM1 WHERE DocEntry = @docEntry`, [
      { name: 'docEntry', value: docEntry },
    ]);
    if (existing.length === 0) throw new NotFoundError('Document numbering series');

    await assertObjTypeExists(fields.objType);
    await assertSeriesAvailable(fields.objType, fields.series, docEntry);

    const transaction = await db.beginTransaction();
    try {
      // Before the update: only one default series per document type is allowed
      if (fields.isDefault) await clearOtherDefaults(fields.objType, docEntry, transaction);
      await db.query(
        `UPDATE FTS11NNM1
         SET ObjType = @objType, Series = @series, SeriesName = @seriesName, Prefix = @prefix, Seq = @seq,
             [Length] = @length, Suffix = @suffix, [Month] = @month, [Year] = @year, IsDefault = @isDefault, Active = @active,
             IsManual = @isManual, UpdatedBy = @updatedBy, UpdatedDate = GETDATE()
         WHERE DocEntry = @docEntry`,
        [
          { name: 'docEntry', value: docEntry },
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
          { name: 'updatedBy', value: user.userName },
        ],
        transaction
      );
      await saveDateNumbering(docEntry, fields.dates, transaction);
      await db.commitTransaction(transaction);
    } catch (error) {
      await db.rollbackTransaction(transaction);
      throw error;
    }

    return successResponse(await getSeriesDetail(docEntry), 'Document numbering updated');
  } catch (error) {
    return errorResponse(error);
  }
}
