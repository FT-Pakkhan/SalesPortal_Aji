import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { enterCompany, isMultiCompany } from './companyContext';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

export interface JwtPayload {
  userId: number;
  userName: string;
  displayName: string | null;
  /** Several companies: the company's portal database chosen at login, and its SAP database then */
  company?: string;
  sapDb?: string | null;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function getTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

export function authenticateRequest(request: NextRequest): JwtPayload {
  const token = getTokenFromRequest(request);
  if (!token) {
    throw new AuthError('No token provided');
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AuthError('Invalid or expired token');
  }
  // Several companies: the rest of the request works in the company chosen at login (a login made before
  // there were several companies has none, so it must log in again)
  if (isMultiCompany()) {
    if (!payload.company) throw new AuthError('Please log in again and choose the company');
    enterCompany({ database: payload.company, sapDatabase: payload.sapDb ?? null });
  }
  return payload;
}

export class AuthError extends Error {
  public statusCode = 401;
  public code = 'AUTH_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
