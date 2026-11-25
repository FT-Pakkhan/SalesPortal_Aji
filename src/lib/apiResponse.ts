import { NextResponse } from 'next/server';
import { AppError } from './errors';
import { AuthError } from './auth';

function keyToCamel(key: string): string {
  // Handle acronym prefixes like "PONumber" → "poNumber", "ID" → "id"
  let i = 0;
  while (i < key.length && key[i] === key[i].toUpperCase() && key[i] !== key[i].toLowerCase()) {
    i++;
  }
  if (i <= 1) return key.charAt(0).toLowerCase() + key.slice(1);
  // Lowercase all leading uppercase except the last one (which starts the next word)
  // e.g. "PONumber" → i=2, lowercase "PO" but keep "N" upper → "poNumber"
  // e.g. "ID" → i=2 (end of string), lowercase all → "id"
  if (i === key.length) return key.toLowerCase();
  return key.slice(0, i - 1).toLowerCase() + key.slice(i - 1);
}

function toCamelCase(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[keyToCamel(key)] = toCamelCase(value);
    }
    return result;
  }
  return obj;
}

export function successResponse<T>(data: T, message?: string, status = 200) {
  return NextResponse.json(
    { success: true, data: toCamelCase(data), message },
    { status }
  );
}

export function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.statusCode }
    );
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code, details: error.details },
      { status: error.statusCode }
    );
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json(
    { success: false, error: message, code: 'INTERNAL_ERROR' },
    { status: 500 }
  );
}
